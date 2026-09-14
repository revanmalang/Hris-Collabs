const request = require('supertest');
const { seedMinimal, cleanup, db } = require('./setup');

let app;
let fixtures;
let employeeToken;

beforeAll(async () => {
  app = require('../src/app');
  fixtures = await seedMinimal();
  const login = await request(app).post('/api/auth/login').send({ email: 'employee@test.local', password: 'EmpPass1' });
  employeeToken = login.body.accessToken;
});

afterAll(() => cleanup());

describe('Attendance: check-in / check-out', () => {
  test('check-in succeeds within the geofence radius', async () => {
    const res = await request(app)
      .post('/api/attendance/check-in')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ latitude: -7.9797, longitude: 112.6304 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe('present');
  });

  test('a second check-in on the same day is rejected', async () => {
    const res = await request(app)
      .post('/api/attendance/check-in')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ latitude: -7.9797, longitude: 112.6304 });
    expect(res.status).toBe(409);
  });

  test('check-out computes worked minutes and succeeds', async () => {
    const res = await request(app)
      .post('/api/attendance/check-out')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ latitude: -7.9797, longitude: 112.6304 });
    expect(res.status).toBe(200);
    expect(typeof res.body.workedMinutes).toBe('number');
  });

  test('check-out without a prior check-in is rejected', async () => {
    // fresh employee/user with no attendance row yet today
    const ts = new Date().toISOString();
    const { newId } = require('../src/utils/id');
    const { hashPassword } = require('../src/utils/password');
    const empId = newId();
    await db.prepare('INSERT INTO employees (id, employee_code, full_name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)').run(
      empId, 'EMPNOIN', 'No Checkin', 'active', ts, ts
    );
    const hash = await hashPassword('Pass1234');
    await db.prepare('INSERT INTO users (id, email, password, role, employee_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(
      newId(), 'noin@test.local', hash, 'employee', empId, ts, ts
    );
    const login = await request(app).post('/api/auth/login').send({ email: 'noin@test.local', password: 'Pass1234' });
    const res = await request(app).post('/api/attendance/check-out').set('Authorization', `Bearer ${login.body.accessToken}`).send({});
    expect(res.status).toBe(400);
  });
});

describe('Attendance: geofence enforcement', () => {
  let farEmployeeToken;

  beforeAll(async () => {
    const ts = new Date().toISOString();
    const { newId } = require('../src/utils/id');
    const { hashPassword } = require('../src/utils/password');
    const empId = newId();
    await db.prepare(
      'INSERT INTO employees (id, employee_code, full_name, location_id, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
    ).run(empId, 'EMPFAR', 'Far Employee', fixtures.locationId, 'active', ts, ts);
    const hash = await hashPassword('Pass1234');
    await db.prepare('INSERT INTO users (id, email, password, role, employee_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(
      newId(), 'far@test.local', hash, 'employee', empId, ts, ts
    );
    const login = await request(app).post('/api/auth/login').send({ email: 'far@test.local', password: 'Pass1234' });
    farEmployeeToken = login.body.accessToken;
  });

  test('check-in from far outside the geofence radius is rejected with 403', async () => {
    const res = await request(app)
      .post('/api/attendance/check-in')
      .set('Authorization', `Bearer ${farEmployeeToken}`)
      .send({ latitude: -6.2, longitude: 106.8 }); // Jakarta, office is in Malang
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/m from/);
  });

  test('the same employee can check in successfully once within radius', async () => {
    const res = await request(app)
      .post('/api/attendance/check-in')
      .set('Authorization', `Bearer ${farEmployeeToken}`)
      .send({ latitude: -7.9797, longitude: 112.6304 });
    expect(res.status).toBe(200);
  });

  test('server never trusts a client-supplied distance/status field', async () => {
    // Even if a malicious client sends extra fields, only latitude/longitude are read.
    const ts = new Date().toISOString();
    const { newId } = require('../src/utils/id');
    const { hashPassword } = require('../src/utils/password');
    const empId = newId();
    await db.prepare(
      'INSERT INTO employees (id, employee_code, full_name, location_id, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
    ).run(empId, 'EMPSPOOF', 'Spoof Attempt', fixtures.locationId, 'active', ts, ts);
    const hash = await hashPassword('Pass1234');
    await db.prepare('INSERT INTO users (id, email, password, role, employee_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(
      newId(), 'spoof@test.local', hash, 'employee', empId, ts, ts
    );
    const login = await request(app).post('/api/auth/login').send({ email: 'spoof@test.local', password: 'Pass1234' });
    const res = await request(app)
      .post('/api/attendance/check-in')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ latitude: -6.2, longitude: 106.8, status: 'present', isLate: false }); // spoofed fields ignored
    expect(res.status).toBe(403); // still rejected on true server-computed distance
  });
});
