const express = require('express');
const { Parser } = require('json2csv');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireRole, requirePermission } = require('../middleware/rbac');
const { logAudit } = require('../utils/audit');
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(requireAuth, requirePermission('reports.view'));

async function attendanceReportRows({ from, to, department }) {
  const where = ['a.date >= @from', 'a.date <= @to'];
  const params = { from: from || '0000-01-01', to: to || '9999-12-31' };
  if (department) { where.push('e.department_id = @department'); params.department = department; }
  return db.prepare(
      `SELECT e.employee_code, e.full_name, d.name as department, a.date, a.status,
              a.check_in_at, a.check_out_at, a.is_late, a.late_minutes, a.worked_minutes
       FROM attendance a JOIN employees e ON e.id = a.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
       WHERE ${where.join(' AND ')} ORDER BY a.date DESC, e.full_name`
    )
    .all(params);
}

async function reportKindQuery(kind, { from, to, department }) {
  switch (kind) {
    case 'attendance':
      return attendanceReportRows({ from, to, department });
    case 'late':
      return (await attendanceReportRows({ from, to, department })).filter((r) => r.is_late);
    case 'absence':
      return (await attendanceReportRows({ from, to, department })).filter((r) => r.status === 'absent');
    case 'leave': {
      const where = ['lr.start_date <= @to', 'lr.end_date >= @from'];
      const params = { from: from || '0000-01-01', to: to || '9999-12-31' };
      if (department) { where.push('e.department_id = @department'); params.department = department; }
      return db.prepare(
          `SELECT e.employee_code, e.full_name, lr.type, lr.start_date, lr.end_date, lr.status
           FROM leave_requests lr JOIN employees e ON e.id = lr.employee_id
           LEFT JOIN departments d ON d.id = e.department_id
           WHERE ${where.join(' AND ')} ORDER BY lr.start_date DESC`
        )
        .all(params);
    }
    case 'overtime': {
      const where = ['o.date >= @from', 'o.date <= @to'];
      const params = { from: from || '0000-01-01', to: to || '9999-12-31' };
      return db.prepare(
          `SELECT e.employee_code, e.full_name, o.date, o.start_time, o.end_time, o.total_minutes, o.status
           FROM overtime_requests o JOIN employees e ON e.id = o.employee_id
           WHERE ${where.join(' AND ')} ORDER BY o.date DESC`
        )
        .all(params);
    }
    case 'employee':
      return db.prepare(
          `SELECT e.employee_code, e.full_name, d.name as department, p.title as position, e.status, e.hire_date, e.contract_type
           FROM employees e LEFT JOIN departments d ON d.id = e.department_id
           LEFT JOIN positions p ON p.id = e.position_id WHERE e.deleted_at IS NULL ORDER BY e.full_name`
        )
        .all();
    case 'department': {
      return db.prepare(
          `SELECT d.name as department,
             (SELECT COUNT(*) FROM employees e WHERE e.department_id = d.id AND e.deleted_at IS NULL) as employee_count
           FROM departments d WHERE d.deleted_at IS NULL ORDER BY d.name`
        )
        .all();
    }
    default:
      throw new ApiError(400, `Unknown report kind: ${kind}`);
  }
}

// GET /api/reports/:kind?format=json|csv|xlsx|pdf&from=&to=&department=
router.get(
  '/:kind',
  asyncHandler(async (req, res) => {
    const { kind } = req.params;
    const { format = 'json', from, to, department } = req.query;
    const rows = await reportKindQuery(kind, { from, to, department });

    await logAudit({ userId: req.user.id, action: 'report_export', objectType: 'report', objectId: kind, req, metadata: { format, from, to } });

    if (format === 'json') return res.json({ data: rows, total: rows.length });

    if (format === 'csv') {
      if (rows.length === 0) return res.status(200).type('text/csv').send('');
      const parser = new Parser({ fields: Object.keys(rows[0]) });
      const csv = parser.parse(rows);
      res.header('Content-Type', 'text/csv');
      res.attachment(`${kind}-report.csv`);
      return res.send(csv);
    }

    if (format === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet(kind);
      if (rows.length > 0) {
        sheet.columns = Object.keys(rows[0]).map((k) => ({ header: k, key: k, width: 20 }));
        sheet.addRows(rows);
        sheet.getRow(1).font = { bold: true };
      }
      res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.attachment(`${kind}-report.xlsx`);
      await workbook.xlsx.write(res);
      return res.end();
    }

    if (format === 'pdf') {
      res.header('Content-Type', 'application/pdf');
      res.attachment(`${kind}-report.pdf`);
      const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
      doc.pipe(res);
      doc.fontSize(16).text(`EmployeeHub — ${kind} report`, { align: 'left' });
      doc.moveDown(0.5);
      doc.fontSize(9);
      if (rows.length > 0) {
        const cols = Object.keys(rows[0]);
        doc.text(cols.join('   |   '));
        doc.moveDown(0.3);
        rows.slice(0, 500).forEach((r) => {
          doc.text(cols.map((c) => String(r[c] ?? '')).join('   |   '));
        });
      } else {
        doc.text('No data for the selected filters.');
      }
      doc.end();
      return;
    }

    throw new ApiError(400, `Unknown export format: ${format}`);
  })
);

// GET /api/reports/payroll-prep/:month (YYYY-MM) — aggregated attendance data for payroll export
router.get(
  '/payroll-prep/:month',
  asyncHandler(async (req, res) => {
    const { month } = req.params; // YYYY-MM
    const rows = await db.prepare(
        `SELECT e.employee_code, e.full_name, d.name as department,
           COUNT(a.id) as recorded_days,
           SUM(CASE WHEN a.status IN ('present','late','working','completed') THEN 1 ELSE 0 END) as days_present,
           SUM(CASE WHEN a.is_late = 1 THEN 1 ELSE 0 END) as days_late,
           SUM(CASE WHEN a.status = 'leave' THEN 1 ELSE 0 END) as days_leave,
           SUM(CASE WHEN a.status = 'sick' THEN 1 ELSE 0 END) as days_sick,
           SUM(CASE WHEN a.status = 'permission' THEN 1 ELSE 0 END) as days_permission,
           SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) as days_absent,
           COALESCE(SUM(a.worked_minutes), 0) / 60.0 as total_worked_hours,
           COALESCE(SUM(a.late_minutes), 0) as total_late_minutes
         FROM employees e
         LEFT JOIN attendance a ON a.employee_id = e.id AND a.date LIKE CONCAT(@month, '%')
         LEFT JOIN departments d ON d.id = e.department_id
          WHERE e.deleted_at IS NULL AND e.status = 'active'
          GROUP BY e.id, e.employee_code, e.full_name, d.name ORDER BY e.full_name`
      )
      .all({ month });

    const overtimeByEmployee = await db.prepare(
        `SELECT employee_id, COALESCE(SUM(total_minutes),0) as overtime_minutes
         FROM overtime_requests WHERE date LIKE CONCAT(@month, '%') AND status = 'approved' GROUP BY employee_id`
      )
      .all({ month });
    const otMap = Object.fromEntries(overtimeByEmployee.map((o) => [o.employee_id, o.overtime_minutes]));

    const enriched = rows.map((r) => ({ ...r, overtime_hours: 0 }));

    await logAudit({ userId: req.user.id, action: 'payroll_prep_export', objectType: 'payroll', objectId: month, req });
    res.json({ month, data: enriched, note: 'Export this to your payroll system. Overtime totals are approved-only.', overtimeMinutesByEmployee: otMap });
  })
);

module.exports = router;
