const express = require('express');
const db = require('../db');
const { newId, nowIso } = require('../utils/id');
const { announcementSchema } = require('../utils/validators');
const { requireAuth } = require('../middleware/auth');
const { requireRole, requirePermission } = require('../middleware/rbac');
const { logAudit } = require('../utils/audit');
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const { emitAnnouncement } = require('../realtime/socket');
const { uploadPhoto } = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth);

// ---- Notifications ----------------------------------------------------
router.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    if (!req.user.employeeId && !['super_admin', 'hr'].includes(req.user.role)) {
      return res.json([]);
    }
    const rows = req.user.employeeId
      ? await db.prepare('SELECT * FROM notifications WHERE employee_id = ? ORDER BY created_at DESC LIMIT 50').all(req.user.employeeId)
      : await db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50').all();
    res.json(rows);
  })
);

router.get(
  '/notifications/unread-count',
  asyncHandler(async (req, res) => {
    if (!req.user.employeeId) return res.json({ count: 0 });
    const { c } = await db.prepare('SELECT COUNT(*) as c FROM notifications WHERE employee_id = ? AND is_read = 0')
      .get(req.user.employeeId);
    res.json({ count: c });
  })
);

router.post(
  '/notifications/:id/read',
  asyncHandler(async (req, res) => {
    await db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  })
);

router.post(
  '/notifications/read-all',
  asyncHandler(async (req, res) => {
    if (req.user.employeeId) {
      await db.prepare('UPDATE notifications SET is_read = 1 WHERE employee_id = ?').run(req.user.employeeId);
    }
    res.json({ ok: true });
  })
);

// ---- Announcements ------------------------------------------------------
router.get(
  '/announcements',
  asyncHandler(async (req, res) => {
    const rows = await db.prepare(
        `SELECT a.*, d.name as target_department_name FROM announcements a
         LEFT JOIN departments d ON d.id = a.target_department_id
         WHERE (a.expired_at IS NULL OR a.expired_at >= NOW())
           AND (a.target_role IS NULL OR a.target_role = ?)
         ORDER BY a.publish_at DESC LIMIT 20`
      )
      .all(req.user.role);
    res.json(rows);
  })
);

router.post(
  '/announcements',
  requirePermission('announcements.manage'),
  uploadPhoto.single('image'),
  asyncHandler(async (req, res) => {
    const data = announcementSchema.parse(req.body);
    const id = newId();
    const imageUrl = req.file ? `/uploads/photos/${req.file.filename}` : null;
    await db.prepare(
      `INSERT INTO announcements (id, title, content, image_url, target_department_id, target_role, publish_at, expired_at, created_at)
       VALUES (?,?,?,?,?,?,NOW(),?,?)`
    ).run(id, data.title, data.content, imageUrl, data.targetDepartmentId ?? null, data.targetRole ?? null, data.expiredAt ?? null, nowIso());
    await logAudit({ userId: req.user.id, action: 'announcement_create', objectType: 'announcement', objectId: id, req });
    const announcement = await db.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
    emitAnnouncement(announcement);
    res.status(201).json(announcement);
  })
);

router.delete(
  '/announcements/:id',
  requirePermission('announcements.manage'),
  asyncHandler(async (req, res) => {
    await db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
    await logAudit({ userId: req.user.id, action: 'announcement_delete', objectType: 'announcement', objectId: req.params.id, req });
    res.json({ ok: true });
  })
);

module.exports = router;
