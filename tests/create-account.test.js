const request = require('supertest');
const { seedMinimal, cleanup, db } = require('./setup');
const { newId, nowIso } = require('../src/utils/id');

let app, fixtures, hrToken, adminToken;
let unlinkedEmployeeId;

beforeAll(async () => {
  app = require('../src/app');
  fixtures = await seedMinimal();
  hrToken = (await request(app).post('/api/auth/login').send({ email: 'hr@test.local', password: 'HrPass1' })).body.accessToken;
  adminToken = (await request(app).post('/api/auth/login').send({ email: 'admin@test.local', password: 'AdminPass1' })).body.accessToken;

  // An employee record with no linked login yet, mirroring what
  // "Tambah Karyawan" produces on its own.
  unlinkedEmployeeId = newId();
  const ts = nowIso();
  await db.prepare(
    'INSERT INTO employees (id, employee_code, full_name, department_id, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
  ).run(unlinkedEmployeeId, 'NOACCT1', 'No Account Yet', fixtures.departmentId, 'active', ts, ts);
});

afterAll(() => cleanup());

describe('Create login account for an employee', () => {
  test('employee profile reports no linked account beforehand', async () => {
    const res = await request(app)
      .get(`/api/employees/${unlinkedEmployeeId}/profile`)
      .set('Authorization', `Bearer ${hrToken}`);
    expect(res.status).toBe(200);
    expect(res.body.account).toBeNull();
  });

  test('HR can create an employee-role account and gets a one-time password', async () => {
    const res = await request(app)
      .post(`/api/employees/${unlinkedEmployeeId}/account`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ email: 'noaccount@test.local', role: 'employee' });
    expect(res.status).toBe(201);
    expect(res.body.temporaryPassword).toBeTruthy();

    const login = await request(app).post('/api/auth/login').send({ email: 'noaccount@test.local', password: res.body.temporaryPassword });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);
  });

  test('creating a second account for the same employee is rejected', async () => {
    const res = await request(app)
      .post(`/api/employees/${unlinkedEmployeeId}/account`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ email: 'another@test.local', role: 'employee' });
    expect(res.status).toBe(409);
  });

  test('HR cannot create an hr or super_admin account (privilege escalation guard)', async () => {
    const empId = newId();
    const ts = nowIso();
    await db.prepare(
      'INSERT INTO employees (id, employee_code, full_name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)'
    ).run(empId, 'NOACCT2', 'Second No Account', 'active', ts, ts);

    const asHr = await request(app)
      .post(`/api/employees/${empId}/account`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ email: 'escalate@test.local', role: 'super_admin' });
    expect(asHr.status).toBe(403);

    const asAdmin = await request(app)
      .post(`/api/employees/${empId}/account`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'legit-admin@test.local', role: 'hr' });
    expect(asAdmin.status).toBe(201);
    expect(asAdmin.body.role).toBe('hr');
  });

  test('rejects a duplicate email across different employees', async () => {
    const empId = newId();
    const ts = nowIso();
    await db.prepare(
      'INSERT INTO employees (id, employee_code, full_name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)'
    ).run(empId, 'NOACCT3', 'Third No Account', 'active', ts, ts);

    const res = await request(app)
      .post(`/api/employees/${empId}/account`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ email: 'noaccount@test.local', role: 'employee' }); // already used above
    expect(res.status).toBe(409);
  });
});

describe('Deactivate / reactivate a login account independently of the employee record', () => {
  let targetEmpId, targetLoginToken;

  beforeAll(async () => {
    targetEmpId = newId();
    const ts = nowIso();
    await db.prepare(
      'INSERT INTO employees (id, employee_code, full_name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)'
    ).run(targetEmpId, 'TOGGLE1', 'Toggle Target', 'active', ts, ts);
    const created = await request(app)
      .post(`/api/employees/${targetEmpId}/account`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ email: 'toggle-target@test.local', role: 'employee' });
    targetLoginToken = created.body.temporaryPassword;
  });

  test('a deactivated account can no longer log in', async () => {
    const before = await request(app).post('/api/auth/login').send({ email: 'toggle-target@test.local', password: targetLoginToken });
    expect(before.status).toBe(200);

    const deactivate = await request(app)
      .post(`/api/employees/${targetEmpId}/account/deactivate`)
      .set('Authorization', `Bearer ${hrToken}`);
    expect(deactivate.status).toBe(200);

    const after = await request(app).post('/api/auth/login').send({ email: 'toggle-target@test.local', password: targetLoginToken });
    expect(after.status).toBe(401);
  });

  test('reactivating restores login access', async () => {
    const reactivate = await request(app)
      .post(`/api/employees/${targetEmpId}/account/activate`)
      .set('Authorization', `Bearer ${hrToken}`);
    expect(reactivate.status).toBe(200);

    const after = await request(app).post('/api/auth/login').send({ email: 'toggle-target@test.local', password: targetLoginToken });
    expect(after.status).toBe(200);
  });

  test('nobody can deactivate their own account', async () => {
    // Needs an actor who both holds employees.manage AND is linked to an
    // employee record - hr@test.local has no employee link, and manager
    // lacks employees.manage entirely, so neither fixture alone exercises
    // this. A fresh HR account tied to its own employee record does.
    const selfEmpId = newId();
    const ts = nowIso();
    await db.prepare(
      'INSERT INTO employees (id, employee_code, full_name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)'
    ).run(selfEmpId, 'SELFLOCK1', 'Self Lockout Test', 'active', ts, ts);
    const created = await request(app)
      .post(`/api/employees/${selfEmpId}/account`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'self-lockout@test.local', role: 'hr' });
    const selfToken = (await request(app).post('/api/auth/login').send({ email: 'self-lockout@test.local', password: created.body.temporaryPassword })).body.accessToken;

    const res = await request(app)
      .post(`/api/employees/${selfEmpId}/account/deactivate`)
      .set('Authorization', `Bearer ${selfToken}`);
    expect(res.status).toBe(400);
  });

  test('HR cannot deactivate an hr or super_admin account', async () => {
    const hrEmpId = newId();
    const ts = nowIso();
    await db.prepare(
      'INSERT INTO employees (id, employee_code, full_name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)'
    ).run(hrEmpId, 'TOGGLE2', 'HR Account Target', 'active', ts, ts);
    await request(app)
      .post(`/api/employees/${hrEmpId}/account`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'hr-target@test.local', role: 'hr' });

    const asHr = await request(app)
      .post(`/api/employees/${hrEmpId}/account/deactivate`)
      .set('Authorization', `Bearer ${hrToken}`);
    expect(asHr.status).toBe(403);

    const asAdmin = await request(app)
      .post(`/api/employees/${hrEmpId}/account/deactivate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(asAdmin.status).toBe(200);
  });
});

describe('Terminating an employee cascades to disable their login (security fix)', () => {
  test('DELETE /employees/:id also deactivates the linked account so they cannot still log in', async () => {
    const empId = newId();
    const ts = nowIso();
    await db.prepare(
      'INSERT INTO employees (id, employee_code, full_name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)'
    ).run(empId, 'TERM1', 'Termination Target', 'active', ts, ts);
    const created = await request(app)
      .post(`/api/employees/${empId}/account`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ email: 'termination-target@test.local', role: 'employee' });

    const beforeLogin = await request(app).post('/api/auth/login').send({ email: 'termination-target@test.local', password: created.body.temporaryPassword });
    expect(beforeLogin.status).toBe(200);

    const del = await request(app).delete(`/api/employees/${empId}`).set('Authorization', `Bearer ${hrToken}`);
    expect(del.status).toBe(200);

    const afterLogin = await request(app).post('/api/auth/login').send({ email: 'termination-target@test.local', password: created.body.temporaryPassword });
    expect(afterLogin.status).toBe(401);
  });

  test('terminating an employee with no login account still succeeds', async () => {
    const empId = newId();
    const ts = nowIso();
    await db.prepare(
      'INSERT INTO employees (id, employee_code, full_name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)'
    ).run(empId, 'TERM2', 'No Account Termination', 'active', ts, ts);
    const del = await request(app).delete(`/api/employees/${empId}`).set('Authorization', `Bearer ${hrToken}`);
    expect(del.status).toBe(200);
  });
});
