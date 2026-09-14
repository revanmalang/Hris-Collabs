const request = require('supertest');
const { seedMinimal, cleanup } = require('./setup');

let app;
let employeeToken, hrToken, managerToken;

beforeAll(async () => {
  app = require('../src/app');
  await seedMinimal();
  employeeToken = (await request(app).post('/api/auth/login').send({ email: 'employee@test.local', password: 'EmpPass1' })).body.accessToken;
  hrToken = (await request(app).post('/api/auth/login').send({ email: 'hr@test.local', password: 'HrPass1' })).body.accessToken;
  managerToken = (await request(app).post('/api/auth/login').send({ email: 'manager@test.local', password: 'MgrPass1' })).body.accessToken;
});

afterAll(() => cleanup());

describe('Leave request workflow', () => {
  let leaveId;

  test('employee can submit a leave request', async () => {
    const res = await request(app)
      .post('/api/leave')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ type: 'izin', startDate: '2026-09-10', endDate: '2026-09-10', reason: 'Personal matter' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    leaveId = res.body.id;
  });

  test('rejects a request where endDate is before startDate', async () => {
    const res = await request(app)
      .post('/api/leave')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ type: 'izin', startDate: '2026-09-10', endDate: '2026-09-05' });
    expect(res.status).toBe(400);
  });

  test('an employee cannot approve their own leave request', async () => {
    const res = await request(app).post(`/api/leave/${leaveId}/approve`).set('Authorization', `Bearer ${employeeToken}`);
    expect(res.status).toBe(403);
  });

  test('a manager can approve a pending leave request', async () => {
    const res = await request(app).post(`/api/leave/${leaveId}/approve`).set('Authorization', `Bearer ${managerToken}`).send({ note: 'ok' });
    expect(res.status).toBe(200);
  });

  test('approving an already-reviewed request is rejected', async () => {
    const res = await request(app).post(`/api/leave/${leaveId}/approve`).set('Authorization', `Bearer ${hrToken}`);
    expect(res.status).toBe(409);
  });

  test('the leave request now shows status approved', async () => {
    const res = await request(app).get('/api/leave?status=approved').set('Authorization', `Bearer ${hrToken}`);
    expect(res.status).toBe(200);
    expect(res.body.find((l) => l.id === leaveId)).toBeTruthy();
  });
});

describe('Leave rejection workflow', () => {
  test('HR can reject a pending request with a note', async () => {
    const submit = await request(app)
      .post('/api/leave')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ type: 'sakit', startDate: '2026-09-12', endDate: '2026-09-12' });
    const res = await request(app)
      .post(`/api/leave/${submit.body.id}/reject`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ note: 'Insufficient documentation' });
    expect(res.status).toBe(200);
  });
});
