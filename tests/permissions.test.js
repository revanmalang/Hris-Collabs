const request = require('supertest');
const { seedMinimal, cleanup } = require('./setup');

let app;
let adminToken, hrToken, managerToken;

beforeAll(async () => {
  app = require('../src/app');
  await seedMinimal();
  adminToken = (await request(app).post('/api/auth/login').send({ email: 'admin@test.local', password: 'AdminPass1' })).body.accessToken;
  hrToken = (await request(app).post('/api/auth/login').send({ email: 'hr@test.local', password: 'HrPass1' })).body.accessToken;
  managerToken = (await request(app).post('/api/auth/login').send({ email: 'manager@test.local', password: 'MgrPass1' })).body.accessToken;
});

afterAll(() => cleanup());

describe('Dynamic RBAC permission matrix', () => {
  test('only super_admin can view the permission matrix', async () => {
    const asAdmin = await request(app).get('/api/permissions').set('Authorization', `Bearer ${adminToken}`);
    const asHr = await request(app).get('/api/permissions').set('Authorization', `Bearer ${hrToken}`);
    expect(asAdmin.status).toBe(200);
    expect(asHr.status).toBe(403);
  });

  test('manager lacks organization.manage by default and is denied', async () => {
    const res = await request(app)
      .post('/api/departments')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: 'Should Fail Dept' });
    expect(res.status).toBe(403);
  });

  test('super_admin can grant organization.manage to manager via the matrix', async () => {
    const grant = await request(app)
      .put('/api/permissions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'manager', code: 'organization.manage', enabled: true });
    expect(grant.status).toBe(200);
    expect(grant.body.grants.manager.length).toBeGreaterThan(0);
  });

  test('manager can now perform the previously-forbidden action', async () => {
    const res = await request(app)
      .post('/api/departments')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: 'Manager Created Dept' });
    expect(res.status).toBe(201);
  });

  test('super_admin can revoke the grant again', async () => {
    const revoke = await request(app)
      .put('/api/permissions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'manager', code: 'organization.manage', enabled: false });
    expect(revoke.status).toBe(200);

    const after = await request(app)
      .post('/api/departments')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: 'Should Fail Again' });
    expect(after.status).toBe(403);
  });

  test('hr cannot edit the permission matrix even though it manages most things', async () => {
    const res = await request(app)
      .put('/api/permissions')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ role: 'hr', code: 'settings.manage', enabled: true });
    expect(res.status).toBe(403);
  });

  test('rejects an invalid permission code', async () => {
    const res = await request(app)
      .put('/api/permissions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'hr', code: 'not.a.real.permission', enabled: true });
    expect(res.status).toBe(400);
  });
});
