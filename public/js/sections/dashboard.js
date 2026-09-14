const DashboardSection = {
  async render(container, { user }) {
    if (['super_admin', 'hr', 'manager'].includes(user.role)) {
      await this.renderHr(container);
    } else {
      await this.renderEmployee(container, user);
    }
  },

  async renderHr(container) {
    container.innerHTML = `<div class="empty-state">Memuat dashboard…</div>`;
    let data;
    try {
      data = await api('/dashboard/hr');
    } catch (e) {
      container.innerHTML = `<div class="empty-state">Gagal memuat dashboard: ${escapeHtml(e.message)}</div>`;
      return;
    }
    const s = data.stats;

    container.innerHTML = `
      <div class="grid grid-4">
        ${statCard('👥', 'var(--navy-100)', 'var(--navy-800)', 'Total Karyawan', s.totalEmployees, `${s.activeEmployees} aktif · ${s.inactiveEmployees} nonaktif`)}
        ${statCard('✅', 'var(--green-100)', 'var(--green)', 'Hadir Hari Ini', s.presentToday + s.completedToday + s.workingToday, `${s.attendancePercentage}% tingkat kehadiran`)}
        ${statCard('⏰', 'var(--amber-100)', 'var(--amber-dark)', 'Terlambat', s.lateToday, `Check-in: ${s.checkedInToday} · Check-out: ${s.checkedOutToday}`)}
        ${statCard('🌴', 'var(--blue-100)', 'var(--blue)', 'Izin / Cuti / Sakit', s.leaveToday + s.sickToday + s.permissionToday, `${s.pendingLeave} pengajuan pending`)}
      </div>

      <div class="grid grid-2 mt-16">
        <div class="card">
          <div class="card-title">Absensi 7 Hari Terakhir</div>
          <canvas id="chart-daily" height="140"></canvas>
        </div>
        <div class="card">
          <div class="card-title">Tren Bulanan</div>
          <canvas id="chart-monthly" height="140"></canvas>
        </div>
      </div>

      <div class="grid grid-3 mt-16">
        <div class="card">
          <div class="card-title">Karyawan Baru Check-in</div>
          <div id="w-checkins"></div>
        </div>
        <div class="card">
          <div class="card-title">Karyawan Baru Check-out</div>
          <div id="w-checkouts"></div>
        </div>
        <div class="card">
          <div class="card-title">Pengajuan Izin/Cuti Terbaru</div>
          <div id="w-leave"></div>
        </div>
      </div>

      <div class="grid grid-2 mt-16">
        <div class="card">
          <div class="card-title">Reminder HR <span class="sub">Ulang tahun · Anniversary · Kontrak</span></div>
          <div id="w-reminders"><div class="empty-state">Memuat…</div></div>
        </div>
        <div class="card">
          <div class="card-title">Anomali Kehadiran <span class="sub">30 hari terakhir</span></div>
          <div id="w-anomalies"><div class="empty-state">Memuat…</div></div>
        </div>
      </div>

      <div class="card mt-16">
        <div class="card-title">Aktivitas Terbaru <span class="sub">Audit trail ringkas</span></div>
        <div id="w-activity"></div>
      </div>
    `;

    document.getElementById('w-checkins').innerHTML = data.recentCheckins.length
      ? data.recentCheckins.map((c) => rowLine(c.full_name, fmtTime(c.check_in_at), statusPill(c.status))).join('')
      : emptyLine('Belum ada check-in hari ini');
    document.getElementById('w-checkouts').innerHTML = data.recentCheckouts.length
      ? data.recentCheckouts.map((c) => rowLine(c.full_name, fmtTime(c.check_out_at))).join('')
      : emptyLine('Belum ada check-out hari ini');
    document.getElementById('w-leave').innerHTML = data.recentLeaveRequests.length
      ? data.recentLeaveRequests.map((l) => rowLine(l.full_name, l.type, statusPill(l.status))).join('')
      : emptyLine('Belum ada pengajuan');
    document.getElementById('w-activity').innerHTML = data.recentActivity.length
      ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Aksi</th><th>Pengguna</th><th>Waktu</th></tr></thead><tbody>${
          data.recentActivity.map((a) => `<tr><td>${escapeHtml(a.action)}</td><td>${escapeHtml(a.email || '—')}</td><td>${fmtDateTime(a.created_at)}</td></tr>`).join('')
        }</tbody></table></div>`
      : emptyLine('Belum ada aktivitas');

    api('/dashboard/reminders').then((r) => {
      const box = document.getElementById('w-reminders');
      if (!box) return;
      const items = [
        ...r.birthdays.map((b) => rowLine(`🎂 ${b.fullName}`, fmtDate(b.date))),
        ...r.anniversaries.map((a) => rowLine(`🎉 ${a.fullName}`, `${a.years} tahun bekerja`)),
        ...r.contractExpiring.map((c) => rowLine(`⚠️ ${c.fullName}`, `Kontrak berakhir ${c.daysLeft} hari lagi`)),
      ];
      box.innerHTML = items.length ? items.join('') : emptyLine('Tidak ada reminder dalam 14 hari ke depan');
    }).catch(() => {});

    api('/dashboard/anomalies').then((rows) => {
      const box = document.getElementById('w-anomalies');
      if (!box) return;
      box.innerHTML = rows.length
        ? rows.map((r) => rowLine(
            `${r.full_name} (${r.department_name || '—'})`,
            `${r.late_count}x telat · ${r.missing_checkout_count}x lupa checkout · ${r.absent_count}x absen`
          )).join('')
        : emptyLine('Tidak ada anomali terdeteksi');
    }).catch(() => {});

    renderBarChart('chart-daily', s.dailyTrend.map((d) => d.date.slice(5)), [
      { label: 'Hadir', data: s.dailyTrend.map((d) => d.present), color: '#3f7355' },
      { label: 'Terlambat', data: s.dailyTrend.map((d) => d.late), color: '#a8763b' },
    ]);
    renderBarChart('chart-monthly', s.monthlyTrend.map((d) => d.month), [
      { label: 'Hadir', data: s.monthlyTrend.map((d) => d.present), color: '#3f7355' },
      { label: 'Terlambat', data: s.monthlyTrend.map((d) => d.late), color: '#a8763b' },
      { label: 'Absen', data: s.monthlyTrend.map((d) => d.absent), color: '#a8452f' },
    ]);

    window.addEventListener('hris:stats', (e) => {
      if (!document.getElementById('chart-daily')) return; // navigated away
      const ns = e.detail;
      container.querySelectorAll('.stat-value')[1].textContent = ns.presentToday + ns.completedToday + ns.workingToday;
      container.querySelectorAll('.stat-value')[2].textContent = ns.lateToday;
    }, { once: false });
  },

  async renderEmployee(container, user) {
    let data;
    try {
      data = await api('/dashboard/me');
    } catch (e) {
      container.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
      return;
    }
    const emp = data.employee;
    if (!emp) {
      container.innerHTML = `<div class="empty-state">Akun ini belum ditautkan ke data karyawan.</div>`;
      return;
    }
    const today = data.today;
    const hour = new Date().getHours();
    const greeting = hour < 11 ? 'Selamat pagi' : hour < 15 ? 'Selamat siang' : hour < 18 ? 'Selamat sore' : 'Selamat malam';

    container.innerHTML = `
      <h2 style="margin:0 0 4px;">${greeting}, ${escapeHtml(emp.full_name.split(' ')[0])} 👋</h2>
      <p class="muted" style="margin:0 0 18px;">${escapeHtml(emp.position_title || '')} · ${escapeHtml(emp.department_name || '')}</p>

      <div class="checkclock">
        <div>
          <div class="date" id="clock-date"></div>
          <div class="time" id="clock-time"></div>
        </div>
        <div class="actions" id="clock-actions"></div>
      </div>

      <div class="grid grid-3 mt-16">
        <div class="card">
          <div class="card-title">Saldo Cuti</div>
          <div id="w-balance"></div>
        </div>
        <div class="card">
          <div class="card-title">Riwayat Absensi Terbaru</div>
          <div id="w-recent"></div>
        </div>
        <div class="card">
          <div class="card-title">Pengajuan Pending</div>
          <div id="w-pending"></div>
        </div>
      </div>

      <div class="card mt-16">
        <div class="card-title">Pengumuman</div>
        <div id="w-announce"></div>
      </div>
    `;

    const tick = () => {
      const now = new Date();
      const dt = document.getElementById('clock-date');
      const tm = document.getElementById('clock-time');
      if (!dt) return;
      dt.textContent = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      tm.textContent = now.toLocaleTimeString('id-ID');
    };
    tick();
    const clockTimer = setInterval(() => { if (document.getElementById('clock-time')) tick(); else clearInterval(clockTimer); }, 1000);

    this.renderClockActions(today);

    document.getElementById('w-balance').innerHTML = data.leaveBalance.length
      ? data.leaveBalance.map((b) => {
          const pct = b.quota ? Math.min((b.used / b.quota) * 100, 100) : 0;
          return `<div style="margin-bottom:10px;">
            <div class="flex-between small"><span>${escapeHtml(b.leave_type_name)}</span><span class="muted">${b.used}/${b.quota} hari</span></div>
            <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
          </div>`;
        }).join('')
      : emptyLine('Belum ada data saldo cuti');

    document.getElementById('w-recent').innerHTML = data.recentAttendance.length
      ? data.recentAttendance.map((a) => rowLine(fmtDate(a.date), fmtTime(a.check_in_at), statusPill(a.status))).join('')
      : emptyLine('Belum ada riwayat');

    document.getElementById('w-pending').innerHTML = data.pendingRequests.length
      ? data.pendingRequests.map((p) => rowLine(p.kind === 'leave' ? `Izin/Cuti: ${p.type}` : 'Lembur', fmtDate(p.created_at), statusPill(p.status))).join('')
      : emptyLine('Tidak ada pengajuan pending');

    try {
      const announcements = await api('/announcements');
      document.getElementById('w-announce').innerHTML = announcements.length
        ? announcements.map((a) => `<div style="padding:8px 0;border-bottom:1px solid var(--border);"><strong style="font-size:13px;">${escapeHtml(a.title)}</strong><div class="small muted">${escapeHtml(a.content)}</div></div>`).join('')
        : emptyLine('Belum ada pengumuman');
    } catch { /* ignore */ }
  },

  renderClockActions(today) {
    const el = document.getElementById('clock-actions');
    const hasCheckedIn = today && today.check_in_at;
    const hasCheckedOut = today && today.check_out_at;

    if (!hasCheckedIn) {
      el.innerHTML = `<button class="btn btn-amber" id="btn-checkin">Check In</button>`;
      document.getElementById('btn-checkin').addEventListener('click', () => this.doCheckAction('check-in'));
    } else if (!hasCheckedOut) {
      el.innerHTML = `<span class="pill pill-present" style="margin-right:8px;">Masuk ${fmtTime(today.check_in_at)}</span><button class="btn btn-amber" id="btn-checkout">Check Out</button>`;
      document.getElementById('btn-checkout').addEventListener('click', () => this.doCheckAction('check-out'));
    } else {
      el.innerHTML = `<span class="pill pill-completed">Selesai · ${((today.worked_minutes || 0) / 60).toFixed(1)} jam</span>`;
    }
  },

  async doCheckAction(action) {
    const btn = document.getElementById(action === 'check-in' ? 'btn-checkin' : 'btn-checkout');
    if (btn) { btn.disabled = true; btn.textContent = 'Memproses…'; }
    const submit = (coords) => {
      const body = coords ? { latitude: coords.latitude, longitude: coords.longitude } : {};
      return api(`/attendance/${action}`, { method: 'POST', body });
    };
    try {
      let result;
      if (navigator.geolocation) {
        result = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => submit(pos.coords).then(resolve).catch(reject),
            () => submit(null).then(resolve).catch(reject), // GPS denied/unavailable -> submit without location (server enforces gps_mode)
            { timeout: 6000 }
          );
        });
      } else {
        result = await submit(null);
      }
      toast(action === 'check-in' ? `Check-in berhasil${result.isLate ? ' (terlambat)' : ''}` : 'Check-out berhasil', 'success');
      route(); // re-render dashboard with fresh state
    } catch (e) {
      toast(e.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = action === 'check-in' ? 'Check In' : 'Check Out'; }
    }
  },
};

function statCard(icon, iconBg, iconColor, label, value, delta) {
  return `<div class="card stat-card">
    <div class="stat-icon" style="background:${iconBg};color:${iconColor}">${icon}</div>
    <div class="label">${escapeHtml(label)}</div>
    <div class="stat-value">${value}</div>
    <div class="delta">${escapeHtml(delta)}</div>
  </div>`;
}
function rowLine(left, mid, right = '') {
  return `<div class="flex-between" style="padding:7px 0;border-bottom:1px solid var(--border);font-size:13px;">
    <span>${escapeHtml(left)}</span><span class="muted small">${escapeHtml(mid)}</span>${right ? `<span>${right}</span>` : ''}
  </div>`;
}
function emptyLine(msg) { return `<div class="small muted" style="padding:10px 0;">${escapeHtml(msg)}</div>`; }

const _chartInstances = {};
function renderBarChart(canvasId, labels, series) {
  const ctx = document.getElementById(canvasId);
  if (!ctx || typeof Chart === 'undefined') return;
  if (_chartInstances[canvasId]) _chartInstances[canvasId].destroy();
  _chartInstances[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: series.map((s) => ({ label: s.label, data: s.data, backgroundColor: s.color, borderRadius: 4 })) },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
      scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}
