const express = require('express');

const router = express.Router();

router.use('/auth', require('./auth.routes'));
router.use('/employees', require('./employees.routes'));
router.use('/', require('./org.routes')); // /departments, /positions, /locations, /shifts, /org-chart
router.use('/attendance', require('./attendance.routes'));
router.use('/leave', require('./leave.routes'));
router.use('/overtime', require('./overtime.routes'));
router.use('/', require('./comms.routes')); // /notifications, /announcements
router.use('/dashboard', require('./dashboard.routes'));
router.use('/reports', require('./reports.routes'));
router.use('/', require('./system.routes')); // /audit-logs, /settings, /search, /employees/:id/documents
router.use('/', require('./permissions.routes')); // /permissions
router.use('/', require('./rotations.routes')); // /shift-rotations
router.use('/', require('./backup.routes')); // /settings/backup/*

module.exports = router;
