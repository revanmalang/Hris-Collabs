const db = require('../db');
const { todayStr } = require('../utils/id');

async function getDashboardStats() {
  const date = todayStr();

  const totals = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM employees WHERE deleted_at IS NULL) as totalEmployees,
         (SELECT COUNT(*) FROM employees WHERE deleted_at IS NULL AND status = 'active') as activeEmployees,
         (SELECT COUNT(*) FROM employees WHERE deleted_at IS NULL AND status != 'active') as inactiveEmployees`
    )
    .get();

  const attendanceToday = await db
    .prepare(`SELECT status, COUNT(*) as c FROM attendance WHERE date = ? GROUP BY status`)
    .all(date);

  const counts = { present: 0, late: 0, working: 0, completed: 0, leave: 0, sick: 0, permission: 0, absent: 0 };
  for (const row of attendanceToday) {
    if (counts[row.status] !== undefined) counts[row.status] = row.c;
  }
  const checkedInRow = await db
    .prepare(`SELECT COUNT(*) as c FROM attendance WHERE date = ? AND check_in_at IS NOT NULL`)
    .get(date);
  const checkedOutRow = await db
    .prepare(`SELECT COUNT(*) as c FROM attendance WHERE date = ? AND check_out_at IS NOT NULL`)
    .get(date);
  const checkedInToday = checkedInRow.c;
  const checkedOutToday = checkedOutRow.c;

  const presentLike = counts.present + counts.late + counts.working + counts.completed;
  const attendancePercentage = totals.activeEmployees
    ? Math.round((presentLike / totals.activeEmployees) * 1000) / 10
    : 0;
  const absentCount = Math.max(totals.activeEmployees - presentLike - counts.leave - counts.sick - counts.permission, 0);

  const dailyTrend = await db
    .prepare(
      `SELECT date,
         SUM(CASE WHEN status IN ('present','late','working','completed') THEN 1 ELSE 0 END) as present,
         SUM(CASE WHEN is_late = 1 THEN 1 ELSE 0 END) as late
       FROM attendance
       WHERE date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
       GROUP BY date ORDER BY date ASC`
    )
    .all();

  const monthlyTrend = await db
    .prepare(
      `SELECT DATE_FORMAT(date, '%Y-%m') as month,
         SUM(CASE WHEN status IN ('present','late','working','completed') THEN 1 ELSE 0 END) as present,
         SUM(CASE WHEN is_late = 1 THEN 1 ELSE 0 END) as late,
         SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent
       FROM attendance
       WHERE date >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 5 MONTH), '%Y-%m-01')
       GROUP BY month ORDER BY month ASC`
    )
    .all();

  const pendingLeaveRow = await db.prepare("SELECT COUNT(*) as c FROM leave_requests WHERE status = 'pending'").get();
  const pendingOvertimeRow = await db.prepare("SELECT COUNT(*) as c FROM overtime_requests WHERE status = 'pending'").get();

  return {
    ...totals,
    date,
    presentToday: counts.present,
    lateToday: counts.late,
    workingToday: counts.working,
    completedToday: counts.completed,
    leaveToday: counts.leave,
    sickToday: counts.sick,
    permissionToday: counts.permission,
    absentToday: absentCount,
    checkedInToday,
    checkedOutToday,
    attendancePercentage,
    dailyTrend,
    monthlyTrend,
    pendingLeave: pendingLeaveRow.c,
    pendingOvertime: pendingOvertimeRow.c,
  };
}

module.exports = { getDashboardStats };
