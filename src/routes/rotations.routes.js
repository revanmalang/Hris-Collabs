const express = require('express');
const db = require('../db');
const { newId, nowIso } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { logAudit } = require('../utils/audit');
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(requireAuth);

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

// GET /api/shift-rotations - list defined rotation patterns
router.get(
  '/shift-rotations',
  requirePermission('organization.manage'),
  asyncHandler(async (req, res) => {
    const rows = await db.prepare('SELECT * FROM shift_rotations ORDER BY created_at DESC').all();
    res.json(rows.map((r) => ({ ...r, pattern: JSON.parse(r.pattern) })));
  })
);

// POST /api/shift-rotations - define a repeating pattern of shift_id|null (OFF)
router.post(
  '/shift-rotations',
  requirePermission('organization.manage'),
  asyncHandler(async (req, res) => {
    const { name, pattern } = req.body;
    if (!name || !Array.isArray(pattern) || pattern.length === 0) {
      throw new ApiError(400, 'name and a non-empty pattern array are required');
    }
    if (pattern.length > 90) throw new ApiError(400, 'pattern too long (max 90 days per cycle)');
    const id = newId();
    await db.prepare('INSERT INTO shift_rotations (id, name, pattern, created_at) VALUES (?,?,?,?)').run(
      id, name, JSON.stringify(pattern), nowIso()
    );
    await logAudit({ userId: req.user.id, action: 'shift_rotation_create', objectType: 'shift_rotation', objectId: id, req });
    res.status(201).json({ id, name, pattern });
  })
);

router.delete(
  '/shift-rotations/:id',
  requirePermission('organization.manage'),
  asyncHandler(async (req, res) => {
    await db.prepare('DELETE FROM shift_rotation_assignments WHERE rotation_id = ?').run(req.params.id);
    await db.prepare('DELETE FROM shift_rotations WHERE id = ?').run(req.params.id);
    await logAudit({ userId: req.user.id, action: 'shift_rotation_delete', objectType: 'shift_rotation', objectId: req.params.id, req });
    res.json({ ok: true });
  })
);

// GET /api/shift-rotations/assignments - who's on which rotation
router.get(
  '/shift-rotations/assignments',
  requirePermission('organization.manage'),
  asyncHandler(async (req, res) => {
    const rows = await db
      .prepare(
        `SELECT a.*, e.full_name, e.employee_code, r.name as rotation_name, r.pattern
         FROM shift_rotation_assignments a
         JOIN employees e ON e.id = a.employee_id
         JOIN shift_rotations r ON r.id = a.rotation_id
         ORDER BY e.full_name`
      )
      .all();
    res.json(rows.map((r) => ({ ...r, pattern: JSON.parse(r.pattern) })));
  })
);

// POST /api/shift-rotations/:id/assign - put employees onto this rotation,
// anchored at startDate (day 0 of the pattern). Re-assigning an employee
// replaces their previous rotation (one active rotation per employee).
router.post(
  '/shift-rotations/:id/assign',
  requirePermission('organization.manage'),
  asyncHandler(async (req, res) => {
    const { employeeIds, startDate } = req.body;
    if (!Array.isArray(employeeIds) || !employeeIds.length) throw new ApiError(400, 'employeeIds required');
    if (!startDate) throw new ApiError(400, 'startDate required');
    const rotation = await db.prepare('SELECT * FROM shift_rotations WHERE id = ?').get(req.params.id);
    if (!rotation) throw new ApiError(404, 'Rotation not found');

    const tx = db.transaction(async (tdb, ids) => {
      const upsert = tdb.prepare(
        `INSERT INTO shift_rotation_assignments (id, rotation_id, employee_id, start_date, created_at)
         VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE rotation_id = VALUES(rotation_id), start_date = VALUES(start_date)`
      );
      for (const empId of ids) await upsert.run(newId(), rotation.id, empId, startDate, nowIso());
    });
    await tx(employeeIds);
    await logAudit({ userId: req.user.id, action: 'shift_rotation_assign', objectType: 'shift_rotation', objectId: rotation.id, req, metadata: { employeeCount: employeeIds.length } });
    res.json({ ok: true, assigned: employeeIds.length });
  })
);

// POST /api/shift-rotations/generate - expand every active rotation
// assignment into concrete `schedules` rows for a date range. Safe to
// re-run for overlapping ranges (upserts), so HR can generate "the next
// 90 days" on a recurring basis without duplicating anything.
router.post(
  '/shift-rotations/generate',
  requirePermission('organization.manage'),
  asyncHandler(async (req, res) => {
    const { from, to } = req.body;
    if (!from || !to) throw new ApiError(400, 'from and to dates are required');
    if (daysBetween(from, to) > 366) throw new ApiError(400, 'Range too large (max 366 days)');

    const rawAssignments = await db
      .prepare(
        `SELECT a.employee_id, a.start_date, r.pattern FROM shift_rotation_assignments a
         JOIN shift_rotations r ON r.id = a.rotation_id`
      )
      .all();
    const assignments = rawAssignments.map((a) => ({ ...a, pattern: JSON.parse(a.pattern) }));

    let written = 0;
    let daysOff = 0;
    const tx = db.transaction(async (tdb) => {
      const upsertShift = tdb.prepare(
        `INSERT INTO schedules (id, employee_id, shift_id, date) VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE shift_id = VALUES(shift_id)`
      );
      const deleteOff = tdb.prepare('DELETE FROM schedules WHERE employee_id = ? AND date = ?');

      for (const a of assignments) {
        if (a.start_date > to) continue; // rotation hasn't started within this range yet
        for (let d = new Date(Math.max(new Date(from), new Date(a.start_date))); d <= new Date(to); d.setDate(d.getDate() + 1)) {
          const dateStr = d.toISOString().slice(0, 10);
          const dayIndex = daysBetween(a.start_date, dateStr) % a.pattern.length;
          const shiftId = a.pattern[dayIndex];
          if (shiftId) {
            await upsertShift.run(newId(), a.employee_id, shiftId, dateStr);
            written += 1;
          } else {
            await deleteOff.run(a.employee_id, dateStr);
            daysOff += 1;
          }
        }
      }
    });
    await tx();

    await logAudit({ userId: req.user.id, action: 'shift_rotation_generate', req, metadata: { from, to, written, daysOff } });
    res.json({ ok: true, scheduleEntriesWritten: written, daysOff, employeesAffected: assignments.length });
  })
);

module.exports = router;
