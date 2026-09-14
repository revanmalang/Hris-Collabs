const LeaveSection = {
  async render(container, { user }) {
    this.user = user;
    const canReview = can('leave.approve');
    container.innerHTML = `
      <div class="toolbar">
        <div class="tabs" id="leave-tabs" style="border:none;margin:0;">
          <div class="tab active" data-tab="list">Daftar Pengajuan</div>
          <div class="tab" data-tab="calendar">Kalender Cuti</div>
        </div>
        <div style="margin-left:auto">
          <button class="btn btn-amber btn-sm" id="new-leave">+ Ajukan Izin/Cuti</button>
        </div>
      </div>
      <div id="leave-body"></div>
    `;
    document.getElementById('new-leave').addEventListener('click', () => this.openForm());
    document.querySelectorAll('#leave-tabs .tab').forEach((t) => t.addEventListener('click', () => {
      document.querySelectorAll('#leave-tabs .tab').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      t.dataset.tab === 'list' ? this.renderList(canReview) : this.renderCalendar();
    }));
    this.renderList(canReview);
  },

  async renderList(canReview) {
    const body = document.getElementById('leave-body');
    body.innerHTML = `<div class="empty-state">Memuat…</div>`;
    let rows;
    try { rows = await api('/leave'); } catch (e) { body.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; return; }
    body.innerHTML = `
      <div class="card table-wrap">
        <table class="data-table">
          <thead><tr><th>Karyawan</th><th>Jenis</th><th>Tanggal</th><th>Alasan</th><th>Status</th>${canReview ? '<th>Aksi</th>' : ''}</tr></thead>
          <tbody>${rows.length ? rows.map((r) => `
            <tr>
              <td>${escapeHtml(r.full_name)}<div class="emp-sub">${escapeHtml(r.department_name || '')}</div></td>
              <td>${escapeHtml(r.type)}</td>
              <td>${fmtDate(r.start_date)} – ${fmtDate(r.end_date)}</td>
              <td class="small">${escapeHtml(r.reason || '—')}</td>
              <td>${statusPill(r.status)}</td>
              ${canReview ? `<td>${r.status === 'pending' ? `
                <button class="btn btn-sm btn-outline" data-approve="${r.id}">Approve</button>
                <button class="btn btn-sm btn-danger" data-reject="${r.id}">Reject</button>` : '—'}</td>` : ''}
            </tr>`).join('') : `<tr><td colspan="6"><div class="empty-state">Belum ada pengajuan</div></td></tr>`}</tbody>
        </table>
      </div>`;
    body.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', () => this.review(b.dataset.approve, 'approve', canReview)));
    body.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', () => this.review(b.dataset.reject, 'reject', canReview)));
  },

  async review(id, action, canReview) {
    let note = null;
    if (action === 'reject') {
      note = prompt('Catatan penolakan (opsional):') || '';
    }
    try {
      await api(`/leave/${id}/${action}`, { method: 'POST', body: { note } });
      toast(action === 'approve' ? 'Pengajuan disetujui' : 'Pengajuan ditolak', 'success');
      this.renderList(canReview);
    } catch (e) { toast(e.message, 'error'); }
  },

  async renderCalendar() {
    const body = document.getElementById('leave-body');
    body.innerHTML = `<div class="empty-state">Memuat…</div>`;
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    let rows;
    try { rows = await api(`/leave/calendar?from=${from}&to=${to}`); } catch (e) { body.innerHTML = escapeHtml(e.message); return; }
    body.innerHTML = `
      <div class="card">
        <div class="card-title">Yang sedang cuti bulan ini <span class="sub">${now.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}</span></div>
        ${rows.length ? rows.map((r) => rowLine(`${r.full_name} (${escapeHtml(r.department_name || '')})`, `${fmtDate(r.start_date)} – ${fmtDate(r.end_date)}`, `<span class="pill pill-leave">${escapeHtml(r.type)}</span>`)).join('') : emptyLine('Tidak ada yang cuti bulan ini')}
      </div>`;
  },

  openForm() {
    openModal({
      title: 'Ajukan Izin / Cuti',
      bodyHtml: `
        <div class="field"><label>Jenis Pengajuan</label>
          <select id="lv-type">
            <option value="izin">Izin</option><option value="sakit">Sakit</option>
            <option value="dinas_luar">Dinas Luar</option><option value="wfh">Work From Home</option>
            <option value="cuti">Cuti</option><option value="keperluan_pribadi">Keperluan Pribadi</option>
          </select>
        </div>
        <div class="form-grid">
          <div class="field"><label>Tanggal Mulai</label><input type="date" id="lv-start" /></div>
          <div class="field"><label>Tanggal Selesai</label><input type="date" id="lv-end" /></div>
        </div>
        <div class="field"><label>Alasan</label><textarea id="lv-reason" rows="3"></textarea></div>
        <div class="field"><label>Lampiran (opsional)</label><input type="file" id="lv-file" /></div>
      `,
      footHtml: `<button class="btn btn-outline" onclick="closeModal()">Batal</button><button class="btn btn-primary" id="lv-submit">Ajukan</button>`,
      onMount: () => {
        document.getElementById('lv-submit').addEventListener('click', async () => {
          const start = document.getElementById('lv-start').value;
          const end = document.getElementById('lv-end').value;
          if (!start || !end) return toast('Tanggal mulai & selesai wajib diisi', 'error');
          const fd = new FormData();
          fd.append('type', document.getElementById('lv-type').value);
          fd.append('startDate', start);
          fd.append('endDate', end);
          fd.append('reason', document.getElementById('lv-reason').value);
          const file = document.getElementById('lv-file').files[0];
          if (file) fd.append('attachment', file);
          try {
            await api('/leave', { method: 'POST', body: fd, isForm: true });
            toast('Pengajuan berhasil dikirim', 'success');
            closeModal();
            route();
          } catch (e) { toast(e.message, 'error'); }
        });
      },
    });
  },
};
