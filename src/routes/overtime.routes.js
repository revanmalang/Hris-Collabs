const express = require('express');
const db = require('../db');
const { newId, nowIso } = require('../utils/id');
const { overtimeRequestSchema } = require('../utils/validators');
const { requireAuth } = require('../middleware/auth');
const { requireRole, requirePermission } = require('../middleware/rbac');
const { logAudit } = require('../utils/audit');
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const { emitOvertimeEvent, emitNotification } = require('../realtime/socket');

const router = express.Router();
router.use(requireAuth);

function minutesBetween(startTime, endTime) {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60; // crosses midnight
  return mins;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    const where = [];
    const params = {};
    if (req.user.role === 'employee') {
      where.push('o.employee_id = @employeeId');
      params.employeeId = req.user.employeeId;
    } else if (req.user.role === 'manager') {
      where.push('e.manager_id = @managerId');
      params.managerId = req.user.employeeId;
    }
    if (status) { where.push('o.status = @status'); params.status = status; }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await db.prepare(
        `SELECT o.*, e.full_name, e.employee_code FROM overtime_requests o
         JOIN employees e ON e.id = o.employee_id ${whereSql} ORDER BY o.created_at DESC`
      )
      .all(params);
    res.json(rows);
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    if (!req.user.employeeId) throw new ApiError(400, 'This account is not linked to an employee record');
    const data = overtimeRequestSchema.parse(req.body);
    const totalMinutes = minutesBetween(data.startTime, data.endTime);
    const id = newId();
    await db.prepare(
      `INSERT INTO overtime_requests (id, employee_id, date, start_time, end_time, total_minutes, reason, status, created_at)
       VALUES (?,?,?,?,?,?,?,'pending',?)`
    ).run(id, req.user.employeeId, data.date, data.startTime, data.endTime, totalMinutes, data.reason ?? null, nowIso());
    await logAudit({ userId: req.user.id, action: 'overtime_request_create', objectType: 'overtime_request', objectId: id, req });
    const employee = await db.prepare('SELECT full_name FROM employees WHERE id = ?').get(req.user.employeeId);
    emitOvertimeEvent({ type: 'submitted', id, employeeId: req.user.employeeId, employeeName: employee.full_name, status: 'pending' });
    res.status(201).json({ id, totalMinutes, status: 'pending' });
  })
);

router.post(
  '/:id/approve',
  requirePermission('overtime.approve'),
  asyncHandler(async (req, res) => {
    const ot = await db.prepare('SELECT * FROM overtime_requests WHERE id = ?').get(req.params.id);
    if (!ot) throw new ApiError(404, 'Overtime request not found');
    await db.prepare('UPDATE overtime_requests SET status = ?, reviewed_by_id = ?, reviewed_at = ? WHERE id = ?').run(
      'approved', req.user.id, nowIso(), ot.id
    );
    await logAudit({ userId: req.user.id, action: 'overtime_approve', objectType: 'overtime_request', objectId: ot.id, req });
    const notifId = newId();
    await db.prepare('INSERT INTO notifications (id, employee_id, title, message, type, created_at) VALUES (?,?,?,?,?,?)')
      .run(notifId, ot.employee_id, 'Overtime approved', `Your overtime on ${ot.date} was approved`, 'approval', nowIso());
    emitNotification(ot.employee_id, { id: notifId, title: 'Overtime approved', type: 'approval', createdAt: nowIso() });
    emitOvertimeEvent({ type: 'approved', id: ot.id, employeeId: ot.employee_id, status: 'approved' });
    res.json({ ok: true });
  })
);

router.post(
  '/:id/reject',
  requirePermission('overtime.approve'),
  asyncHandler(async (req, res) => {
    const ot = await db.prepare('SELECT * FROM overtime_requests WHERE id = ?').get(req.params.id);
    if (!ot) throw new ApiError(404, 'Overtime request not found');
    await db.prepare('UPDATE overtime_requests SET status = ?, reviewed_by_id = ?, reviewed_at = ? WHERE id = ?').run(
      'rejected', req.user.id, nowIso(), ot.id
    );
    await logAudit({ userId: req.user.id, action: 'overtime_reject', objectType: 'overtime_request', objectId: ot.id, req });
    const notifId = newId();
    await db.prepare('INSERT INTO notifications (id, employee_id, title, message, type, created_at) VALUES (?,?,?,?,?,?)')
      .run(notifId, ot.employee_id, 'Overtime rejected', `Your overtime on ${ot.date} was rejected`, 'rejection', nowIso());
    emitNotification(ot.employee_id, { id: notifId, title: 'Overtime rejected', type: 'rejection', createdAt: nowIso() });
    emitOvertimeEvent({ type: 'rejected', id: ot.id, employeeId: ot.employee_id, status: 'rejected' });
    res.json({ ok: true });
  })
);

module.exports = router;
