const express = require('express');
const db = require('../db');
const { newId, nowIso } = require('../utils/id');
const { employeeSchema } = require('../utils/validators');
const { hashPassword } = require('../utils/password');
const { requireAuth } = require('../middleware/auth');
const { requireRole, requirePermission, maskEmployee } = require('../middleware/rbac');
const { uploadPhoto } = require('../middleware/upload');
const { logAudit } = require('../utils/audit');
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(requireAuth);

const SELECT_EMPLOYEE = `
  SELECT e.*, d.name as department_name, p.title as position_title,
         l.name as location_name, s.name as shift_name, s.start_time, s.end_time,
         m.full_name as manager_name
  FROM employees e
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN positions p ON p.id = e.position_id
  LEFT JOIN locations l ON l.id = e.location_id
  LEFT JOIN shifts s ON s.id = e.shift_id
  LEFT JOIN employees m ON m.id = e.manager_id
`;

// GET /api/employees - directory with search/filter/pagination
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { q, department, position, status, page = 1, pageSize = 20 } = req.query;
    const where = ['e.deleted_at IS NULL'];
    const params = {};
    if (q) {
      where.push('(e.full_name LIKE @q OR e.employee_code LIKE @q)');
      params.q = `%${q}%`;
    }
    if (department) {
      where.push('e.department_id = @department');
      params.department = department;
    }
    if (position) {
      where.push('e.position_id = @position');
      params.position = position;
    }
    if (status) {
      where.push('e.status = @status');
      params.status = status;
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const totalRow = await db
      .prepare(`SELECT COUNT(*) as c FROM employees e ${whereSql}`)
      .get(params);

    const limit = Math.min(Number(pageSize) || 20, 100);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const rows = await db
      .prepare(`${SELECT_EMPLOYEE} ${whereSql} ORDER BY e.full_name ASC LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit, offset });

    const masked = rows.map((r) => maskEmployee(r, req.user));
    res.json({ data: masked, total: totalRow.c, page: Number(page), pageSize: limit });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await db.prepare(`${SELECT_EMPLOYEE} WHERE e.id = ? AND e.deleted_at IS NULL`).get(req.params.id);
    if (!row) throw new ApiError(404, 'Employee not found');
    res.json(maskEmployee(row, req.user));
  })
);

router.get(
  '/:id/profile',
  asyncHandler(async (req, res) => {
    const employee = await db.prepare(`${SELECT_EMPLOYEE} WHERE e.id = ? AND e.deleted_at IS NULL`).get(req.params.id);
    if (!employee) throw new ApiError(404, 'Employee not found');

    const attendanceRecent = await db
      .prepare('SELECT * FROM attendance WHERE employee_id = ? ORDER BY date DESC LIMIT 30')
      .all(employee.id);
    const leaveHistory = await db
      .prepare('SELECT * FROM leave_requests WHERE employee_id = ? ORDER BY created_at DESC LIMIT 20')
      .all(employee.id);
    const overtimeHistory = await db
      .prepare('SELECT * FROM overtime_requests WHERE employee_id = ? ORDER BY created_at DESC LIMIT 20')
      .all(employee.id);
    const documents = await db.prepare('SELECT * FROM documents WHERE employee_id = ?').all(employee.id);
    const account = await db.prepare('SELECT id, email, role, is_active, must_change_pw FROM users WHERE employee_id = ?').get(employee.id);

    const stats = await db
      .prepare(
        `SELECT
           COUNT(*) as totalDays,
           SUM(CASE WHEN status IN ('present','late','working','completed') THEN 1 ELSE 0 END) as presentDays,
           SUM(CASE WHEN is_late = 1 THEN 1 ELSE 0 END) as lateDays,
           SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absentDays
         FROM attendance WHERE employee_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`
      )
      .get(employee.id);

    res.json({
      employee: maskEmployee(employee, req.user),
      attendanceRecent,
      leaveHistory,
      overtimeHistory,
      documents,
      stats,
      account: account || null,
    });
  })
);

router.post(
  '/',
  requirePermission('employees.manage'),
  asyncHandler(async (req, res) => {
    const data = employeeSchema.parse(req.body);
    const id = newId();
    const ts = nowIso();
    await db.prepare(
      `INSERT INTO employees (
        id, employee_code, full_name, nickname, birth_place, birth_date, gender, address, city, province,
        phone, email, marital_status, emergency_contact_name, emergency_contact_phone,
        department_id, position_id, location_id, shift_id, manager_id,
        status, hire_date, end_date, contract_type, contract_number,
        npwp, bpjs_number, bank_account, created_at, updated_at
      ) VALUES (
        @id, @employeeCode, @fullName, @nickname, @birthPlace, @birthDate, @gender, @address, @city, @province,
        @phone, @email, @maritalStatus, @emergencyContactName, @emergencyContactPhone,
        @departmentId, @positionId, @locationId, @shiftId, @managerId,
        @status, @hireDate, @endDate, @contractType, @contractNumber,
        @npwp, @bpjsNumber, @bankAccount, @createdAt, @updatedAt
      )`
    ).run({
      id,
      ...data,
      nickname: data.nickname ?? null,
      birthPlace: data.birthPlace ?? null,
      birthDate: data.birthDate ?? null,
      gender: data.gender ?? null,
      address: data.address ?? null,
      city: data.city ?? null,
      province: data.province ?? null,
      phone: data.phone ?? null,
      email: data.email ?? null,
      maritalStatus: data.maritalStatus ?? null,
      emergencyContactName: data.emergencyContactName ?? null,
      emergencyContactPhone: data.emergencyContactPhone ?? null,
      departmentId: data.departmentId ?? null,
      positionId: data.positionId ?? null,
      locationId: data.locationId ?? null,
      shiftId: data.shiftId ?? null,
      managerId: data.managerId ?? null,
      status: data.status ?? 'active',
      hireDate: data.hireDate ?? null,
      endDate: data.endDate ?? null,
      contractType: data.contractType ?? null,
      contractNumber: data.contractNumber ?? null,
      npwp: data.npwp ?? null,
      bpjsNumber: data.bpjsNumber ?? null,
      bankAccount: data.bankAccount ?? null,
      createdAt: ts,
      updatedAt: ts,
    });
    await logAudit({ userId: req.user.id, action: 'employee_create', objectType: 'employee', objectId: id, req });
    const created = await db.prepare(`${SELECT_EMPLOYEE} WHERE e.id = ?`).get(id);
    res.status(201).json(maskEmployee(created, req.user));
  })
);

router.put(
  '/:id',
  requirePermission('employees.manage'),
  asyncHandler(async (req, res) => {
    const existing = await db.prepare('SELECT * FROM employees WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
    if (!existing) throw new ApiError(404, 'Employee not found');
    const data = employeeSchema.partial().parse(req.body);

    const fields = Object.keys(data);
    if (fields.length === 0) return res.json(maskEmployee(existing, req.user));

    const colMap = {
      employeeCode: 'employee_code', fullName: 'full_name', nickname: 'nickname',
      birthPlace: 'birth_place', birthDate: 'birth_date', gender: 'gender', address: 'address',
      city: 'city', province: 'province', phone: 'phone', email: 'email', maritalStatus: 'marital_status',
      emergencyContactName: 'emergency_contact_name', emergencyContactPhone: 'emergency_contact_phone',
      departmentId: 'department_id', positionId: 'position_id', locationId: 'location_id',
      shiftId: 'shift_id', managerId: 'manager_id', status: 'status', hireDate: 'hire_date',
      endDate: 'end_date', contractType: 'contract_type', contractNumber: 'contract_number',
      npwp: 'npwp', bpjsNumber: 'bpjs_number', bankAccount: 'bank_account',
    };
    const setSql = fields.map((f) => `${colMap[f]} = @${f}`).join(', ');
    await db.prepare(`UPDATE employees SET ${setSql}, updated_at = @updatedAt WHERE id = @id`).run({
      ...data,
      id: req.params.id,
      updatedAt: nowIso(),
    });
    await logAudit({
      userId: req.user.id,
      action: 'employee_update',
      objectType: 'employee',
      objectId: req.params.id,
      req,
      metadata: { fields },
    });
    const updated = await db.prepare(`${SELECT_EMPLOYEE} WHERE e.id = ?`).get(req.params.id);
    res.json(maskEmployee(updated, req.user));
  })
);

router.delete(
  '/:id',
  requirePermission('employees.manage'),
  asyncHandler(async (req, res) => {
    const existing = await db.prepare('SELECT * FROM employees WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
    if (!existing) throw new ApiError(404, 'Employee not found');
    await db.prepare('UPDATE employees SET deleted_at = ?, status = ? WHERE id = ?').run(
      nowIso(),
      'terminated',
      req.params.id
    );
    // A terminated employee must lose system access immediately - without
    // this, deactivating someone in the directory left their login (and
    // whatever role it held) fully able to sign in.
    const linkedUser = await db.prepare('SELECT id FROM users WHERE employee_id = ?').get(req.params.id);
    if (linkedUser) {
      await db.prepare('UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?').run(nowIso(), linkedUser.id);
    }
    await logAudit({ userId: req.user.id, action: 'employee_delete', objectType: 'employee', objectId: req.params.id, req, metadata: { accountDeactivated: !!linkedUser } });
    res.json({ ok: true });
  })
);

router.post(
  '/:id/photo',
  requirePermission('employees.manage'),
  uploadPhoto.single('photo'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, 'No file uploaded');
    const url = `/uploads/photos/${req.file.filename}`;
    await db.prepare('UPDATE employees SET photo_url = ?, updated_at = ? WHERE id = ?').run(url, nowIso(), req.params.id);
    await logAudit({ userId: req.user.id, action: 'employee_photo_update', objectType: 'employee', objectId: req.params.id, req });
    res.json({ photoUrl: url });
  })
);

// Bulk import via array of employee objects (client parses the Excel file with SheetJS
// and posts JSON rows here — keeps parsing logic and validation in one place).
router.post(
  '/bulk-import',
  requirePermission('employees.manage'),
  asyncHandler(async (req, res) => {
    const rows = req.body.rows;
    if (!Array.isArray(rows) || rows.length === 0) throw new ApiError(400, 'No rows provided');

    const results = { created: 0, failed: [] };
    const tx = db.transaction(async (tdb, items) => {
      const insert = tdb.prepare(
        `INSERT INTO employees (id, employee_code, full_name, email, phone, department_id, position_id, status, hire_date, created_at, updated_at)
         VALUES (@id, @employeeCode, @fullName, @email, @phone, @departmentId, @positionId, 'active', @hireDate, @ts, @ts)`
      );
      for (const item of items) {
        try {
          await insert.run({
            id: newId(),
            employeeCode: item.employeeCode,
            fullName: item.fullName,
            email: item.email || null,
            phone: item.phone || null,
            departmentId: item.departmentId || null,
            positionId: item.positionId || null,
            hireDate: item.hireDate || null,
            ts: nowIso(),
          });
          results.created += 1;
        } catch (e) {
          results.failed.push({ row: item, error: e.message });
        }
      }
    });
    await tx(rows);
    await logAudit({ userId: req.user.id, action: 'employee_bulk_import', req, metadata: results });
    res.json(results);
  })
);

// HR-initiated password reset - there's no outbound email/SMS provider wired
// up, so this generates a one-time temporary password, shows it to the HR
// user exactly once in the response, and forces a change on next login.
router.post(
  '/:id/reset-password',
  requirePermission('employees.manage'),
  asyncHandler(async (req, res) => {
    const user = await db.prepare('SELECT * FROM users WHERE employee_id = ?').get(req.params.id);
    if (!user) throw new ApiError(404, 'No login account is linked to this employee');
    const tempPassword = `Reset${Math.random().toString(36).slice(2, 8)}${Math.floor(Math.random() * 90 + 10)}`;
    const hash = await hashPassword(tempPassword);
    await db.prepare('UPDATE users SET password = ?, must_change_pw = 1, updated_at = ? WHERE id = ?').run(
      hash,
      nowIso(),
      user.id
    );
    await logAudit({ userId: req.user.id, action: 'password_reset_by_hr', objectType: 'user', objectId: user.id, req });
    res.json({ ok: true, email: user.email, temporaryPassword: tempPassword });
  })
);

// Creates the login account for an employee who doesn't have one yet
// (adding an employee via "Tambah Karyawan" only creates their HR record -
// there's no login until this runs). Generates a one-time temporary
// password shown once, same pattern as reset-password. Role is
// deliberately restricted: employees.manage alone (which HR can hold via
// the permission matrix) can only create employee/manager accounts -
// creating an hr or super_admin account requires actually being
// super_admin, so a delegated permission can't be used to escalate
// privilege for someone else's login.
router.post(
  '/:id/account',
  requirePermission('employees.manage'),
  asyncHandler(async (req, res) => {
    const { email, role } = req.body;
    if (!email || !['employee', 'manager', 'hr', 'super_admin'].includes(role)) {
      throw new ApiError(400, 'A valid email and role are required');
    }
    if (['hr', 'super_admin'].includes(role) && req.user.role !== 'super_admin') {
      throw new ApiError(403, 'Only Super Admin can create an HR or Super Admin account');
    }

    const employee = await db.prepare('SELECT * FROM employees WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
    if (!employee) throw new ApiError(404, 'Employee not found');

    const existing = await db.prepare('SELECT id FROM users WHERE employee_id = ?').get(req.params.id);
    if (existing) throw new ApiError(409, 'This employee already has a login account');

    const emailTaken = await db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (emailTaken) throw new ApiError(409, 'This email is already used by another account');

    const tempPassword = `Welcome${Math.random().toString(36).slice(2, 8)}${Math.floor(Math.random() * 90 + 10)}`;
    const hash = await hashPassword(tempPassword);
    const id = newId();
    const ts = nowIso();
    await db.prepare(
      'INSERT INTO users (id, email, password, role, employee_id, must_change_pw, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?)'
    ).run(id, email.toLowerCase(), hash, role, req.params.id, ts, ts);

    await logAudit({ userId: req.user.id, action: 'account_create', objectType: 'user', objectId: id, req, metadata: { employeeId: req.params.id, role } });
    res.status(201).json({ ok: true, email: email.toLowerCase(), role, temporaryPassword: tempPassword });
  })
);

// Deactivating a login account revokes access without touching the
// employee's HR record - useful for a leave-without-pay situation, a
// suspected compromised account, etc. where the person is still employed.
// (Terminating the employee via DELETE /:id already cascades this
// automatically - see above.) Same privilege-escalation guard as account
// creation: only super_admin can deactivate/reactivate an hr or
// super_admin account. Nobody can deactivate their own account, to avoid
// an accidental self-lockout.
router.post(
  '/:id/account/deactivate',
  requirePermission('employees.manage'),
  asyncHandler(async (req, res) => {
    const account = await db.prepare('SELECT * FROM users WHERE employee_id = ?').get(req.params.id);
    if (!account) throw new ApiError(404, 'This employee has no login account');
    if (account.id === req.user.id) throw new ApiError(400, 'You cannot deactivate your own account');
    if (['hr', 'super_admin'].includes(account.role) && req.user.role !== 'super_admin') {
      throw new ApiError(403, 'Only Super Admin can deactivate an HR or Super Admin account');
    }
    await db.prepare('UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?').run(nowIso(), account.id);
    await logAudit({ userId: req.user.id, action: 'account_deactivate', objectType: 'user', objectId: account.id, req });
    res.json({ ok: true });
  })
);

router.post(
  '/:id/account/activate',
  requirePermission('employees.manage'),
  asyncHandler(async (req, res) => {
    const account = await db.prepare('SELECT * FROM users WHERE employee_id = ?').get(req.params.id);
    if (!account) throw new ApiError(404, 'This employee has no login account');
    if (['hr', 'super_admin'].includes(account.role) && req.user.role !== 'super_admin') {
      throw new ApiError(403, 'Only Super Admin can reactivate an HR or Super Admin account');
    }
    await db.prepare('UPDATE users SET is_active = 1, updated_at = ? WHERE id = ?').run(nowIso(), account.id);
    await logAudit({ userId: req.user.id, action: 'account_activate', objectType: 'user', objectId: account.id, req });
    res.json({ ok: true });
  })
);

module.exports = router;
