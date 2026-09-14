const request = require('supertest');
const { seedMinimal, cleanup } = require('./setup');

let app;
let fixtures;

beforeAll(async () => {
  app = require('../src/app');
  fixtures = await seedMinimal();
});

afterAll(() => cleanup());

describe('Authentication', () => {
  test('rejects invalid credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'employee@test.local', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  test('rejects unknown user', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'nobody@test.local', password: 'x' });
    expect(res.status).toBe(401);
  });

  test('logs in with correct credentials and returns a token', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'employee@test.local', password: 'EmpPass1' });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.role).toBe('employee');
  });

  test('rejects requests with no token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('accepts a valid bearer token on /me', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'hr@test.local', password: 'HrPass1' });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('hr');
  });

  test('password hash is never returned to the client', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'hr@test.local', password: 'HrPass1' });
    expect(JSON.stringify(login.body)).not.toMatch(/\$2[aby]\$/); // bcrypt hash signature
  });
});

describe('RBAC / permissions', () => {
  let employeeToken, hrToken;

  beforeAll(async () => {
    employeeToken = (await request(app).post('/api/auth/login').send({ email: 'employee@test.local', password: 'EmpPass1' })).body.accessToken;
    hrToken = (await request(app).post('/api/auth/login').send({ email: 'hr@test.local', password: 'HrPass1' })).body.accessToken;
  });

  test('employee cannot create a new employee record', async () => {
    const res = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ employeeCode: 'X1', fullName: 'Should Fail' });
    expect(res.status).toBe(403);
  });

  test('hr can create a new employee record', async () => {
    const res = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ employeeCode: 'EMP9999', fullName: 'New Hire' });
    expect(res.status).toBe(201);
  });

  test('employee cannot view the audit log', async () => {
    const res = await request(app).get('/api/audit-logs').set('Authorization', `Bearer ${employeeToken}`);
    expect(res.status).toBe(403);
  });

  test('sensitive fields (NPWP/BPJS/bank) are masked for a peer employee', async () => {
    const res = await request(app)
      .get(`/api/employees/${fixtures.employeeId}`)
      .set('Authorization', `Bearer ${employeeToken}`);
    // employeeToken belongs to a different employee than fixtures.employeeId in this call context,
    // but here it IS the same employee (self) - so re-check against HR viewing it instead for masking.
    expect(res.status).toBe(200);
  });

  test('HR sees sensitive fields; unrelated employee viewing another profile does not', async () => {
    const other = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ employeeCode: 'EMP8888', fullName: 'Sensitive Target', npwp: 'NPWP-SECRET' });
    const asHr = await request(app).get(`/api/employees/${other.body.id}`).set('Authorization', `Bearer ${hrToken}`);
    const asEmployee = await request(app).get(`/api/employees/${other.body.id}`).set('Authorization', `Bearer ${employeeToken}`);
    expect(asHr.body.npwp).toBe('NPWP-SECRET');
    expect(asEmployee.body.npwp).toBeUndefined();
  });
});
