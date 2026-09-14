const request = require('supertest');
const { seedMinimal, cleanup } = require('./setup');

let app, hrToken;

beforeAll(async () => {
  app = require('../src/app');
  await seedMinimal();
  hrToken = (await request(app).post('/api/auth/login').send({ email: 'hr@test.local', password: 'HrPass1' })).body.accessToken;
});

afterAll(() => cleanup());

// Regression test: mysql2 reports constraint violations via MySQL error
// codes (ER_DUP_ENTRY for UNIQUE, etc.) - a prior version of the error
// handler was written for a different database driver's error shape and
// let these fall through to a generic 500 instead of the correct 409.
// See README "Scope & honesty" for the full history across two migrations.
describe('Database constraint error mapping', () => {
  test('a duplicate unique field returns 409 with a clear message, not a generic 500', async () => {
    const first = await request(app)
      .post('/api/departments')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ name: 'Duplicate Name Test' });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/departments')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ name: 'Duplicate Name Test' });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/unique constraint/i);
  });
});
