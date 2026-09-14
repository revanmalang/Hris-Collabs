const express = require('express');
const db = require('../db');
const { newId, nowIso, todayStr } = require('../utils/id');
const { checkInSchema } = require('../utils/validators');
const { requireAuth } = require('../middleware/auth');
const { requireRole, requirePermission } = require('../middleware/rbac');
const { isWithinGeofence } = require('../utils/geofence');
const { logAudit } = require('../utils/audit');
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const { emitAttendanceEvent, emitNotification, emitDashboardStats } = require('../realtime/socket');
const { getDashboardStats } = require('../services/dashboardStats');

const router = express.Router();
router.use(requireAuth);

async function getSettings() {
  return db.prepare("SELECT * FROM settings WHERE id = 'singleton'").get();
}

async function employeeForUser(req) {
  if (!req.user.employeeId) throw new ApiError(400, 'This account is not linked to an employee record');
  return db.prepare('SELECT * FROM employees WHERE id = ?').get(req.user.employeeId);
}

async function broadcastStatsUpdate() {
  emitDashboardStats(await getDashboardStats());
}

async function doCheckIn(req, res) {
  const data = checkInSchema.parse(req.body);
  const employee = await employeeForUser(req);
  const settings = await getSettings();

  if (settings.gps_mode === 'required' && (data.latitude == null || data.longitude == null)) {
    throw new ApiError(400, 'Location is required to check in');
  }

  const date = todayStr();
  const existing = await db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date = ?').get(employee.id, date);
  if (existing && existing.check_in_at) {
    throw new ApiError(409, 'Already checked in today');
  }

  // Server-side geofence validation - never trust client-side distance claims.
  let location = null;
  let geofenceDistance = null;
  if (employee.location_id) {
    location = await db.prepare('SELECT * FROM locations WHERE id = ?').get(employee.location_id);
  }
  if (location && data.latitude != null && data.longitude != null && settings.gps_mode !== 'disabled') {
    const check = isWithinGeofence(data.latitude, data.longitude, location);
    geofenceDistance = check.distance;
    if (!check.ok) {
      throw new ApiError(
        403,
        `You are ${Math.round(check.distance)}m from ${location.name} (allowed radius ${location.radius_meters}m)`
      );
    }
  }

  // Lateness computed server-side from the assigned shift + grace period.
  const shift = employee.shift_id ? await db.prepare('SELECT * FROM shifts WHERE id = ?').get(employee.shift_id) : null;
  const now = new Date(); // server clock is the only source of truth for timestamps
  let isLate = false;
  let lateMinutes = 0;
  if (shift) {
    const [h, m] = shift.start_time.split(':').map(Number);
    const shiftStart = new Date(now);
    shiftStart.setHours(h, m, 0, 0);
    const graceMs = (shift.grace_period_minutes || 0) * 60000;
    if (now.getTime() > shiftStart.getTime() + graceMs) {
      isLate = true;
      lateMinutes = Math.round((now.getTime() - shiftStart.getTime()) / 60000);
    }
  }

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const device = req.headers['user-agent'];
  const status = isLate ? 'late' : 'present';

  let photoUrl = null;
  if (data.photoDataUrl && data.photoDataUrl.startsWith('data:image')) {
    const fs = require('fs');
    const path = require('path');
    const matches = data.photoDataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
    if (matches) {
      const dir = path.join(__dirname, '..', '..', 'uploads', 'attendance');
      fs.mkdirSync(dir, { recursive: true });
      const filename = `${newId()}.${matches[1]}`;
      fs.writeFileSync(path.join(dir, filename), Buffer.from(matches[2], 'base64'));
      photoUrl = `/uploads/attendance/${filename}`;
    }
  }

  if (existing) {
    await db.prepare(
      `UPDATE attendance SET check_in_at=?, check_in_lat=?, check_in_lng=?, check_in_ip=?, check_in_device=?,
       check_in_photo_url=?, status=?, is_late=?, late_minutes=?, location_id=?, updated_at=? WHERE id=?`
    ).run(
      now.toISOString(), data.latitude ?? null, data.longitude ?? null, ip, device,
      photoUrl, status, isLate ? 1 : 0, lateMinutes, employee.location_id ?? null, nowIso(), existing.id
    );
  } else {
    await db.prepare(
      `INSERT INTO attendance (id, employee_id, date, check_in_at, check_in_lat, check_in_lng, check_in_ip,
        check_in_device, check_in_photo_url, status, is_late, late_minutes, location_id, source, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'app', ?, ?)`
    ).run(
      newId(), employee.id, date, now.toISOString(), data.latitude ?? null, data.longitude ?? null, ip, device,
      photoUrl, status, isLate ? 1 : 0, lateMinutes, employee.location_id ?? null, nowIso(), nowIso()
    );
  }

  await logAudit({ userId: req.user.id, action: 'check_in', objectType: 'attendance', objectId: employee.id, req, metadata: { status, lateMinutes, geofenceDistance } });

  const notif = { title: isLate ? 'Checked in (late)' : 'Checked in', message: `${employee.full_name} checked in at ${now.toLocaleTimeString()}`, type: 'checkin' };
  const notifId = newId();
  await db.prepare('INSERT INTO notifications (id, employee_id, title, message, type, created_at) VALUES (?,?,?,?,?,?)')
    .run(notifId, employee.id, notif.title, notif.message, notif.type, nowIso());
  emitNotification(employee.id, { id: notifId, ...notif, createdAt: nowIso() });

  emitAttendanceEvent({ type: 'check_in', employeeId: employee.id, employeeName: employee.full_name, status, time: now.toISOString() });
  await broadcastStatsUpdate();

  res.json({ ok: true, status, isLate, lateMinutes, checkInAt: now.toISOString() });
}

// POST /api/attendance/check-in
router.post('/check-in', asyncHandler(async (req, res) => await doCheckIn(req, res)));

// POST /api/attendance/check-out
router.post(
  '/check-out',
  asyncHandler(async (req, res) => {
    const data = checkInSchema.parse(req.body);
    const employee = await employeeForUser(req);
    const date = todayStr();
    const existing = await db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date = ?').get(employee.id, date);
    if (!existing || !existing.check_in_at) throw new ApiError(400, 'You have not checked in today');
    if (existing.check_out_at) throw new ApiError(409, 'Already checked out today');

    const now = new Date();
    const workedMinutes = Math.round((now.getTime() - new Date(existing.check_in_at).getTime()) / 60000);
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const device = req.headers['user-agent'];

    await db.prepare(
      `UPDATE attendance SET check_out_at=?, check_out_lat=?, check_out_lng=?, check_out_ip=?, check_out_device=?,
       status='completed', worked_minutes=?, updated_at=? WHERE id=?`
    ).run(now.toISOString(), data.latitude ?? null, data.longitude ?? null, ip, device, workedMinutes, nowIso(), existing.id);

    await logAudit({ userId: req.user.id, action: 'check_out', objectType: 'attendance', objectId: employee.id, req, metadata: { workedMinutes } });

    const notifId = newId();
    const notif = { title: 'Checked out', message: `${employee.full_name} checked out — worked ${(workedMinutes / 60).toFixed(1)}h`, type: 'checkin' };
    await db.prepare('INSERT INTO notifications (id, employee_id, title, message, type, created_at) VALUES (?,?,?,?,?,?)')
      .run(notifId, employee.id, notif.title, notif.message, notif.type, nowIso());
    emitNotification(employee.id, { id: notifId, ...notif, createdAt: nowIso() });

    emitAttendanceEvent({ type: 'check_out', employeeId: employee.id, employeeName: employee.full_name, status: 'completed', time: now.toISOString() });
    await broadcastStatsUpdate();

    res.json({ ok: true, workedMinutes, checkOutAt: now.toISOString() });
  })
);

// GET /api/attendance/today - the current user's own status for today
router.get(
  '/today',
  asyncHandler(async (req, res) => {
    const employee = await employeeForUser(req);
    const row = await db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date = ?').get(employee.id, todayStr());
    res.json(row || null);
  })
);

// GET /api/attendance/live - HR/manager live monitor
router.get(
  '/live',
  requirePermission('attendance.live_monitor'),
  asyncHandler(async (req, res) => {
    const { department, position, location, shift, status, q } = req.query;
    const date = todayStr();
    const where = ['e.deleted_at IS NULL', "e.status = 'active'"];
    const params = { date };
    if (department) { where.push('e.department_id = @department'); params.department = department; }
    if (position) { where.push('e.position_id = @position'); params.position = position; }
    if (location) { where.push('e.location_id = @location'); params.location = location; }
    if (shift) { where.push('e.shift_id = @shift'); params.shift = shift; }
    if (q) { where.push('(e.full_name LIKE @q OR e.employee_code LIKE @q)'); params.q = `%${q}%`; }
    if (status) { where.push("COALESCE(a.status, 'absent') = @status"); params.status = status; }

    const rows = (await db
      .prepare(
        `SELECT e.id as employee_id, e.employee_code, e.full_name, e.photo_url,
                d.name as department_name, l.name as location_name,
                a.status, a.check_in_at, a.check_out_at, a.worked_minutes, a.is_late,
                a.check_in_lat, a.check_in_lng, a.check_in_device
         FROM employees e
         LEFT JOIN departments d ON d.id = e.department_id
         LEFT JOIN locations l ON l.id = e.location_id
         LEFT JOIN attendance a ON a.employee_id = e.id AND a.date = @date
         WHERE ${where.join(' AND ')}
         ORDER BY e.full_name`
      )
      .all(params))
      .map((r) => ({ ...r, status: r.status || 'absent' }));

    res.json(rows);
  })
);

// GET /api/attendance/history - filters, pagination, sorting
router.get(
  '/history',
  asyncHandler(async (req, res) => {
    const isSelfOnly = req.user.role === 'employee';
    const { employeeId, department, status, from, to, page = 1, pageSize = 20, sort = 'date_desc' } = req.query;

    const where = [];
    const params = {};
    if (isSelfOnly) {
      where.push('a.employee_id = @employeeId');
      params.employeeId = req.user.employeeId;
    } else if (employeeId) {
      where.push('a.employee_id = @employeeId');
      params.employeeId = employeeId;
    }
    if (department) { where.push('e.department_id = @department'); params.department = department; }
    if (status) { where.push('a.status = @status'); params.status = status; }
    if (from) { where.push('a.date >= @from'); params.from = from; }
    if (to) { where.push('a.date <= @to'); params.to = to; }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const orderMap = { date_desc: 'a.date DESC', date_asc: 'a.date ASC', name_asc: 'e.full_name ASC' };
    const orderSql = orderMap[sort] || orderMap.date_desc;

    const totalRow = await db
      .prepare(`SELECT COUNT(*) as c FROM attendance a JOIN employees e ON e.id = a.employee_id ${whereSql}`)
      .get(params);

    const limit = Math.min(Number(pageSize) || 20, 200);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const rows = await db
      .prepare(
        `SELECT a.*, e.full_name, e.employee_code, d.name as department_name, l.name as location_name
         FROM attendance a
         JOIN employees e ON e.id = a.employee_id
         LEFT JOIN departments d ON d.id = e.department_id
         LEFT JOIN locations l ON l.id = a.location_id
         ${whereSql}
         ORDER BY ${orderSql}
         LIMIT @limit OFFSET @offset`
      )
      .all({ ...params, limit, offset });

    res.json({ data: rows, total: totalRow.c, page: Number(page), pageSize: limit });
  })
);

// Manual correction by HR (with mandatory note, captured in audit log)
router.put(
  '/:id/correct',
  requirePermission('attendance.correct'),
  asyncHandler(async (req, res) => {
    const { status, notes, checkInAt, checkOutAt } = req.body;
    const existing = await db.prepare('SELECT * FROM attendance WHERE id = ?').get(req.params.id);
    if (!existing) throw new ApiError(404, 'Attendance record not found');
    await db.prepare(
      `UPDATE attendance SET status = COALESCE(?, status), notes = COALESCE(?, notes),
       check_in_at = COALESCE(?, check_in_at), check_out_at = COALESCE(?, check_out_at), updated_at = ? WHERE id = ?`
    ).run(status ?? null, notes ?? null, checkInAt ?? null, checkOutAt ?? null, nowIso(), req.params.id);
    await logAudit({
      userId: req.user.id,
      action: 'attendance_correction',
      objectType: 'attendance',
      objectId: req.params.id,
      req,
      metadata: { status, notes },
    });
    await broadcastStatsUpdate();
    res.json({ ok: true });
  })
);

// ---- QR attendance --------------------------------------------------------

// HR generates a short-lived QR token bound to a location.
router.post(
  '/qr/generate',
  requirePermission('attendance.qr_generate'),
  asyncHandler(async (req, res) => {
    const { locationId, ttlSeconds = 60 } = req.body;
    const location = await db.prepare('SELECT * FROM locations WHERE id = ?').get(locationId);
    if (!location) throw new ApiError(404, 'Location not found');
    const token = newId();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    await db.prepare('INSERT INTO qr_codes (id, token, location_id, expires_at, created_at) VALUES (?,?,?,?,?)').run(
      newId(), token, locationId, expiresAt, nowIso()
    );
    res.json({ token, expiresAt, locationName: location.name });
  })
);

// Employee scans QR -> submits token; server validates token+expiry+geofence, then check-in.
router.post(
  '/qr/scan',
  asyncHandler(async (req, res) => {
    const { token, latitude, longitude } = req.body;
    const qr = await db.prepare('SELECT * FROM qr_codes WHERE token = ?').get(token);
    if (!qr) throw new ApiError(400, 'Invalid QR code');
    if (new Date(qr.expires_at).getTime() < Date.now()) throw new ApiError(400, 'QR code expired');

    const location = await db.prepare('SELECT * FROM locations WHERE id = ?').get(qr.location_id);
    if (latitude != null && longitude != null) {
      const check = isWithinGeofence(latitude, longitude, location);
      if (!check.ok) throw new ApiError(403, `Too far from ${location.name} (${Math.round(check.distance)}m away)`);
    }

    req.body = { latitude, longitude };
    await doCheckIn(req, res);
  })
);

module.exports = router;
