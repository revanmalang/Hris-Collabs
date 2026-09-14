const request = require('supertest');
const { seedMinimal, cleanup } = require('./setup');

let app;

beforeAll(async () => {
  app = require('../src/app');
  await seedMinimal();
});

afterAll(() => cleanup());

describe('Forgot / reset password (no SMTP configured in tests)', () => {
  test('forgot-password responds generically for a known email, with a dev fallback link', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'employee@test.local' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.devResetLink).toContain('/reset-password.html?token=');
  });

  test('forgot-password responds the same generic way for an unknown email (no enumeration)', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody-at-all@test.local' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.devResetLink).toBeUndefined();
  });

  test('reset-password with a valid token sets a new password that can then log in', async () => {
    const forgot = await request(app).post('/api/auth/forgot-password').send({ email: 'employee@test.local' });
    const token = new URL(forgot.body.devResetLink).searchParams.get('token');

    const reset = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'BrandNewPass1' });
    expect(reset.status).toBe(200);

    const login = await request(app).post('/api/auth/login').send({ email: 'employee@test.local', password: 'BrandNewPass1' });
    expect(login.status).toBe(200);
  });

  test('a used token cannot be reused', async () => {
    const forgot = await request(app).post('/api/auth/forgot-password').send({ email: 'hr@test.local' });
    const token = new URL(forgot.body.devResetLink).searchParams.get('token');
    await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'FirstUse123' });
    const second = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'SecondUse123' });
    expect(second.status).toBe(400);
  });

  test('an invalid token is rejected', async () => {
    const res = await request(app).post('/api/auth/reset-password').send({ token: 'not-a-real-token', newPassword: 'WhateverPass1' });
    expect(res.status).toBe(400);
  });

  test('a weak new password is rejected', async () => {
    const forgot = await request(app).post('/api/auth/forgot-password').send({ email: 'manager@test.local' });
    const token = new URL(forgot.body.devResetLink).searchParams.get('token');
    const res = await request(app).post('/api/auth/reset-password').send({ token, newPassword: '123' });
    expect(res.status).toBe(400);
  });
});
