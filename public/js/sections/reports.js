const ReportsSection = {
  kinds: [
    ['attendance', 'Laporan Absensi'], ['late', 'Laporan Keterlambatan'], ['absence', 'Laporan Absen'],
    ['leave', 'Laporan Izin dan Cuti'], ['overtime', 'Laporan Lembur'], ['employee', 'Laporan Karyawan'], ['department', 'Laporan Departemen'],
  ],

  async render(container) {
    container.innerHTML = `
      <div class="tabs" id="rep-tabs">
        <div class="tab active" data-tab="reports">Reporting Center</div>
        <div class="tab" data-tab="payroll">Payroll Preparation</div>
      </div>
      <div id="rep-body"></div>
    `;
    document.querySelectorAll('#rep-tabs .tab').forEach((t) => t.addEventListener('click', () => {
      document.querySelectorAll('#rep-tabs .tab').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      t.dataset.tab === 'reports' ? this.renderReports() : this.renderPayroll();
    }));
    this.renderReports();
  },

  renderReports() {
    const body = document.getElementById('rep-body');
    body.innerHTML = `
      <div class="toolbar">
        <select id="rep-kind">${this.kinds.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
        <input type="date" id="rep-from" /> <input type="date" id="rep-to" />
        <button class="btn btn-outline btn-sm" id="rep-preview">Preview</button>
        <div class="gap-8" style="margin-left:auto">
          <button class="btn btn-outline btn-sm" id="rep-csv">CSV</button>
          <button class="btn btn-outline btn-sm" id="rep-xlsx">Excel</button>
          <button class="btn btn-outline btn-sm" id="rep-pdf">PDF</button>
        </div>
      </div>
      <div id="rep-preview-body" class="card table-wrap"><div class="empty-state">Pilih jenis laporan lalu klik Preview.</div></div>
    `;
    const buildParams = (extra = {}) => {
      const p = new URLSearchParams({ ...extra });
      const from = document.getElementById('rep-from').value;
      const to = document.getElementById('rep-to').value;
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      return p;
    };
    document.getElementById('rep-preview').addEventListener('click', async () => {
      const kind = document.getElementById('rep-kind').value;
      const box = document.getElementById('rep-preview-body');
      const reqSeq = (this._reqSeq = (this._reqSeq || 0) + 1);
      box.innerHTML = `<div class="empty-state">Memuat…</div>`;
      try {
        const res = await api(`/reports/${kind}?${buildParams({ format: 'json' })}`);
        if (reqSeq !== this._reqSeq) return;
        if (!res.data.length) { box.innerHTML = `<div class="empty-state">Tidak ada data</div>`; return; }
        const cols = Object.keys(res.data[0]);
        box.innerHTML = `<table class="data-table"><thead><tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
          <tbody>${res.data.slice(0, 100).map((r) => `<tr>${cols.map((c) => `<td>${escapeHtml(r[c] ?? '-')}</td>`).join('')}</tr>`).join('')}</tbody></table>
          ${res.data.length > 100 ? `<div class="small muted" style="padding:10px;">Menampilkan 100 dari ${res.data.length} baris. Export untuk data lengkap.</div>` : ''}`;
      } catch (e) { box.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; }
    });
    ['csv', 'xlsx', 'pdf'].forEach((fmt) => document.getElementById(`rep-${fmt}`).addEventListener('click', () => {
      const kind = document.getElementById('rep-kind').value;
      window.open(`/api/reports/${kind}?${buildParams({ format: fmt })}`, '_blank');
    }));
  },

  renderPayroll() {
    const body = document.getElementById('rep-body');
    const month = new Date().toISOString().slice(0, 7);
    body.innerHTML = `
      <div class="toolbar"><input type="month" id="pr-month" value="${month}" /><button class="btn btn-outline btn-sm" id="pr-load">Muat Data</button></div>
      <div id="pr-body" class="card table-wrap"><div class="empty-state">Pilih bulan lalu klik Muat Data.</div></div>
    `;
    document.getElementById('pr-load').addEventListener('click', async () => {
      const box = document.getElementById('pr-body');
      const reqSeq = (this._reqSeq = (this._reqSeq || 0) + 1);
      box.innerHTML = `<div class="empty-state">Memuat…</div>`;
      try {
        const res = await api(`/reports/payroll-prep/${document.getElementById('pr-month').value}`);
        if (reqSeq !== this._reqSeq) return;
        box.innerHTML = `
          <table class="data-table">
            <thead><tr><th>Karyawan</th><th>Departemen</th><th>Hadir</th><th>Terlambat</th><th>Cuti</th><th>Sakit</th><th>Izin</th><th>Absen</th><th>Total Jam</th></tr></thead>
            <tbody>${res.data.map((r) => `<tr>
              <td>${escapeHtml(r.employee_code)} · ${escapeHtml(r.full_name)}</td><td>${escapeHtml(r.department || '-')}</td>
              <td>${r.days_present}</td><td>${r.days_late}</td><td>${r.days_leave}</td><td>${r.days_sick}</td><td>${r.days_permission}</td><td>${r.days_absent}</td>
              <td>${Number(r.total_worked_hours).toFixed(1)}</td>
            </tr>`).join('')}</tbody>
          </table>
          <p class="small muted" style="padding:10px;">${escapeHtml(res.note)}</p>`;
      } catch (e) { box.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; }
    });
  },
};
