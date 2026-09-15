const AttendanceSection = {
  live: {
    state: { department: '', status: '', q: '' },

    async render(container) {
      const seq = currentRouteSeq();
      const departments = await api('/departments').catch(() => []);
      if (seq !== currentRouteSeq()) return;
      container.innerHTML = `
        <div class="toolbar">
          <div class="grow"><input id="live-q" placeholder="Cari nama/ID karyawan…" /></div>
          <select id="live-dept"><option value="">Semua Departemen</option>${departments.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('')}</select>
          <select id="live-status">
            <option value="">Semua Status</option>
            ${['present','late','working','completed','leave','sick','permission','absent'].map((s) => `<option value="${s}">${s}</option>`).join('')}
          </select>
          <button class="btn btn-outline btn-sm" id="live-refresh">Refresh</button>
          <button class="btn btn-primary btn-sm" id="live-qr">Generate QR</button>
        </div>
        <div class="grid grid-4" id="live-summary"></div>
        <div class="card mt-16 table-wrap">
          <table class="data-table">
            <thead><tr><th>Karyawan</th><th>Departemen</th><th>Status</th><th>Check-in</th><th>Check-out</th><th>Durasi</th><th>Lokasi</th></tr></thead>
            <tbody id="live-body">${skeletonRows(7, 6)}</tbody>
          </table>
        </div>
      `;
      document.getElementById('live-q').addEventListener('input', debounce((e) => { this.state.q = e.target.value; this.load(); }, 300));
      document.getElementById('live-dept').addEventListener('change', (e) => { this.state.department = e.target.value; this.load(); });
      document.getElementById('live-status').addEventListener('change', (e) => { this.state.status = e.target.value; this.load(); });
      document.getElementById('live-refresh').addEventListener('click', () => this.load());
      document.getElementById('live-qr').addEventListener('click', () => this.openQr());

      this._listener = () => this.load();
      window.addEventListener('hris:attendance-event', this._listener);
      this.load();
    },

    async load() {
      const tbody = document.getElementById('live-body');
      if (!tbody) { window.removeEventListener('hris:attendance-event', this._listener); return; }
      const loadSeq = (this._loadSeq = (this._loadSeq || 0) + 1);
      const { department, status, q } = this.state;
      const params = new URLSearchParams();
      if (department) params.set('department', department);
      if (status) params.set('status', status);
      if (q) params.set('q', q);
      let rows;
      try { rows = await api(`/attendance/live?${params}`); } catch (e) { if (loadSeq !== this._loadSeq) return; tbody.innerHTML = `<tr><td colspan="7">${escapeHtml(e.message)}</td></tr>`; return; }
      if (loadSeq !== this._loadSeq) return;

      const counts = rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
      document.getElementById('live-summary').innerHTML = [
        ['users', rows.length, 'Total ditampilkan'],
        ['pulse', (counts.present||0)+(counts.completed||0)+(counts.working||0), 'Hadir dan Proses'],
        ['overtime', counts.late || 0, 'Terlambat'],
        ['close', counts.absent || 0, 'Absen'],
      ].map(([ic, val, label]) => `<div class="card stat-card"><div class="kpi-icon">${icon(ic, 17)}</div><div class="label">${label}</div><div class="stat-value">${val}</div></div>`).join('');

      tbody.innerHTML = rows.length ? rows.map((r) => `
        <tr>
          <td><div class="emp-cell"><div class="emp-photo">${r.photo_url && safeUrl(r.photo_url) ? `<img src="${escapeHtml(safeUrl(r.photo_url))}"/>` : initials(r.full_name)}</div><div><div class="emp-name">${escapeHtml(r.full_name)}</div><div class="emp-sub">${escapeHtml(r.employee_code)}</div></div></div></td>
          <td>${escapeHtml(r.department_name || '-')}</td>
          <td>${statusPill(r.status)}</td>
          <td>${fmtTime(r.check_in_at)}</td>
          <td>${fmtTime(r.check_out_at)}</td>
          <td>${r.worked_minutes ? (r.worked_minutes/60).toFixed(1) + ' jam' : '-'}</td>
          <td>${escapeHtml(r.location_name || '-')}</td>
        </tr>`).join('') : `<tr><td colspan="7"><div class="empty-state">Tidak ada data</div></td></tr>`;
    },

    async openQr() {
      const locations = await api('/locations').catch(() => []);
      openModal({
        title: 'Generate QR Attendance',
        width: 420,
        bodyHtml: `
          <div class="field"><label>Lokasi</label><select id="qr-loc">${locations.map((l) => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Masa berlaku (detik)</label><input type="number" id="qr-ttl" value="60" /></div>
          <div id="qr-result" style="text-align:center;"></div>
        `,
        footHtml: `<button class="btn btn-outline" data-close-modal>Tutup</button><button class="btn btn-primary" id="qr-gen">Generate</button>`,
        onMount: () => {
          document.getElementById('qr-gen').addEventListener('click', async () => {
            try {
              const res = await api('/attendance/qr/generate', { method: 'POST', body: { locationId: document.getElementById('qr-loc').value, ttlSeconds: Number(document.getElementById('qr-ttl').value) || 60 } });
              document.getElementById('qr-result').innerHTML = `
                <div class="mt-16" style="font-family:monospace;background:var(--neutral-soft);padding:14px;border-radius:8px;word-break:break-all;">${escapeHtml(res.token)}</div>
                <p class="small muted mt-16">Token untuk ${escapeHtml(res.locationName)}, berlaku hingga ${fmtTime(res.expiresAt)}. Karyawan submit token ini via endpoint scan (di aplikasi mobile produksi, ini dirender sebagai QR image).</p>`;
            } catch (e) { toast(e.message, 'error'); }
          });
        },
      });
    },
  },

  history: {
    state: { page: 1, pageSize: 15, from: '', to: '', status: '', department: '' },

    async render(container, { user }) {
      const seq = currentRouteSeq();
      const isSelf = user.role === 'employee';
      const departments = isSelf ? [] : await api('/departments').catch(() => []);
      if (seq !== currentRouteSeq()) return;
      container.innerHTML = `
        <div class="toolbar">
          <input type="date" id="h-from" />
          <input type="date" id="h-to" />
          <select id="h-status"><option value="">Semua Status</option>${['present','late','working','completed','leave','sick','permission','absent'].map((s) => `<option value="${s}">${s}</option>`).join('')}</select>
          ${!isSelf ? `<select id="h-dept"><option value="">Semua Departemen</option>${departments.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('')}</select>` : ''}
          <div class="gap-8" style="margin-left:auto">
            <button class="btn btn-outline btn-sm" id="exp-csv">Export CSV</button>
            <button class="btn btn-outline btn-sm" id="exp-xlsx">Export Excel</button>
            <button class="btn btn-outline btn-sm" id="exp-pdf">Export PDF</button>
          </div>
        </div>
        <div class="card table-wrap">
          <table class="data-table">
            <thead><tr>${isSelf ? '' : '<th>Karyawan</th>'}<th>Tanggal</th><th>Check-in</th><th>Check-out</th><th>Total Jam</th><th>Status</th><th>Keterlambatan</th><th>Lokasi</th></tr></thead>
            <tbody id="h-body">${skeletonRows(isSelf ? 7 : 8, 6)}</tbody>
          </table>
        </div>
        <div id="h-pagination"></div>
      `;
      document.getElementById('h-from').addEventListener('change', (e) => { this.state.from = e.target.value; this.load(isSelf); });
      document.getElementById('h-to').addEventListener('change', (e) => { this.state.to = e.target.value; this.load(isSelf); });
      document.getElementById('h-status').addEventListener('change', (e) => { this.state.status = e.target.value; this.load(isSelf); });
      document.getElementById('h-dept')?.addEventListener('change', (e) => { this.state.department = e.target.value; this.load(isSelf); });
      ['csv', 'xlsx', 'pdf'].forEach((fmt) => document.getElementById(`exp-${fmt}`).addEventListener('click', () => this.exportReport(fmt)));

      this.load(isSelf);
    },

    async load(isSelf) {
      const tbody = document.getElementById('h-body');
      if (!tbody) return;
      const loadSeq = (this._hLoadSeq = (this._hLoadSeq || 0) + 1);
      const { page, pageSize, from, to, status, department } = this.state;
      const params = new URLSearchParams({ page, pageSize });
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (status) params.set('status', status);
      if (department) params.set('department', department);
      let res;
      try { res = await api(`/attendance/history?${params}`); } catch (e) { if (loadSeq !== this._hLoadSeq) return; tbody.innerHTML = `<tr><td colspan="8">${escapeHtml(e.message)}</td></tr>`; return; }
      if (loadSeq !== this._hLoadSeq) return;
      tbody.innerHTML = res.data.length ? res.data.map((r) => `
        <tr>
          ${isSelf ? '' : `<td>${escapeHtml(r.full_name)}<div class="emp-sub">${escapeHtml(r.employee_code)}</div></td>`}
          <td>${fmtDate(r.date)}</td>
          <td>${fmtTime(r.check_in_at)}</td>
          <td>${fmtTime(r.check_out_at)}</td>
          <td>${r.worked_minutes ? (r.worked_minutes/60).toFixed(1) : '-'}</td>
          <td>${statusPill(r.status)}</td>
          <td>${r.is_late ? `${r.late_minutes} menit` : '-'}</td>
          <td>${escapeHtml(r.location_name || '-')}</td>
        </tr>`).join('') : `<tr><td colspan="8"><div class="empty-state">Tidak ada data untuk filter ini</div></td></tr>`;
      const pagi = document.getElementById('h-pagination');
      pagi.innerHTML = '';
      pagi.appendChild(paginationControls(res.page, res.pageSize, res.total, (p) => { this.state.page = p; this.load(isSelf); }));
    },

    exportReport(format) {
      const { from, to, department } = this.state;
      const params = new URLSearchParams({ format });
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (department) params.set('department', department);
      window.open(`/api/reports/attendance?${params}`, '_blank');
    },
  },
};
