// Tests run against a real, shared MySQL/MariaDB database (employeehub_test
// by default) rather than a fresh temp file per run like the old SQLite
// setup - MySQL has no equivalent of "just create a throwaway file". Every
// test file's seedMinimal() truncates all tables first, so tests stay
// isolated from each other regardless of run order, but they do require an
// actual reachable database (see README "Testing").
process.env.JWT_ACCESS_SECRET = 'test_access_secret';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret';
process.env.JWT_ACCESS_EXPIRES = '15m';
process.env.JWT_REFRESH_EXPIRES = '7d';
process.env.NODE_ENV = 'test';
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_PORT = process.env.DB_PORT || '3306';
process.env.DB_USER = process.env.DB_USER || 'employeehub';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'employeehub_dev_pw';
process.env.DB_NAME = process.env.DB_NAME_TEST || 'employeehub_test';

const fs = require('fs');
const path = require('path');
const db = require('../src/db');

const ALL_TABLES = [
  'password_reset_tokens', 'login_history', 'notifications', 'documents', 'employment_history',
  'leave_requests', 'leave_balances', 'overtime_requests', 'attendance', 'schedules',
  'shift_rotation_assignments', 'shift_rotations', 'qr_codes', 'announcements', 'audit_logs',
  'role_permissions', 'permissions', 'users', 'employees', 'positions', 'departments',
  'locations', 'shifts', 'leave_types', 'holidays', 'settings',
];

async function ensureSchema() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf8');
  for (const stmt of sql.split(/;\s*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean)) {
    try {
      await db.exec(stmt);
    } catch (err) {
      if (!/already exists|Duplicate (key name|column name)|Duplicate key on write or update/i.test(err.message)) throw err;
    }
  }
}

async function truncateAll() {
  await db.exec('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of ALL_TABLES) {
    await db.exec(`TRUNCATE TABLE ${table}`);
  }
  await db.exec('SET FOREIGN_KEY_CHECKS = 1');
}

const { seedPermissions } = require('../src/services/permissions');
const { newId, nowIso } = require('../src/utils/id');
const { hashPassword } = require('../src/utils/password');

async function seedMinimal() {
  await ensureSchema();
  await truncateAll();
  await seedPermissions(); // also loads the in-memory permission cache fresh for this test file

  const ts = nowIso();
  await db.prepare("INSERT INTO settings (id, company_name) VALUES ('singleton','Test Co')").run();

  const locId = newId();
  await db.prepare('INSERT INTO locations (id, name, latitude, longitude, radius_meters) VALUES (?,?,?,?,?)').run(
    locId, 'Test Office', -7.9797, 112.6304, 100
  );

  const shiftId = newId();
  await db.prepare('INSERT INTO shifts (id, name, start_time, end_time, grace_period_minutes) VALUES (?,?,?,?,?)').run(
    shiftId, 'Pagi', '08:00', '17:00', 15
  );

  const deptId = newId();
  await db.prepare('INSERT INTO departments (id, name, created_at, updated_at) VALUES (?,?,?,?)').run(deptId, 'Engineering', ts, ts);

  const empId = newId();
  await db.prepare(
    `INSERT INTO employees (id, employee_code, full_name, department_id, location_id, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(empId, 'EMP0001', 'Test Employee', deptId, locId, 'active', ts, ts);

  const managerEmpId = newId();
  await db.prepare(
    `INSERT INTO employees (id, employee_code, full_name, department_id, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run(managerEmpId, 'EMP0002', 'Test Manager', deptId, 'active', ts, ts);
  await db.prepare('UPDATE employees SET manager_id = ? WHERE id = ?').run(managerEmpId, empId);

  const users = {};
  for (const [role, email, pass, employeeId] of [
    ['super_admin', 'admin@test.local', 'AdminPass1', null],
    ['hr', 'hr@test.local', 'HrPass1', null],
    ['manager', 'manager@test.local', 'MgrPass1', managerEmpId],
    ['employee', 'employee@test.local', 'EmpPass1', empId],
  ]) {
    const hash = await hashPassword(pass);
    const id = newId();
    await db.prepare('INSERT INTO users (id, email, password, role, employee_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(
      id, email, hash, role, employeeId, ts, ts
    );
    users[role] = { id, email, password: pass, employeeId };
  }

  return { locationId: locId, shiftId, departmentId: deptId, employeeId: empId, managerEmployeeId: managerEmpId, users };
}

async function cleanup() {
  await db.pool.end();
}

module.exports = { db, seedMinimal, cleanup };
