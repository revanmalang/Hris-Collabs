const express = require('express');
const db = require('../db');
const { newId, nowIso } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { requireRole, requirePermission } = require('../middleware/rbac');
const { logAudit } = require('../utils/audit');
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const { uploadDocument } = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth);

// ---- Audit log (admin/HR only) --------------------------------------------
router.get(
  '/audit-logs',
  requirePermission('audit.view'),
  asyncHandler(async (req, res) => {
    const { action, from, to, page = 1, pageSize = 50 } = req.query;
    const where = [];
    const params = {};
    if (action) { where.push('al.action = @action'); params.action = action; }
    if (from) { where.push('al.created_at >= @from'); params.from = from; }
    if (to) { where.push('al.created_at <= @to'); params.to = to; }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(Number(pageSize) || 50, 200);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
    const totalRow = await db.prepare(`SELECT COUNT(*) as c FROM audit_logs al ${whereSql}`).get(params);
    const rows = await db.prepare(
        `SELECT al.*, u.email as user_email FROM audit_logs al
         LEFT JOIN users u ON u.id = al.user_id
         ${whereSql} ORDER BY al.created_at DESC LIMIT @limit OFFSET @offset`
      )
      .all({ ...params, limit, offset });
    res.json({ data: rows, total: totalRow.c, page: Number(page), pageSize: limit });
  })
);

// ---- Settings (admin only) -------------------------------------------------
router.get(
  '/settings',
  asyncHandler(async (req, res) => {
    res.json(await db.prepare("SELECT * FROM settings WHERE id = 'singleton'").get());
  })
);

router.put(
  '/settings',
  requirePermission('settings.manage'),
  asyncHandler(async (req, res) => {
    const { companyName, timezone, gpsMode, gracePeriodMinutes, defaultRadiusMeters } = req.body;
    await db.prepare(
      `UPDATE settings SET
         company_name = COALESCE(?, company_name),
         timezone = COALESCE(?, timezone),
         gps_mode = COALESCE(?, gps_mode),
         grace_period_minutes = COALESCE(?, grace_period_minutes),
         default_radius_meters = COALESCE(?, default_radius_meters)
       WHERE id = 'singleton'`
    ).run(companyName ?? null, timezone ?? null, gpsMode ?? null, gracePeriodMinutes ?? null, defaultRadiusMeters ?? null);
    await logAudit({ userId: req.user.id, action: 'settings_update', req, metadata: req.body });
    res.json(await db.prepare("SELECT * FROM settings WHERE id = 'singleton'").get());
  })
);

// System health snapshot (spec #41 "system health dashboard") — lightweight,
// no external monitoring dependency.
router.get(
  '/settings/system-health',
  requirePermission('audit.view'),
  asyncHandler(async (req, res) => {
    const tableCounts = {};
    for (const t of ['employees', 'users', 'attendance', 'leave_requests', 'audit_logs', 'notifications']) {
      const row = await db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get();
      tableCounts[t] = row.c;
    }
    res.json({
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      tableCounts,
      database: process.env.DB_NAME || 'employeehub',
    });
  })
);

// ---- Employee documents ----------------------------------------------------
router.post(
  '/employees/:id/documents',
  requirePermission('employees.manage'),
  uploadDocument.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, 'No file uploaded');
    const { type = 'other' } = req.body;
    const id = newId();
    await db.prepare(
      'INSERT INTO documents (id, employee_id, type, file_name, file_url, uploaded_at) VALUES (?,?,?,?,?,?)'
    ).run(id, req.params.id, type, req.file.originalname, `/uploads/documents/${req.file.filename}`, nowIso());
    await logAudit({ userId: req.user.id, action: 'document_upload', objectType: 'employee', objectId: req.params.id, req, metadata: { type } });
    res.status(201).json({ id, type, fileUrl: `/uploads/documents/${req.file.filename}` });
  })
);

router.get(
  '/employees/:id/documents',
  asyncHandler(async (req, res) => {
    const isSelf = req.user.employeeId === req.params.id;
    if (!isSelf && !['super_admin', 'hr'].includes(req.user.role)) {
      throw new ApiError(403, 'Forbidden');
    }
    res.json(await db.prepare('SELECT * FROM documents WHERE employee_id = ?').all(req.params.id));
  })
);

// ---- Global search ----------------------------------------------------
router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = `%${req.query.q || ''}%`;
    if (!req.query.q) return res.json({ employees: [], departments: [], announcements: [] });
    const employees = await db.prepare(`SELECT id, full_name, employee_code FROM employees WHERE deleted_at IS NULL AND (full_name LIKE ? OR employee_code LIKE ?) LIMIT 10`)
      .all(q, q);
    const departments = await db.prepare(`SELECT id, name FROM departments WHERE deleted_at IS NULL AND name LIKE ? LIMIT 5`).all(q);
    const announcements = await db.prepare(`SELECT id, title FROM announcements WHERE title LIKE ? LIMIT 5`).all(q);
    res.json({ employees, departments, announcements });
  })
);

module.exports = router;
