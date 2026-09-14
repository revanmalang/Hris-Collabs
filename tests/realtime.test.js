const http = require('http');
const { io: ioClient } = require('socket.io-client');
const request = require('supertest');
const { seedMinimal, cleanup } = require('./setup');
const { initSocket } = require('../src/realtime/socket');
const { signAccessToken } = require('../src/utils/token');

let app, server, port, hrSocket;
let employeeToken, fixtures;

beforeAll(async () => {
  app = require('../src/app');
  fixtures = await seedMinimal();
  server = http.createServer(app);
  initSocket(server, true);
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;

  employeeToken = (await request(app).post('/api/auth/login').send({ email: 'employee@test.local', password: 'EmpPass1' })).body.accessToken;

  const hrToken = signAccessToken({ sub: 'hr-user-id', role: 'hr', employeeId: null });
  hrSocket = ioClient(`http://localhost:${port}`, { auth: { token: hrToken }, transports: ['websocket'] });
  await new Promise((resolve, reject) => {
    hrSocket.on('connect', resolve);
    hrSocket.on('connect_error', reject);
  });
});

afterAll(async () => {
  hrSocket?.close();
  await new Promise((resolve) => server.close(resolve));
  cleanup();
});

test('an HR-room socket receives a live attendance:event when an employee checks in', async () => {
  const received = new Promise((resolve) => hrSocket.once('attendance:event', resolve));

  const res = await request(app)
    .post('/api/attendance/check-in')
    .set('Authorization', `Bearer ${employeeToken}`)
    .send({ latitude: -7.9797, longitude: 112.6304 });
  expect(res.status).toBe(200);

  const event = await received;
  expect(event.type).toBe('check_in');
  expect(event.employeeId).toBe(fixtures.employeeId);
});

test('dashboard:stats is pushed to the HR room after the check-in', async () => {
  const received = new Promise((resolve) => hrSocket.once('dashboard:stats', resolve));
  await request(app).post('/api/attendance/check-out').set('Authorization', `Bearer ${employeeToken}`).send({});
  const stats = await received;
  expect(typeof stats.presentToday).toBe('number');
});
