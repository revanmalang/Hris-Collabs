const express = require('express');
const db = require('../db');
const { newId, nowIso } = require('../utils/id');
const { leaveRequestSchema } = require('../utils/validators');
const { requireAuth } = require('../middleware/auth');
const { requireRole, requirePermission } = require('../middleware/rbac');
const { logAudit } = require('../utils/audit');
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const { emitLeaveEvent, emitNotification } = require('../realtime/socket');
const { uploadDocument } = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth);

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000) + 1;
}

// GET /api/leave - list, scoped by role (employee sees own, manager sees team, HR sees all)
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status, employeeId } = req.query;
    const where = [];
    const params = {};
    if (req.user.role === 'employee') {
      where.push('lr.employee_id = @employeeId');
      params.employeeId = req.user.employeeId;
    } else if (req.user.role === 'manager') {
      where.push('e.manager_id = @managerId');
      params.managerId = req.user.employeeId;
    } else if (employeeId) {
      where.push('lr.employee_id = @employeeId');
      params.employeeId = employeeId;
    }
    if (status) { where.push('lr.status = @status'); params.status = status; }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await db
      .prepare(
        `SELECT lr.*, e.full_name, e.employee_code, d.name as department_name
         FROM leave_requests lr
         JOIN employees e ON e.id = lr.employee_id
         LEFT JOIN departments d ON d.id = e.department_id
         ${whereSql}
         ORDER BY lr.created_at DESC`
      )
      .all(params);
    res.json(rows);
  })
);

// GET /api/leave/balance - current user's leave balances
router.get(
  '/balance',
  asyncHandler(async (req, res) => {
    if (!req.user.employeeId) throw new ApiError(400, 'No employee record linked');
    const year = new Date().getFullYear();
    const rows = await db
      .prepare(
        `SELECT lb.*, lt.name as leave_type_name FROM leave_balances lb
         JOIN leave_types lt ON lt.id = lb.leave_type_id
         WHERE lb.employee_id = ? AND lb.year = ?`
      )
      .all(req.user.employeeId, year);
    res.json(rows);
  })
);

// GET /api/leave/calendar - who is on leave in a date range (for the HR calendar view)
router.get(
  '/calendar',
  asyncHandler(async (req, res) => {
    const { from, to } = req.query;
    const rows = await db
      .prepare(
        `SELECT lr.id, lr.type, lr.start_date, lr.end_date, lr.status, e.full_name, e.employee_code, d.name as department_name
         FROM leave_requests lr
         JOIN employees e ON e.id = lr.employee_id
         LEFT JOIN departments d ON d.id = e.department_id
         WHERE lr.status = 'approved' AND lr.start_date <= @to AND lr.end_date >= @from`
      )
      .all({ from: from || '0000-01-01', to: to || '9999-12-31' });
    res.json(rows);
  })
);

router.post(
  '/',
  uploadDocument.single('attachment'),
  asyncHandler(async (req, res) => {
    if (!req.user.employeeId) throw new ApiError(400, 'This account is not linked to an employee record');
    const data = leaveRequestSchema.parse(req.body);
    if (new Date(data.endDate) < new Date(data.startDate)) {
      throw new ApiError(400, 'endDate must be on or after startDate');
    }
    const id = newId();
    const ts = nowIso();
    const attachmentUrl = req.file ? `/uploads/documents/${req.file.filename}` : null;

    await db.prepare(
      `INSERT INTO leave_requests (id, employee_id, type, start_date, end_date, reason, attachment_url, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,'pending',?,?)`
    ).run(id, req.user.employeeId, data.type, data.startDate, data.endDate, data.reason ?? null, attachmentUrl, ts, ts);

    await logAudit({ userId: req.user.id, action: 'leave_request_create', objectType: 'leave_request', objectId: id, req, metadata: { type: data.type } });

    const employee = await db.prepare('SELECT full_name FROM employees WHERE id = ?').get(req.user.employeeId);
    emitLeaveEvent({ type: 'submitted', id, employeeId: req.user.employeeId, employeeName: employee.full_name, leaveType: data.type, status: 'pending' });

    res.status(201).json({ id, status: 'pending', days: daysBetween(data.startDate, data.endDate) });
  })
);

router.post(
  '/:id/approve',
  requirePermission('leave.approve'),
  asyncHandler(async (req, res) => {
    const leave = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(req.params.id);
    if (!leave) throw new ApiError(404, 'Leave request not found');
    if (leave.status !== 'pending') throw new ApiError(409, 'Leave request already reviewed');

    await db.prepare(
      'UPDATE leave_requests SET status = ?, reviewed_by_id = ?, reviewed_at = ?, review_note = ?, updated_at = ? WHERE id = ?'
    ).run('approved', req.user.id, nowIso(), req.body.note ?? null, nowIso(), leave.id);

    // Deduct leave balance (best-effort - if no balance row exists, skip silently since spec keeps
    // leave-balance setup as an HR admin task, not a hard blocker on approval).
    if (leave.leave_type_id) {
      const days = daysBetween(leave.start_date, leave.end_date);
      await db.prepare(
        `UPDATE leave_balances SET used = used + ? WHERE employee_id = ? AND leave_type_id = ? AND year = ?`
      ).run(days, leave.employee_id, leave.leave_type_id, new Date(leave.start_date).getFullYear());
    }

    await logAudit({ userId: req.user.id, action: 'leave_approve', objectType: 'leave_request', objectId: leave.id, req });

    const employee = await db.prepare('SELECT full_name FROM employees WHERE id = ?').get(leave.employee_id);
    const notifId = newId();
    await db.prepare('INSERT INTO notifications (id, employee_id, title, message, type, created_at) VALUES (?,?,?,?,?,?)')
      .run(notifId, leave.employee_id, 'Leave approved', `Your ${leave.type} request was approved`, 'approval', nowIso());
    emitNotification(leave.employee_id, { id: notifId, title: 'Leave approved', type: 'approval', createdAt: nowIso() });
    emitLeaveEvent({ type: 'approved', id: leave.id, employeeId: leave.employee_id, employeeName: employee.full_name, status: 'approved' });

    res.json({ ok: true });
  })
);

router.post(
  '/:id/reject',
  requirePermission('leave.approve'),
  asyncHandler(async (req, res) => {
    const leave = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(req.params.id);
    if (!leave) throw new ApiError(404, 'Leave request not found');
    if (leave.status !== 'pending') throw new ApiError(409, 'Leave request already reviewed');

    await db.prepare(
      'UPDATE leave_requests SET status = ?, reviewed_by_id = ?, reviewed_at = ?, review_note = ?, updated_at = ? WHERE id = ?'
    ).run('rejected', req.user.id, nowIso(), req.body.note ?? null, nowIso(), leave.id);

    await logAudit({ userId: req.user.id, action: 'leave_reject', objectType: 'leave_request', objectId: leave.id, req, metadata: { note: req.body.note } });

    const employee = await db.prepare('SELECT full_name FROM employees WHERE id = ?').get(leave.employee_id);
    const notifId = newId();
    await db.prepare('INSERT INTO notifications (id, employee_id, title, message, type, created_at) VALUES (?,?,?,?,?,?)')
      .run(notifId, leave.employee_id, 'Leave rejected', req.body.note || `Your ${leave.type} request was rejected`, 'rejection', nowIso());
    emitNotification(leave.employee_id, { id: notifId, title: 'Leave rejected', type: 'rejection', createdAt: nowIso() });
    emitLeaveEvent({ type: 'rejected', id: leave.id, employeeId: leave.employee_id, employeeName: employee.full_name, status: 'rejected' });

    res.json({ ok: true });
  })
);

module.exports = router;
