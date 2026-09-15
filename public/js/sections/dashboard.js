const DashboardSection = {
  async render(container, { user }) {
    if (['super_admin', 'hr', 'manager'].includes(user.role)) {
      await this.renderHr(container);
    } else {
      await this.renderEmployee(container, user);
    }
  },

  async renderHr(container) {
    const seq = currentRouteSeq();
    container.innerHTML = `<div class="empty-state">Memuat dashboard…</div>`;
    let data;
    try {
      data = await api('/dashboard/hr');
    } catch (e) {
      if (seq !== currentRouteSeq()) return;
      container.innerHTML = `<div class="empty-state">Gagal memuat dashboard: ${escapeHtml(e.message)}</div>`;
      return;
    }
    if (seq !== currentRouteSeq()) return;
    const s = data.stats;

    container.innerHTML = `
      <div class="grid grid-4">
        ${statCard('users', 'Total Karyawan', s.totalEmployees, `${s.activeEmployees} aktif, ${s.inactiveEmployees} nonaktif`)}
        ${statCard('pulse', 'Hadir Hari Ini', s.presentToday + s.completedToday + s.workingToday, `${s.attendancePercentage}% tingkat kehadiran`)}
        ${statCard('overtime', 'Terlambat', s.lateToday, `Check-in: ${s.checkedInToday}, Check-out: ${s.checkedOutToday}`)}
        ${statCard('leave', 'Izin dan Cuti', s.leaveToday + s.sickToday + s.permissionToday, `${s.pendingLeave} pengajuan pending`)}
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
          <div class="card-title">Check-in Terbaru</div>
          <div id="w-checkins"></div>
        </div>
        <div class="card">
          <div class="card-title">Check-out Terbaru</div>
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
      ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Karyawan</th><th>Jam</th><th>Status</th></tr></thead><tbody>${
          data.recentCheckins.map((c) => `<tr><td><div class="emp-name">${escapeHtml(c.full_name)}</div></td><td class="mono">${fmtTime(c.check_in_at)}</td><td>${statusPill(c.status)}</td></tr>`).join('')
        }</tbody></table></div>`
      : emptyLine('Belum ada check-in hari ini');
    document.getElementById('w-checkouts').innerHTML = data.recentCheckouts.length
      ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Karyawan</th><th>Jam</th></tr></thead><tbody>${
          data.recentCheckouts.map((c) => `<tr><td><div class="emp-name">${escapeHtml(c.full_name)}</div></td><td class="mono">${fmtTime(c.check_out_at)}</td></tr>`).join('')
        }</tbody></table></div>`
      : emptyLine('Belum ada check-out hari ini');
    document.getElementById('w-leave').innerHTML = data.recentLeaveRequests.length
      ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Karyawan</th><th>Jenis</th><th>Status</th></tr></thead><tbody>${
          data.recentLeaveRequests.map((l) => `<tr><td><div class="emp-name">${escapeHtml(l.full_name)}</div></td><td class="muted">${escapeHtml(l.type)}</td><td>${statusPill(l.status)}</td></tr>`).join('')
        }</tbody></table></div>`
      : emptyLine('Belum ada pengajuan');
    document.getElementById('w-activity').innerHTML = data.recentActivity.length
      ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Aksi</th><th>Pengguna</th><th>Waktu</th></tr></thead><tbody>${
          data.recentActivity.map((a) => `<tr><td>${escapeHtml(a.action)}</td><td>${escapeHtml(a.email || '-')}</td><td>${fmtDateTime(a.created_at)}</td></tr>`).join('')
        }</tbody></table></div>`
      : emptyLine('Belum ada aktivitas');

    api('/dashboard/reminders').then((r) => {
      if (seq !== currentRouteSeq()) return;
      const box = document.getElementById('w-reminders');
      if (!box) return;
      const items = [
        ...r.birthdays.map((b) => rowLine(b.fullName, `Ulang tahun ${fmtDate(b.date)}`)),
        ...r.anniversaries.map((a) => rowLine(a.fullName, `${a.years} tahun bekerja`)),
        ...r.contractExpiring.map((c) => rowLine(c.fullName, `Kontrak berakhir ${c.daysLeft} hari lagi`)),
      ];
      box.innerHTML = items.length ? items.join('') : emptyLine('Tidak ada reminder dalam 14 hari ke depan');
    }).catch(() => {
      const box = document.getElementById('w-reminders');
      if (box) box.innerHTML = emptyLine('Gagal memuat reminder');
    });

    api('/dashboard/anomalies').then((rows) => {
      if (seq !== currentRouteSeq()) return;
      const box = document.getElementById('w-anomalies');
      if (!box) return;
      box.innerHTML = rows.length
        ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Karyawan</th><th class="text-right">Telat</th><th class="text-right">Lupa Checkout</th><th class="text-right">Absen</th><th class="text-right">Total</th><th>Tingkat</th></tr></thead><tbody>${
            rows.map((r) => {
              const total = (r.late_count || 0) + (r.missing_checkout_count || 0) + (r.absent_count || 0);
              return `<tr><td><div class="emp-name">${escapeHtml(r.full_name)}</div><div class="emp-sub">${escapeHtml(r.department_name || '-')}</div></td>`
                + `<td class="text-right mono">${r.late_count || 0}</td><td class="text-right mono">${r.missing_checkout_count || 0}</td>`
                + `<td class="text-right mono">${r.absent_count || 0}</td><td class="text-right mono"><strong>${total}</strong></td>`
                + `<td>${anomalyPill(total)}</td></tr>`;
            }).join('')
          }</tbody></table></div>`
        : emptyLine('Tidak ada anomali terdeteksi');
    }).catch(() => {
      const box = document.getElementById('w-anomalies');
      if (box) box.innerHTML = emptyLine('Gagal memuat anomali');
    });

    renderBarChart('chart-daily', s.dailyTrend.map((d) => d.date.slice(5)), [
      { label: 'Hadir', data: s.dailyTrend.map((d) => d.present), color: '#2f6b4a' },
      { label: 'Terlambat', data: s.dailyTrend.map((d) => d.late), color: '#8a5f1c' },
    ]);
    renderBarChart('chart-monthly', s.monthlyTrend.map((d) => d.month), [
      { label: 'Hadir', data: s.monthlyTrend.map((d) => d.present), color: '#2f6b4a' },
      { label: 'Terlambat', data: s.monthlyTrend.map((d) => d.late), color: '#8a5f1c' },
      { label: 'Absen', data: s.monthlyTrend.map((d) => d.absent), color: '#a83226' },
    ]);

    // Re-register cleanly: renderHr() runs on every visit, guard against duplicates.
    window.removeEventListener('hris:stats', this._statsListener);
    this._statsListener = (e) => {
      if (!document.getElementById('chart-daily')) return; // navigated away
      const ns = e.detail;
      container.querySelectorAll('.stat-value')[1].textContent = ns.presentToday + ns.completedToday + ns.workingToday;
      container.querySelectorAll('.stat-value')[2].textContent = ns.lateToday;
    };
    window.addEventListener('hris:stats', this._statsListener);
  },

  async renderEmployee(container, user) {
    const seq = currentRouteSeq();
    let data;
    try {
      data = await api('/dashboard/me');
    } catch (e) {
      if (seq !== currentRouteSeq()) return;
      container.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
      return;
    }
    if (seq !== currentRouteSeq()) return;
    const emp = data.employee;
    if (!emp) {
      container.innerHTML = `<div class="empty-state">Akun ini belum ditautkan ke data karyawan.</div>`;
      return;
    }
    const today = data.today;
    const hour = new Date().getHours();
    const greeting = hour < 11 ? 'Selamat pagi' : hour < 15 ? 'Selamat siang' : hour < 18 ? 'Selamat sore' : 'Selamat malam';

    container.innerHTML = `
      <h2 style="margin:0 0 4px;">${greeting}, ${escapeHtml(emp.full_name.split(' ')[0])}</h2>
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
    if (window.__clockTimer) clearInterval(window.__clockTimer);
    window.__clockTimer = setInterval(() => { if (document.getElementById('clock-time')) tick(); else { clearInterval(window.__clockTimer); window.__clockTimer = null; } }, 1000);

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
      if (seq !== currentRouteSeq()) return;
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
      el.innerHTML = `<button class="btn btn-primary" id="btn-checkin">Check In</button>`;
      document.getElementById('btn-checkin').addEventListener('click', () => this.doCheckAction('check-in'));
    } else if (!hasCheckedOut) {
      el.innerHTML = `<span class="pill pill-present" style="margin-right:8px;">Masuk ${fmtTime(today.check_in_at)}</span><button class="btn btn-primary" id="btn-checkout">Check Out</button>`;
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

function statCard(iconName, label, value, delta) {
  return `<div class="card stat-card">
    <div class="kpi-icon">${icon(iconName, 17)}</div>
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

function anomalyPill(total) {
  const level = total >= 6 ? 'late' : total >= 4 ? 'pending' : 'leave';
  const label = total >= 6 ? 'Tinggi' : total >= 4 ? 'Sedang' : 'Ringan';
  return `<span class="pill pill-${level}">${label}</span>`;
}

const _chartInstances = {};
function renderBarChart(canvasId, labels, series) {
  const ctx = document.getElementById(canvasId);
  if (!ctx || typeof Chart === 'undefined') return;
  if (_chartInstances[canvasId]) _chartInstances[canvasId].destroy();
  _chartInstances[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: series.map((s) => ({ label: s.label, data: s.data, backgroundColor: s.color, borderRadius: 6, maxBarThickness: 26 })) },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, font: { size: 11 } } } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#eef0ea' } },
      },
    },
  });
}
