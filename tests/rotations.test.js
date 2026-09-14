const request = require('supertest');
const { seedMinimal, cleanup, db } = require('./setup');

let app, fixtures, hrToken;
let morningShiftId, rotationId;

beforeAll(async () => {
  app = require('../src/app');
  fixtures = await seedMinimal();
  hrToken = (await request(app).post('/api/auth/login').send({ email: 'hr@test.local', password: 'HrPass1' })).body.accessToken;
  morningShiftId = fixtures.shiftId;
});

afterAll(() => cleanup());

describe('Shift rotation engine', () => {
  test('creates a rotation pattern (2 days on, 1 day off)', async () => {
    const res = await request(app)
      .post('/api/shift-rotations')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ name: '2-on-1-off', pattern: [morningShiftId, morningShiftId, null] });
    expect(res.status).toBe(201);
    rotationId = res.body.id;
  });

  test('rejects a pattern that is not an array', async () => {
    const res = await request(app)
      .post('/api/shift-rotations')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ name: 'bad', pattern: 'not-an-array' });
    expect(res.status).toBe(400);
  });

  test('assigns an employee to the rotation anchored at a start date', async () => {
    const res = await request(app)
      .post(`/api/shift-rotations/${rotationId}/assign`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ employeeIds: [fixtures.employeeId], startDate: '2026-09-01' });
    expect(res.status).toBe(200);
    expect(res.body.assigned).toBe(1);
  });

  test('generating schedules expands the pattern correctly across a date range', async () => {
    const res = await request(app)
      .post('/api/shift-rotations/generate')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ from: '2026-09-01', to: '2026-09-06' });
    expect(res.status).toBe(200);
    // Pattern is [shift, shift, OFF] repeating over 6 days -> OFF on day 3 and day 6 = 2 OFF days, 4 worked days
    expect(res.body.daysOff).toBe(2);
    expect(res.body.scheduleEntriesWritten).toBe(4);

    const rows = await db.prepare('SELECT date FROM schedules WHERE employee_id = ? ORDER BY date').all(fixtures.employeeId);
    const scheduledDates = rows.map((r) => r.date);
    expect(scheduledDates).toEqual(['2026-09-01', '2026-09-02', '2026-09-04', '2026-09-05']);
    expect(scheduledDates).not.toContain('2026-09-03'); // OFF day per pattern
    expect(scheduledDates).not.toContain('2026-09-06'); // OFF day per pattern
  });

  test('re-generating the same range is idempotent (no duplicate rows)', async () => {
    await request(app)
      .post('/api/shift-rotations/generate')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ from: '2026-09-01', to: '2026-09-06' });
    const row = await db.prepare('SELECT COUNT(*) as c FROM schedules WHERE employee_id = ?').get(fixtures.employeeId);
    expect(row.c).toBe(4);
  });

  test('rejects an unreasonably large generation range', async () => {
    const res = await request(app)
      .post('/api/shift-rotations/generate')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ from: '2020-01-01', to: '2026-01-01' });
    expect(res.status).toBe(400);
  });
});
