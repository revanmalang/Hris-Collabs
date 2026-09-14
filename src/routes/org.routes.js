const express = require('express');
const db = require('../db');
const { newId, nowIso } = require('../utils/id');
const { departmentSchema } = require('../utils/validators');
const { requireAuth } = require('../middleware/auth');
const { requireRole, requirePermission } = require('../middleware/rbac');
const { logAudit } = require('../utils/audit');
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(requireAuth);

// ---- Departments ----------------------------------------------------------
router.get(
  '/departments',
  asyncHandler(async (req, res) => {
    const rows = await db
      .prepare(
        `SELECT d.*, m.full_name as manager_name,
           (SELECT COUNT(*) FROM employees e WHERE e.department_id = d.id AND e.deleted_at IS NULL) as employee_count
         FROM departments d
         LEFT JOIN employees m ON m.id = d.manager_id
         WHERE d.deleted_at IS NULL ORDER BY d.name`
      )
      .all();
    res.json(rows);
  })
);

router.post(
  '/departments',
  requirePermission('organization.manage'),
  asyncHandler(async (req, res) => {
    const data = departmentSchema.parse(req.body);
    const id = newId();
    const ts = nowIso();
    await db.prepare(
      'INSERT INTO departments (id, name, description, manager_id, created_at, updated_at) VALUES (?,?,?,?,?,?)'
    ).run(id, data.name, data.description ?? null, data.managerId ?? null, ts, ts);
    await logAudit({ userId: req.user.id, action: 'department_create', objectType: 'department', objectId: id, req });
    res.status(201).json({ id, ...data });
  })
);

router.put(
  '/departments/:id',
  requirePermission('organization.manage'),
  asyncHandler(async (req, res) => {
    const data = departmentSchema.partial().parse(req.body);
    const existing = await db.prepare('SELECT * FROM departments WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
    if (!existing) throw new ApiError(404, 'Department not found');
    await db.prepare(
      'UPDATE departments SET name = COALESCE(?, name), description = COALESCE(?, description), manager_id = COALESCE(?, manager_id), updated_at = ? WHERE id = ?'
    ).run(data.name ?? null, data.description ?? null, data.managerId ?? null, nowIso(), req.params.id);
    await logAudit({ userId: req.user.id, action: 'department_update', objectType: 'department', objectId: req.params.id, req });
    res.json({ ok: true });
  })
);

router.delete(
  '/departments/:id',
  requirePermission('organization.manage'),
  asyncHandler(async (req, res) => {
    await db.prepare('UPDATE departments SET deleted_at = ? WHERE id = ?').run(nowIso(), req.params.id);
    await logAudit({ userId: req.user.id, action: 'department_delete', objectType: 'department', objectId: req.params.id, req });
    res.json({ ok: true });
  })
);

// ---- Positions --------------------------------------------------------
router.get(
  '/positions',
  asyncHandler(async (req, res) => {
    const rows = await db
      .prepare(
        `SELECT p.*, d.name as department_name FROM positions p
         LEFT JOIN departments d ON d.id = p.department_id ORDER BY p.title`
      )
      .all();
    res.json(rows);
  })
);

router.post(
  '/positions',
  requirePermission('organization.manage'),
  asyncHandler(async (req, res) => {
    const { title, departmentId } = req.body;
    if (!title) throw new ApiError(400, 'title is required');
    const id = newId();
    await db.prepare('INSERT INTO positions (id, title, department_id, created_at) VALUES (?,?,?,?)').run(
      id,
      title,
      departmentId ?? null,
      nowIso()
    );
    await logAudit({ userId: req.user.id, action: 'position_create', objectType: 'position', objectId: id, req });
    res.status(201).json({ id, title, departmentId });
  })
);

// ---- Locations (with geofence config) --------------------------------------
router.get(
  '/locations',
  asyncHandler(async (req, res) => {
    res.json(await db.prepare('SELECT * FROM locations ORDER BY name').all());
  })
);

router.post(
  '/locations',
  requirePermission('organization.manage'),
  asyncHandler(async (req, res) => {
    const { name, address, latitude, longitude, radiusMeters } = req.body;
    if (!name || latitude == null || longitude == null) {
      throw new ApiError(400, 'name, latitude, longitude are required');
    }
    const id = newId();
    await db.prepare(
      'INSERT INTO locations (id, name, address, latitude, longitude, radius_meters) VALUES (?,?,?,?,?,?)'
    ).run(id, name, address ?? null, latitude, longitude, radiusMeters ?? 100);
    await logAudit({ userId: req.user.id, action: 'location_create', objectType: 'location', objectId: id, req });
    res.status(201).json({ id, name, address, latitude, longitude, radiusMeters: radiusMeters ?? 100 });
  })
);

router.put(
  '/locations/:id',
  requirePermission('organization.manage'),
  asyncHandler(async (req, res) => {
    const { name, address, latitude, longitude, radiusMeters } = req.body;
    await db.prepare(
      `UPDATE locations SET name = COALESCE(?,name), address = COALESCE(?,address),
       latitude = COALESCE(?,latitude), longitude = COALESCE(?,longitude), radius_meters = COALESCE(?,radius_meters)
       WHERE id = ?`
    ).run(name ?? null, address ?? null, latitude ?? null, longitude ?? null, radiusMeters ?? null, req.params.id);
    await logAudit({ userId: req.user.id, action: 'location_update', objectType: 'location', objectId: req.params.id, req });
    res.json({ ok: true });
  })
);

// ---- Shifts -----------------------------------------------------------
router.get(
  '/shifts',
  asyncHandler(async (req, res) => {
    res.json(await db.prepare('SELECT * FROM shifts ORDER BY start_time').all());
  })
);

router.post(
  '/shifts',
  requirePermission('organization.manage'),
  asyncHandler(async (req, res) => {
    const { name, startTime, endTime, gracePeriodMinutes } = req.body;
    if (!name || !startTime || !endTime) throw new ApiError(400, 'name, startTime, endTime required');
    const id = newId();
    await db.prepare(
      'INSERT INTO shifts (id, name, start_time, end_time, grace_period_minutes) VALUES (?,?,?,?,?)'
    ).run(id, name, startTime, endTime, gracePeriodMinutes ?? 15);
    await logAudit({ userId: req.user.id, action: 'shift_create', objectType: 'shift', objectId: id, req });
    res.status(201).json({ id, name, startTime, endTime, gracePeriodMinutes: gracePeriodMinutes ?? 15 });
  })
);

// Bulk-assign a shift to many employees at once (spec #10).
router.post(
  '/shifts/:id/assign',
  requirePermission('organization.manage'),
  asyncHandler(async (req, res) => {
    const { employeeIds } = req.body;
    if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
      throw new ApiError(400, 'employeeIds array required');
    }
    const tx = db.transaction(async (tdb, ids) => {
      const stmt = tdb.prepare('UPDATE employees SET shift_id = ?, updated_at = ? WHERE id = ?');
      for (const empId of ids) await stmt.run(req.params.id, nowIso(), empId);
    });
    await tx(employeeIds);
    await logAudit({
      userId: req.user.id,
      action: 'shift_bulk_assign',
      objectType: 'shift',
      objectId: req.params.id,
      req,
      metadata: { count: employeeIds.length },
    });
    res.json({ ok: true, updated: employeeIds.length });
  })
);

// ---- Organization chart -------------------------------------------------
router.get(
  '/org-chart',
  asyncHandler(async (req, res) => {
    const employees = await db
      .prepare(
        `SELECT e.id, e.full_name, e.manager_id, e.photo_url, p.title as position_title, d.name as department_name
         FROM employees e
         LEFT JOIN positions p ON p.id = e.position_id
         LEFT JOIN departments d ON d.id = e.department_id
         WHERE e.deleted_at IS NULL AND e.status = 'active'`
      )
      .all();
    res.json(employees);
  })
);

// ---- Employment history (onboarding/promotion/transfer/offboarding) -------

router.get(
  '/employees/:id/history',
  asyncHandler(async (req, res) => {
    const isSelf = req.user.employeeId === req.params.id;
    if (!isSelf && !['super_admin', 'hr', 'manager'].includes(req.user.role)) {
      throw new ApiError(403, 'Forbidden');
    }
    const rows = await db
      .prepare(
        `SELECT h.*, fd.name as from_department_name, td.name as to_department_name,
                fp.title as from_position_title, tp.title as to_position_title
         FROM employment_history h
         LEFT JOIN departments fd ON fd.id = h.from_department_id
         LEFT JOIN departments td ON td.id = h.to_department_id
         LEFT JOIN positions fp ON fp.id = h.from_position_id
         LEFT JOIN positions tp ON tp.id = h.to_position_id
         WHERE h.employee_id = ? ORDER BY h.effective_date DESC`
      )
      .all(req.params.id);
    res.json(rows);
  })
);

router.post(
  '/employees/:id/history',
  requirePermission('employees.manage'),
  asyncHandler(async (req, res) => {
    const { type, toDepartmentId, toPositionId, note, effectiveDate } = req.body;
    if (!['onboarding', 'promotion', 'transfer', 'offboarding', 'contract_change', 'status_change'].includes(type)) {
      throw new ApiError(400, 'Invalid history type');
    }
    const employee = await db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
    if (!employee) throw new ApiError(404, 'Employee not found');

    const id = newId();
    await db.prepare(
      `INSERT INTO employment_history (id, employee_id, type, from_department_id, to_department_id, from_position_id, to_position_id, note, effective_date, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id, employee.id, type, employee.department_id, toDepartmentId ?? employee.department_id,
      employee.position_id, toPositionId ?? employee.position_id, note ?? null,
      effectiveDate || nowIso(), req.user.id, nowIso()
    );

    // Promotion/transfer actually moves the employee's current department/position;
    // onboarding/offboarding update status.
    if (type === 'promotion' || type === 'transfer') {
      await db.prepare('UPDATE employees SET department_id = COALESCE(?, department_id), position_id = COALESCE(?, position_id), updated_at = ? WHERE id = ?').run(
        toDepartmentId ?? null, toPositionId ?? null, nowIso(), employee.id
      );
    } else if (type === 'offboarding') {
      await db.prepare("UPDATE employees SET status = 'resigned', end_date = ?, updated_at = ? WHERE id = ?").run(
        effectiveDate || nowIso().slice(0, 10), nowIso(), employee.id
      );
    } else if (type === 'onboarding') {
      await db.prepare("UPDATE employees SET status = 'active', updated_at = ? WHERE id = ?").run(nowIso(), employee.id);
    }

    await logAudit({ userId: req.user.id, action: `employee_${type}`, objectType: 'employee', objectId: employee.id, req, metadata: { note } });
    res.status(201).json({ id });
  })
);

// ---- Weekly/monthly schedule assignment ------------------------------------

router.get(
  '/schedules',
  asyncHandler(async (req, res) => {
    const { from, to, employeeId } = req.query;
    const where = ['s.date >= @from', 's.date <= @to'];
    const params = { from: from || '0000-01-01', to: to || '9999-12-31' };
    if (employeeId) { where.push('s.employee_id = @employeeId'); params.employeeId = employeeId; }
    else if (req.user.role === 'employee') { where.push('s.employee_id = @employeeId'); params.employeeId = req.user.employeeId; }
    const rows = await db
      .prepare(
        `SELECT s.*, e.full_name, e.employee_code, sh.name as shift_name, sh.start_time, sh.end_time
         FROM schedules s
         JOIN employees e ON e.id = s.employee_id
         JOIN shifts sh ON sh.id = s.shift_id
         WHERE ${where.join(' AND ')} ORDER BY s.date, e.full_name`
      )
      .all(params);
    res.json(rows);
  })
);

// Assign a shift to many employees across a date range in one call (spec's
// "jadwal mingguan/bulanan" + "shift rotation" bulk-assignment need).
router.post(
  '/schedules/bulk',
  requirePermission('organization.manage'),
  asyncHandler(async (req, res) => {
    const { employeeIds, shiftId, dates } = req.body;
    if (!Array.isArray(employeeIds) || !employeeIds.length) throw new ApiError(400, 'employeeIds required');
    if (!shiftId) throw new ApiError(400, 'shiftId required');
    if (!Array.isArray(dates) || !dates.length) throw new ApiError(400, 'dates array required');

    const tx = db.transaction(async (tdb, empIds, dateList) => {
      const upsert = tdb.prepare(
        `INSERT INTO schedules (id, employee_id, shift_id, date) VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE shift_id = VALUES(shift_id)`
      );
      let count = 0;
      for (const empId of empIds) {
        for (const date of dateList) {
          await upsert.run(newId(), empId, shiftId, date);
          count += 1;
        }
      }
      return count;
    });
    const count = await tx(employeeIds, dates);
    await logAudit({ userId: req.user.id, action: 'schedule_bulk_assign', req, metadata: { employeeCount: employeeIds.length, dateCount: dates.length } });
    res.json({ ok: true, assignmentsWritten: count });
  })
);

module.exports = router;
