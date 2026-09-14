const request = require('supertest');
const { seedMinimal, cleanup, db } = require('./setup');

let app, adminToken, hrToken;

beforeAll(async () => {
  app = require('../src/app');
  await seedMinimal();
  adminToken = (await request(app).post('/api/auth/login').send({ email: 'admin@test.local', password: 'AdminPass1' })).body.accessToken;
  hrToken = (await request(app).post('/api/auth/login').send({ email: 'hr@test.local', password: 'HrPass1' })).body.accessToken;
});

afterAll(() => cleanup());

describe('Reset all data (Danger Zone)', () => {
  test('rejects without super_admin role', async () => {
    const res = await request(app)
      .post('/api/settings/reset-data')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ confirm: 'HAPUS SEMUA DATA' });
    expect(res.status).toBe(403);
  });

  test('rejects a wrong or missing confirmation phrase', async () => {
    const res = await request(app)
      .post('/api/settings/reset-data')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ confirm: 'hapus semua data' });
    expect(res.status).toBe(400);
  });

  test('wipes employees/attendance/departments but keeps the caller account, audit log, and settings', async () => {
    const beforeAudit = (await db.prepare('SELECT COUNT(*) as c FROM audit_logs').get()).c;
    const employeesBefore = (await db.prepare('SELECT COUNT(*) as c FROM employees').get()).c;
    expect(employeesBefore).toBeGreaterThan(0);

    const res = await request(app)
      .post('/api/settings/reset-data')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ confirm: 'HAPUS SEMUA DATA' });
    expect(res.status).toBe(200);

    expect((await db.prepare('SELECT COUNT(*) as c FROM employees').get()).c).toBe(0);
    expect((await db.prepare('SELECT COUNT(*) as c FROM departments').get()).c).toBe(0);
    expect((await db.prepare('SELECT COUNT(*) as c FROM attendance').get()).c).toBe(0);

    const stillLoggedIn = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adminToken}`);
    expect(stillLoggedIn.status).toBe(200);
    expect(stillLoggedIn.body.role).toBe('super_admin');

    const hrStillWorks = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${hrToken}`);
    expect(hrStillWorks.status).toBe(401);

    const afterAudit = (await db.prepare('SELECT COUNT(*) as c FROM audit_logs').get()).c;
    expect(afterAudit).toBeGreaterThan(beforeAudit);

    const settings = await db.prepare("SELECT * FROM settings WHERE id = 'singleton'").get();
    expect(settings).toBeTruthy();
  });
});
