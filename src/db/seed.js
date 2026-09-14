require('dotenv').config();
const db = require('./index');
const { newId, nowIso, todayStr } = require('../utils/id');
const { hashPassword } = require('../utils/password');

const FIRST_NAMES = ['Budi', 'Siti', 'Andi', 'Dewi', 'Rudi', 'Rina', 'Agus', 'Yuni', 'Hendra', 'Wati', 'Joko', 'Sri', 'Bambang', 'Ani', 'Eko', 'Fitri', 'Dedi', 'Lina', 'Yanto', 'Ratna', 'Wawan', 'Tuti', 'Iwan', 'Nia', 'Adi', 'Sari', 'Dodi', 'Mira', 'Fajar', 'Indah'];
const LAST_NAMES = ['Santoso', 'Wijaya', 'Kurniawan', 'Saputra', 'Pratama', 'Setiawan', 'Susanto', 'Halim', 'Gunawan', 'Hidayat', 'Nugroho', 'Wibowo', 'Permata', 'Utami', 'Kusuma'];

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

async function main() {
  console.log('Seeding EmployeeHub database...');

  const ts = nowIso();

  // ---- Settings ----
  await db.prepare(`INSERT IGNORE INTO settings (id, company_name, timezone, gps_mode) VALUES ('singleton','','Asia/Jakarta','optional')`).run();

  // ---- Locations ----
  const locHQ = newId();
  await db.prepare('INSERT INTO locations (id, name, address, latitude, longitude, radius_meters) VALUES (?,?,?,?,?,?)').run(
    locHQ, 'Head Office Malang', 'Jl. Ijen No. 1, Malang', -7.9797, 112.6304, 150
  );
  const locBranch = newId();
  await db.prepare('INSERT INTO locations (id, name, address, latitude, longitude, radius_meters) VALUES (?,?,?,?,?,?)').run(
    locBranch, 'Branch Surabaya', 'Jl. Basuki Rahmat No. 10, Surabaya', -7.2575, 112.7521, 150
  );

  // ---- Shifts ----
  const shiftMorning = newId();
  const shiftAfternoon = newId();
  const shiftNight = newId();
  await db.prepare('INSERT INTO shifts (id, name, start_time, end_time, grace_period_minutes) VALUES (?,?,?,?,?)').run(shiftMorning, 'Shift Pagi', '08:00', '17:00', 15);
  await db.prepare('INSERT INTO shifts (id, name, start_time, end_time, grace_period_minutes) VALUES (?,?,?,?,?)').run(shiftAfternoon, 'Shift Siang', '13:00', '21:00', 15);
  await db.prepare('INSERT INTO shifts (id, name, start_time, end_time, grace_period_minutes) VALUES (?,?,?,?,?)').run(shiftNight, 'Shift Malam', '22:00', '07:00', 20);

  // ---- Departments ----
  const departments = [];
  for (const name of ['Human Resources', 'Information Technology', 'Finance', 'Operations', 'Marketing', 'Customer Service']) {
    const id = newId();
    await db.prepare('INSERT INTO departments (id, name, description, created_at, updated_at) VALUES (?,?,?,?,?)').run(id, name, `${name} department`, ts, ts);
    departments.push({ id, name });
  }

  // ---- Positions ----
  const positionTitles = {
    'Human Resources': ['HR Manager', 'HR Staff', 'Recruiter'],
    'Information Technology': ['IT Manager', 'Software Engineer', 'IT Support', 'System Administrator'],
    'Finance': ['Finance Manager', 'Accountant', 'Finance Staff'],
    'Operations': ['Operations Manager', 'Operations Staff', 'Warehouse Staff'],
    'Marketing': ['Marketing Manager', 'Marketing Staff', 'Content Creator'],
    'Customer Service': ['CS Manager', 'CS Representative'],
  };
  const positions = [];
  for (const dept of departments) {
    for (const title of positionTitles[dept.name]) {
      const id = newId();
      await db.prepare('INSERT INTO positions (id, title, department_id, created_at) VALUES (?,?,?,?)').run(id, title, dept.id, ts);
      positions.push({ id, title, departmentId: dept.id, isManager: title.includes('Manager') });
    }
  }

  // ---- Leave types ----
  const leaveTypeDefs = [
    ['Annual Leave', 12], ['Sick Leave', 12], ['Personal Leave', 3],
    ['Maternity Leave', 90], ['Paternity Leave', 2], ['Special Leave', 3],
  ];
  const leaveTypes = [];
  for (const [name, quota] of leaveTypeDefs) {
    const id = newId();
    await db.prepare('INSERT INTO leave_types (id, name, default_quota) VALUES (?,?,?)').run(id, name, quota);
    leaveTypes.push({ id, name, quota });
  }

  // ---- Employees (40) ----
  const employees = [];
  const usedCodes = new Set();
  for (let i = 0; i < 40; i++) {
    const dept = departments[i % departments.length];
    const deptPositions = positions.filter((p) => p.departmentId === dept.id);
    const position = deptPositions[i % deptPositions.length];
    const fullName = `${rand(FIRST_NAMES)} ${rand(LAST_NAMES)}`;
    let code;
    do { code = `EMP${String(1000 + i)}`; } while (usedCodes.has(code));
    usedCodes.add(code);

    const id = newId();
    const shift = [shiftMorning, shiftAfternoon, shiftNight][i % 3];
    const location = i % 5 === 0 ? locBranch : locHQ;
    const hireDate = `${randInt(2019, 2025)}-${String(randInt(1, 12)).padStart(2, '0')}-${String(randInt(1, 28)).padStart(2, '0')}`;

    await db.prepare(
      `INSERT INTO employees (
        id, employee_code, full_name, nickname, gender, city, province, phone, email, marital_status,
        emergency_contact_name, emergency_contact_phone, department_id, position_id, location_id, shift_id,
        status, hire_date, contract_type, npwp, bpjs_number, bank_account, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id, code, fullName, fullName.split(' ')[0], i % 2 === 0 ? 'male' : 'female', 'Malang', 'Jawa Timur',
      `08${randInt(100000000, 999999999)}`, `${code.toLowerCase()}@employeehub.demo`, rand(['single', 'married']),
      'Kontak Darurat', `08${randInt(100000000, 999999999)}`, dept.id, position.id, location, shift,
      'active', hireDate, rand(['permanent', 'contract', 'probation']),
      `NPWP-${randInt(100000000, 999999999)}`, `BPJS-${randInt(1000000000, 9999999999)}`, `ACC-${randInt(1000000000, 9999999999)}`,
      ts, ts
    );
    employees.push({ id, code, fullName, departmentId: dept.id, positionTitle: position.title, isManager: position.isManager, shiftId: shift });

    for (const lt of leaveTypes) {
      await db.prepare('INSERT INTO leave_balances (id, employee_id, leave_type_id, year, quota, used) VALUES (?,?,?,?,?,0)').run(
        newId(), id, lt.id, new Date().getFullYear(), lt.quota
      );
    }
  }

  // Assign managers per department (the "Manager" position holder manages the rest)
  for (const dept of departments) {
    const deptEmployees = employees.filter((e) => e.departmentId === dept.id);
    const manager = deptEmployees.find((e) => e.isManager) || deptEmployees[0];
    if (!manager) continue;
    await db.prepare('UPDATE departments SET manager_id = ? WHERE id = ?').run(manager.id, dept.id);
    for (const e of deptEmployees) {
      if (e.id !== manager.id) {
        await db.prepare('UPDATE employees SET manager_id = ? WHERE id = ?').run(manager.id, e.id);
      }
    }
  }

  // ---- Demo user accounts (one per role, clearly separate from any production password) ----
  const demoAccounts = [
    { email: 'admin@employeehub.demo', role: 'super_admin', password: 'Admin#2026', employeeId: null },
    { email: 'hr@employeehub.demo', role: 'hr', password: 'HrDemo#2026', employeeId: null },
    { email: 'manager@employeehub.demo', role: 'manager', password: 'ManagerDemo#2026', employeeId: employees.find((e) => e.isManager)?.id || null },
    { email: 'employee@employeehub.demo', role: 'employee', password: 'EmployeeDemo#2026', employeeId: employees.find((e) => !e.isManager)?.id || null },
  ];
  for (const acc of demoAccounts) {
    const hash = await hashPassword(acc.password);
    await db.prepare('INSERT INTO users (id, email, password, role, employee_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(
      newId(), acc.email, hash, acc.role, acc.employeeId, ts, ts
    );
  }
  // Give every non-demo employee a login too (password = employee code, forces change on first login)
  for (const e of employees) {
    if (demoAccounts.some((a) => a.employeeId === e.id)) continue;
    const hash = await hashPassword(e.code);
    await db.prepare('INSERT INTO users (id, email, password, role, employee_id, must_change_pw, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?)').run(
      newId(), `${e.code.toLowerCase()}@employeehub.demo`, hash, e.isManager ? 'manager' : 'employee', e.id, ts, ts
    );
  }

  // ---- Sample attendance for the last 14 days ----
  for (let d = 13; d >= 0; d--) {
    const date = new Date();
    date.setDate(date.getDate() - d);
    const dateStr = todayStr(date);
    const isWeekend = [0, 6].includes(date.getDay());
    for (const e of employees) {
      const roll = Math.random();
      let status = 'present';
      let isLate = 0, lateMinutes = 0, checkInAt = null, checkOutAt = null, workedMinutes = null;

      if (isWeekend) continue; // no attendance rows on weekends (matches "hari libur" concept)
      if (roll < 0.05) status = 'absent';
      else if (roll < 0.08) status = 'sick';
      else if (roll < 0.11) status = 'leave';
      else if (roll < 0.13) status = 'permission';
      else if (roll < 0.28) { status = 'late'; isLate = 1; lateMinutes = randInt(5, 45); }

      if (['present', 'late'].includes(status)) {
        const inHour = 8 + (isLate ? Math.floor(lateMinutes / 60) : 0);
        const inMin = isLate ? lateMinutes % 60 : randInt(0, 10);
        const inDate = new Date(date); inDate.setHours(inHour, inMin, 0, 0);
        checkInAt = inDate.toISOString();
        if (d !== 0) {
          const outDate = new Date(inDate.getTime() + randInt(7, 9) * 3600000);
          checkOutAt = outDate.toISOString();
          workedMinutes = Math.round((outDate - inDate) / 60000);
          status = 'completed';
        } else if (Math.random() < 0.6) {
          const outDate = new Date(inDate.getTime() + randInt(7, 9) * 3600000);
          checkOutAt = outDate.toISOString();
          workedMinutes = Math.round((outDate - inDate) / 60000);
          status = 'completed';
        } else {
          status = 'working';
        }
      }

      await db.prepare(
        `INSERT IGNORE INTO attendance (id, employee_id, date, check_in_at, check_out_at, status, is_late, late_minutes, worked_minutes, location_id, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(newId(), e.id, dateStr, checkInAt, checkOutAt, status, isLate, lateMinutes, workedMinutes, locHQ, ts, ts);
    }
  }

  // ---- A few sample leave/overtime requests ----
  for (let i = 0; i < 6; i++) {
    const e = rand(employees);
    const lt = rand(leaveTypes);
    const start = new Date();
    start.setDate(start.getDate() + randInt(1, 20));
    const end = new Date(start);
    end.setDate(end.getDate() + randInt(0, 2));
    await db.prepare(
      `INSERT INTO leave_requests (id, employee_id, leave_type_id, type, start_date, end_date, reason, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(newId(), e.id, lt.id, 'cuti', todayStr(start), todayStr(end), 'Keperluan keluarga', i % 3 === 0 ? 'pending' : rand(['approved', 'rejected']), ts, ts);
  }

  // ---- Sample announcement ----
  await db.prepare(
    `INSERT INTO announcements (id, title, content, publish_at, created_at) VALUES (?,?,?,NOW(),?)`
  ).run(newId(), 'Selamat Datang di EmployeeHub', 'Sistem HRIS baru sudah aktif. Silakan gunakan akun demo Anda untuk login.', ts);

  // ---- Holidays sample ----
  const holidays = [['Tahun Baru', '2026-01-01'], ['Hari Kemerdekaan', '2026-08-17'], ['Hari Buruh', '2026-05-01']];
  for (const [name, date] of holidays) {
    await db.prepare('INSERT INTO holidays (id, name, date) VALUES (?,?,?)').run(newId(), name, date);
  }

  console.log('Seed complete.');
  console.log('');
  console.log('Demo accounts (see README for the full list):');
  demoAccounts.forEach((a) => console.log(`  ${a.role.padEnd(12)} ${a.email.padEnd(28)} ${a.password}`));
  await db.pool.end();
}

main()
  .catch((err) => {
    const { explainDbError } = require('./friendlyErrors');
    const friendly = explainDbError(err);
    if (friendly) {
      console.error('\n❌ Seed gagal:\n');
      console.error(friendly);
      console.error('');
    } else {
      console.error(err);
    }
    process.exit(1);
  });
