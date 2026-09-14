const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const multer = require('multer');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireRole, requirePermission } = require('../middleware/rbac');
const { logAudit } = require('../utils/audit');
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(requireAuth);

// MySQL connection details, shared with src/db/index.js. Passed to the
// mysqldump/mysql CLI tools via MYSQL_PWD (an env var) rather than a
// command-line flag, so the password never shows up in `ps aux` output.
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || '3306';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'employeehub';

// Tables whose export dumps every column as-is. Deliberately excludes
// `users` (has password hashes and TOTP secrets) and `password_reset_tokens`
// (has token hashes) - a JSON export is meant for reviewing/migrating
// business data, not for recovering credentials.
const EXPORTABLE_TABLES = [
  'departments', 'positions', 'locations', 'shifts', 'employees',
  'attendance', 'leave_types', 'leave_balances', 'leave_requests',
  'overtime_requests', 'holidays', 'schedules', 'notifications',
  'announcements', 'documents', 'audit_logs', 'settings',
  'employment_history', 'shift_rotations', 'shift_rotation_assignments',
];

const uploadBackup = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(os.tmpdir(), 'employeehub-restore');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}.sql`),
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
});

// GET /api/settings/backup/download - full SQL dump via mysqldump, streamed
// straight to the response (never written to disk on the server). This
// replaces the single-file-copy backup used when this app ran on SQLite -
// a `.sql` dump is the standard, portable way to back up MySQL/MariaDB, and
// restoring it works the same way whether the server is a plain MySQL
// install or XAMPP's bundled MariaDB.
router.get(
  '/settings/backup/download',
  requirePermission('settings.manage'),
  asyncHandler(async (req, res) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    await logAudit({ userId: req.user.id, action: 'database_backup_download', req });

    res.setHeader('Content-Type', 'application/sql');
    res.setHeader('Content-Disposition', `attachment; filename="employeehub-backup-${timestamp}.sql"`);

    const child = spawn(
      'mysqldump',
      ['--host', DB_HOST, '--port', DB_PORT, '--user', DB_USER, '--single-transaction', '--routines', '--triggers', DB_NAME],
      { env: { ...process.env, MYSQL_PWD: DB_PASSWORD } }
    );
    child.stdout.pipe(res);
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      if (!res.headersSent) res.status(500);
      res.end(`\n-- mysqldump failed to start: ${err.message}\n`);
    });
    child.on('close', (code) => {
      if (code !== 0) console.error('[backup] mysqldump exited with code', code, stderr);
      res.end();
    });
  })
);

// GET /api/settings/backup/export-json - human-readable full data export,
// for reviewing or migrating data outside this app. Excludes credentials.
router.get(
  '/settings/backup/export-json',
  requirePermission('settings.manage'),
  asyncHandler(async (req, res) => {
    const dump = { exportedAt: new Date().toISOString(), tables: {} };
    for (const table of EXPORTABLE_TABLES) {
      dump.tables[table] = await db.prepare(`SELECT * FROM ${table}`).all();
    }
    await logAudit({ userId: req.user.id, action: 'database_export_json', req });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="employeehub-export-${timestamp}.json"`);
    res.send(JSON.stringify(dump, null, 2));
  })
);

// POST /api/settings/backup/restore - restoring the whole database is
// destructive and irreversible for whatever's currently there, so this
// stays hard-locked to super_admin regardless of the permission matrix
// (see services/permissions.js - settings.manage is delegatable, this
// isn't). Unlike the old SQLite version, MySQL doesn't need a process
// restart to swap files - the uploaded .sql dump is replayed directly
// against the live database via the `mysql` CLI. Existing app connections
// may see brief errors while tables are dropped/recreated mid-import; the
// pool reconnects automatically afterward.
router.post(
  '/settings/backup/restore',
  requireRole('super_admin'),
  uploadBackup.single('backup'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, 'No backup file uploaded');

    const head = fs.readFileSync(req.file.path, { encoding: 'utf8', flag: 'r' }).slice(0, 4096);
    const looksLikeSqlDump = /CREATE TABLE|INSERT INTO|-- MySQL dump|-- MariaDB dump/i.test(head);
    if (!looksLikeSqlDump) {
      fs.unlinkSync(req.file.path);
      throw new ApiError(400, 'This does not look like a valid SQL backup file');
    }

    await logAudit({ userId: req.user.id, action: 'database_restore_started', req, metadata: { originalName: req.file.originalname, size: req.file.size } });

    await new Promise((resolve, reject) => {
      const child = spawn(
        'mysql',
        ['--host', DB_HOST, '--port', DB_PORT, '--user', DB_USER, DB_NAME],
        { env: { ...process.env, MYSQL_PWD: DB_PASSWORD } }
      );
      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr || `mysql exited with code ${code}`))));
      fs.createReadStream(req.file.path).pipe(child.stdin);
    });

    fs.unlinkSync(req.file.path);
    await logAudit({ userId: req.user.id, action: 'database_restore_completed', req });

    res.json({ ok: true, message: 'Restore selesai. Data sudah diganti dengan isi backup yang diunggah.' });
  })
);

// POST /api/settings/reset-data - wipes every business record (employees,
// attendance, leave/overtime, org structure, announcements, documents,
// schedules, rotations) so the app can be handed a clean slate instead of
// deleting rows one by one through the UI. Deliberately keeps:
//   - the account making this request (never locks the caller out)
//   - audit_logs (the reset itself is still logged, for accountability)
//   - settings and the permission matrix (app configuration, not data)
// Requires typing an exact confirmation phrase, on top of being
// super_admin-only and non-delegable - this is the most destructive single
// action in the app.
const RESET_CONFIRM_PHRASE = 'HAPUS SEMUA DATA';

const WIPE_TABLES = [
  'notifications', 'documents', 'employment_history', 'leave_requests', 'leave_balances',
  'overtime_requests', 'attendance', 'schedules', 'shift_rotation_assignments', 'shift_rotations',
  'qr_codes', 'login_history', 'password_reset_tokens', 'announcements',
  'employees', 'departments', 'positions', 'locations', 'shifts', 'leave_types', 'holidays',
];

router.post(
  '/settings/reset-data',
  requireRole('super_admin'),
  asyncHandler(async (req, res) => {
    const { confirm } = req.body;
    if (confirm !== RESET_CONFIRM_PHRASE) {
      throw new ApiError(400, `Type "${RESET_CONFIRM_PHRASE}" exactly to confirm`);
    }

    await logAudit({ userId: req.user.id, action: 'data_reset', req, metadata: { keptUserId: req.user.id } });

    // FOREIGN_KEY_CHECKS is a per-connection session variable, so it must be
    // set on the SAME connection running the deletes (via tdb, the
    // transaction-scoped handle) - setting it through the general pool
    // beforehand would land on a different pooled connection and have no
    // effect on the one actually doing the work.
    const tx = db.transaction(async (tdb) => {
      await tdb.exec('SET FOREIGN_KEY_CHECKS = 0');
      for (const table of WIPE_TABLES) await tdb.exec(`DELETE FROM ${table}`);
      await tdb.prepare('DELETE FROM users WHERE id != ?').run(req.user.id);
      await tdb.exec('SET FOREIGN_KEY_CHECKS = 1');
    });
    await tx();

    res.json({ ok: true, message: 'Semua data telah dihapus. Akun Anda tetap aktif; akun login lain (termasuk akun demo) ikut terhapus.' });
  })
);

module.exports = router;
