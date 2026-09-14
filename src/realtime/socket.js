const { Server } = require('socket.io');
const { verifyAccessToken } = require('../utils/token');

let io = null;

// Rooms:
//  - "hr"            : super_admin + hr, receives every live-attendance/leave/overtime event
//  - "employee:<id>"  : personal notifications for one employee
function initSocket(httpServer, corsOrigin) {
  io = new Server(httpServer, {
    cors: { origin: corsOrigin, credentials: true },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('unauthorized'));
      const payload = verifyAccessToken(token);
      socket.user = payload; // { sub, role, employeeId }
      next();
    } catch (e) {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const { role, employeeId } = socket.user;
    if (['super_admin', 'hr'].includes(role)) socket.join('hr');
    if (['manager'].includes(role)) socket.join('managers');
    if (employeeId) socket.join(`employee:${employeeId}`);
  });

  return io;
}

function getIo() {
  return io; // may be null if not yet initialized (e.g. running under tests) - callers below guard for this
}

// --- Emit helpers used by controllers -------------------------------------

function emitAttendanceEvent(payload) {
  if (!io) return;
  getIo().to('hr').to('managers').emit('attendance:event', payload);
}

function emitDashboardStats(stats) {
  if (!io) return;
  getIo().to('hr').emit('dashboard:stats', stats);
}

function emitNotification(employeeId, notification) {
  if (!io) return;
  getIo().to(`employee:${employeeId}`).emit('notification:new', notification);
  getIo().to('hr').emit('notification:new', notification);
}

function emitLeaveEvent(payload) {
  if (!io) return;
  getIo().to('hr').to('managers').emit('leave:event', payload);
  if (payload.employeeId) {
    getIo().to(`employee:${payload.employeeId}`).emit('leave:event', payload);
  }
}

function emitOvertimeEvent(payload) {
  if (!io) return;
  getIo().to('hr').to('managers').emit('overtime:event', payload);
  if (payload.employeeId) {
    getIo().to(`employee:${payload.employeeId}`).emit('overtime:event', payload);
  }
}

function emitAnnouncement(announcement) {
  if (!io) return;
  getIo().emit('announcement:new', announcement);
}

module.exports = {
  initSocket,
  getIo,
  emitAttendanceEvent,
  emitDashboardStats,
  emitNotification,
  emitLeaveEvent,
  emitOvertimeEvent,
  emitAnnouncement,
};
