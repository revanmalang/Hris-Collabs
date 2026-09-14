const db = require('../db');

// The master list of permissions this app understands. super_admin
// implicitly has every permission and is never stored in role_permissions
// - there's no way to lock super_admin out of its own system through this
// matrix.
const PERMISSION_DEFS = [
  { code: 'employees.manage', label: 'Kelola data karyawan (tambah/edit/nonaktifkan, foto, reset password, riwayat, import)', category: 'Karyawan' },
  { code: 'employees.view_sensitive', label: 'Lihat data sensitif karyawan lain (NPWP/BPJS/rekening/kontak)', category: 'Karyawan' },
  { code: 'attendance.live_monitor', label: 'Akses Live Attendance Monitor', category: 'Absensi' },
  { code: 'attendance.correct', label: 'Koreksi manual data absensi', category: 'Absensi' },
  { code: 'attendance.qr_generate', label: 'Generate QR Code absensi', category: 'Absensi' },
  { code: 'leave.approve', label: 'Approve / reject pengajuan izin & cuti', category: 'Izin & Cuti' },
  { code: 'overtime.approve', label: 'Approve / reject pengajuan lembur', category: 'Lembur' },
  { code: 'organization.manage', label: 'Kelola departemen, jabatan, lokasi, shift, jadwal & rotasi', category: 'Organisasi' },
  { code: 'announcements.manage', label: 'Buat & hapus pengumuman', category: 'Komunikasi' },
  { code: 'reports.view', label: 'Akses Reporting Center & Payroll Preparation', category: 'Laporan' },
  { code: 'audit.view', label: 'Akses Audit Log', category: 'Keamanan' },
  { code: 'settings.manage', label: 'Ubah pengaturan sistem (default hanya Super Admin)', category: 'Keamanan' },
];

// Default grants matching this app's original hardcoded requireRole(...)
// behavior, so enabling the dynamic matrix doesn't silently change access
// on upgrade - HR/managers keep exactly what they had until someone edits
// the matrix from Settings.
const DEFAULT_GRANTS = {
  hr: [
    'employees.manage', 'employees.view_sensitive', 'attendance.live_monitor', 'attendance.correct', 'attendance.qr_generate',
    'leave.approve', 'overtime.approve', 'organization.manage', 'announcements.manage', 'reports.view', 'audit.view',
  ],
  manager: ['attendance.live_monitor', 'leave.approve', 'overtime.approve', 'reports.view'],
  employee: [],
};

// In-memory cache of the role -> permission-code matrix. hasPermission()
// reads this synchronously so it (and everything built on it - rbac.js's
// maskEmployee, canViewSensitive, requirePermission middleware) never had
// to become async when the DB layer did. The cache is populated once at
// server boot (see server.js -> loadCache()) and kept in sync by
// setGrant() on every edit; it is NOT re-queried per request.
let cache = { hr: new Set(), manager: new Set() };

async function loadCache() {
  const rows = await db.prepare('SELECT role, permission_code FROM role_permissions').all();
  const next = { hr: new Set(), manager: new Set() };
  for (const r of rows) {
    if (!next[r.role]) next[r.role] = new Set();
    next[r.role].add(r.permission_code);
  }
  cache = next;
}

// Run once via `npm run db:migrate`. Inserts the permission catalogue and,
// only on a brand-new install (no grants exist yet at all), the default
// grants above. Also loads the cache so a migrate-then-seed-then-start
// sequence in one process (e.g. tests) works without a separate reload.
async function seedPermissions() {
  for (const p of PERMISSION_DEFS) {
    await db.prepare('INSERT IGNORE INTO permissions (code, label, category) VALUES (?,?,?)').run(p.code, p.label, p.category);
  }
  const existing = await db.prepare('SELECT COUNT(*) as c FROM role_permissions').get();
  if (existing.c === 0) {
    for (const [role, codes] of Object.entries(DEFAULT_GRANTS)) {
      for (const code of codes) {
        await db.prepare('INSERT IGNORE INTO role_permissions (role, permission_code) VALUES (?,?)').run(role, code);
      }
    }
  }
  await loadCache();
}

function hasPermission(role, code) {
  if (role === 'super_admin') return true;
  return !!(cache[role] && cache[role].has(code));
}

// Built entirely from the in-memory cache + the static PERMISSION_DEFS -
// no DB round trip needed for the admin UI to render the matrix.
function getMatrix() {
  const roles = ['manager', 'hr'];
  return {
    roles,
    permissions: PERMISSION_DEFS,
    grants: Object.fromEntries(roles.map((role) => [role, PERMISSION_DEFS.map((p) => hasPermission(role, p.code))])),
  };
}

async function setGrant(role, code, enabled) {
  if (!['hr', 'manager'].includes(role)) {
    throw new Error('Only hr and manager permissions can be edited - employee has none, super_admin has all');
  }
  if (!PERMISSION_DEFS.some((p) => p.code === code)) throw new Error('Unknown permission code');

  if (enabled) {
    await db.prepare('INSERT IGNORE INTO role_permissions (role, permission_code) VALUES (?,?)').run(role, code);
    cache[role].add(code);
  } else {
    await db.prepare('DELETE FROM role_permissions WHERE role = ? AND permission_code = ?').run(role, code);
    cache[role].delete(code);
  }
}

// Returns the flat list of permission codes a given role actually holds
// right now - used by GET /auth/me so the frontend can show/hide nav items
// and buttons based on the live matrix instead of a hardcoded role list.
function getEffectivePermissions(role) {
  if (role === 'super_admin') return PERMISSION_DEFS.map((p) => p.code);
  return cache[role] ? Array.from(cache[role]) : [];
}

module.exports = { PERMISSION_DEFS, seedPermissions, loadCache, hasPermission, getMatrix, setGrant, getEffectivePermissions };
