const express = require('express');
const db = require('../db');
const { todayStr } = require('../utils/id');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const asyncHandler = require('../utils/asyncHandler');
const { getDashboardStats } = require('../services/dashboardStats');

const router = express.Router();
router.use(requireAuth);

// GET /api/dashboard/hr - super_admin/hr/manager overview
router.get(
  '/hr',
  requireRole('super_admin', 'hr', 'manager'),
  asyncHandler(async (req, res) => {
    const stats = await getDashboardStats();

    const recentActivity = await db.prepare(
        `SELECT al.action, al.created_at, u.email
         FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
         WHERE al.action IN ('check_in','check_out','leave_request_create','leave_approve','leave_reject')
         ORDER BY al.created_at DESC LIMIT 15`
      )
      .all();

    const recentCheckins = await db.prepare(
        `SELECT e.full_name, a.check_in_at, a.status FROM attendance a
         JOIN employees e ON e.id = a.employee_id
         WHERE a.date = ? AND a.check_in_at IS NOT NULL ORDER BY a.check_in_at DESC LIMIT 8`
      )
      .all(todayStr());

    const recentCheckouts = await db.prepare(
        `SELECT e.full_name, a.check_out_at FROM attendance a
         JOIN employees e ON e.id = a.employee_id
         WHERE a.date = ? AND a.check_out_at IS NOT NULL ORDER BY a.check_out_at DESC LIMIT 8`
      )
      .all(todayStr());

    const recentLeaveRequests = await db.prepare(
        `SELECT lr.id, lr.type, lr.status, lr.created_at, e.full_name FROM leave_requests lr
         JOIN employees e ON e.id = lr.employee_id ORDER BY lr.created_at DESC LIMIT 8`
      )
      .all();

    res.json({ stats, recentActivity, recentCheckins, recentCheckouts, recentLeaveRequests });
  })
);

// GET /api/dashboard/me - employee's own dashboard
router.get(
  '/me',
  asyncHandler(async (req, res) => {
    if (!req.user.employeeId) return res.json({ employee: null });
    const employee = await db.prepare(
        `SELECT e.*, d.name as department_name, p.title as position_title, s.start_time, s.end_time
         FROM employees e
         LEFT JOIN departments d ON d.id = e.department_id
         LEFT JOIN positions p ON p.id = e.position_id
         LEFT JOIN shifts s ON s.id = e.shift_id
         WHERE e.id = ?`
      )
      .get(req.user.employeeId);

    const today = await db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date = ?').get(req.user.employeeId, todayStr());
    const leaveBalance = await db.prepare(
        `SELECT lb.*, lt.name as leave_type_name FROM leave_balances lb
         JOIN leave_types lt ON lt.id = lb.leave_type_id WHERE lb.employee_id = ? AND lb.year = ?`
      )
      .all(req.user.employeeId, new Date().getFullYear());
    const recentAttendance = await db.prepare('SELECT * FROM attendance WHERE employee_id = ? ORDER BY date DESC LIMIT 7')
      .all(req.user.employeeId);
    const pendingRequests = await db.prepare(
        `SELECT 'leave' as kind, id, type, status, created_at FROM leave_requests WHERE employee_id = ? AND status = 'pending'
         UNION ALL
         SELECT 'overtime' as kind, id, 'overtime' as type, status, created_at FROM overtime_requests WHERE employee_id = ? AND status = 'pending'
         ORDER BY created_at DESC`
      )
      .all(req.user.employeeId, req.user.employeeId);

    res.json({ employee, today, leaveBalance, recentAttendance, pendingRequests });
  })
);

// GET /api/dashboard/reminders - birthdays, work anniversaries, and contract
// expiries in the next 14 days. No new tables needed - all derived from
// dates already on the employee record.
router.get(
  '/reminders',
  requireRole('super_admin', 'hr', 'manager'),
  asyncHandler(async (req, res) => {
    const employees = await db.prepare(
        `SELECT id, full_name, birth_date, hire_date, contract_type, end_date, employee_code
         FROM employees WHERE deleted_at IS NULL AND status = 'active'`
      )
      .all();

    const today = new Date();
    const inNextDays = (month, day, days) => {
      // Compares month/day only (birthdays/anniversaries recur yearly).
      const thisYear = new Date(today.getFullYear(), month - 1, day);
      const nextYear = new Date(today.getFullYear() + 1, month - 1, day);
      const target = thisYear >= new Date(today.toDateString()) ? thisYear : nextYear;
      const diffDays = Math.round((target - new Date(today.toDateString())) / 86400000);
      return diffDays >= 0 && diffDays <= days;
    };

    const birthdays = [];
    const anniversaries = [];
    const contractExpiring = [];

    for (const e of employees) {
      if (e.birth_date) {
        const d = new Date(e.birth_date);
        if (inNextDays(d.getMonth() + 1, d.getDate(), 14)) {
          birthdays.push({ id: e.id, fullName: e.full_name, date: e.birth_date });
        }
      }
      if (e.hire_date) {
        const d = new Date(e.hire_date);
        if (inNextDays(d.getMonth() + 1, d.getDate(), 14) && d.getFullYear() < today.getFullYear()) {
          anniversaries.push({ id: e.id, fullName: e.full_name, hireDate: e.hire_date, years: today.getFullYear() - d.getFullYear() });
        }
      }
      if (e.contract_type === 'contract' && e.end_date) {
        const diffDays = Math.round((new Date(e.end_date) - today) / 86400000);
        if (diffDays >= 0 && diffDays <= 30) {
          contractExpiring.push({ id: e.id, fullName: e.full_name, endDate: e.end_date, daysLeft: diffDays });
        }
      }
    }

    res.json({ birthdays, anniversaries, contractExpiring });
  })
);

// GET /api/dashboard/anomalies - simple rule-based attendance anomaly flags
// over the last 30 days: chronic lateness and missing checkouts. Not a
// statistical model - transparent thresholds that HR can act on directly.
router.get(
  '/anomalies',
  requireRole('super_admin', 'hr', 'manager'),
  asyncHandler(async (req, res) => {
    const rows = await db.prepare(
        `SELECT e.id, e.full_name, e.employee_code, d.name as department_name,
           SUM(CASE WHEN a.is_late = 1 THEN 1 ELSE 0 END) as late_count,
           SUM(CASE WHEN a.check_in_at IS NOT NULL AND a.check_out_at IS NULL AND a.date < CURDATE() THEN 1 ELSE 0 END) as missing_checkout_count,
           SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) as absent_count
         FROM employees e
         JOIN attendance a ON a.employee_id = e.id AND a.date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
         LEFT JOIN departments d ON d.id = e.department_id
         WHERE e.deleted_at IS NULL
         GROUP BY e.id
         HAVING late_count >= 3 OR missing_checkout_count >= 2 OR absent_count >= 3
         ORDER BY (late_count + missing_checkout_count + absent_count) DESC
         LIMIT 20`
      )
      .all();
    res.json(rows);
  })
);

module.exports = router;
