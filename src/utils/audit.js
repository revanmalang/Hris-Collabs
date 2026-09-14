const db = require('../db');
const { newId } = require('./id');

// Writes an immutable audit trail row. Called from controllers for
// security-relevant / data-changing actions (see README for the full list).
// Async because every DB write is now a real network round trip (MySQL) -
// every call site awaits this.
async function logAudit({ userId = null, action, objectType = null, objectId = null, req = null, metadata = null }) {
  await db.prepare(`
    INSERT INTO audit_logs (id, user_id, action, object_type, object_id, ip_address, device, metadata, created_at)
    VALUES (@id, @userId, @action, @objectType, @objectId, @ip, @device, @metadata, @createdAt)
  `).run({
    id: newId(),
    userId,
    action,
    objectType,
    objectId,
    ip: req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null) : null,
    device: req ? (req.headers['user-agent'] || null) : null,
    metadata: metadata ? JSON.stringify(metadata) : null,
    createdAt: new Date().toISOString(),
  });
}

module.exports = { logAudit };
