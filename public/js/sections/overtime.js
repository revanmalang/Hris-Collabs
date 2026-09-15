const OvertimeSection = {
  async render(container, { user }) {
    const canReview = can('overtime.approve');
    container.innerHTML = `
      <div class="toolbar"><div style="margin-left:auto"><button class="btn btn-primary btn-sm" id="new-ot">Ajukan Lembur</button></div></div>
      <div id="ot-body"><div class="empty-state">Memuat…</div></div>
    `;
    document.getElementById('new-ot').addEventListener('click', () => this.openForm());
    this.load(canReview);
  },

  async load(canReview) {
    const body = document.getElementById('ot-body');
    const loadSeq = (this._loadSeq = (this._loadSeq || 0) + 1);
    let rows;
    try { rows = await api('/overtime'); } catch (e) { if (loadSeq !== this._loadSeq) return; body.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; return; }
    if (loadSeq !== this._loadSeq) return;
    body.innerHTML = `
      <div class="card table-wrap">
        <table class="data-table">
          <thead><tr><th>Karyawan</th><th>Tanggal</th><th>Jam</th><th>Total</th><th>Alasan</th><th>Status</th>${canReview ? '<th>Aksi</th>' : ''}</tr></thead>
          <tbody>${rows.length ? rows.map((r) => `
            <tr>
              <td>${escapeHtml(r.full_name)}</td>
              <td>${fmtDate(r.date)}</td>
              <td>${escapeHtml(r.start_time)}-${escapeHtml(r.end_time)}</td>
              <td>${(r.total_minutes/60).toFixed(1)} jam</td>
              <td class="small">${escapeHtml(r.reason || '-')}</td>
              <td>${statusPill(r.status)}</td>
              ${canReview ? `<td>${r.status === 'pending' ? `<span class="row-actions">`
                + `<button class="btn btn-sm btn-primary" data-approve="${r.id}">Setujui</button>`
                + `<button class="btn btn-sm btn-danger-outline" data-reject="${r.id}">Tolak</button></span>` : '-'}</td>` : ''}
            </tr>`).join('') : `<tr><td colspan="7"><div class="empty-state">Belum ada pengajuan lembur</div></td></tr>`}</tbody>
        </table>
      </div>`;
    body.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', async () => {
      try { await api(`/overtime/${b.dataset.approve}/approve`, { method: 'POST' }); toast('Lembur disetujui', 'success'); this.load(canReview); } catch (e) { toast(e.message, 'error'); }
    }));
    body.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', async () => {
      try { await api(`/overtime/${b.dataset.reject}/reject`, { method: 'POST' }); toast('Lembur ditolak', 'success'); this.load(canReview); } catch (e) { toast(e.message, 'error'); }
    }));
  },

  openForm() {
    openModal({
      title: 'Ajukan Lembur',
      bodyHtml: `
        <div class="field"><label>Tanggal</label><input type="date" id="ot-date" /></div>
        <div class="form-grid">
          <div class="field"><label>Jam Mulai</label><input type="time" id="ot-start" /></div>
          <div class="field"><label>Jam Selesai</label><input type="time" id="ot-end" /></div>
        </div>
        <div class="field"><label>Alasan</label><textarea id="ot-reason" rows="3"></textarea></div>
      `,
      footHtml: `<button class="btn btn-outline" data-close-modal>Batal</button><button class="btn btn-primary" id="ot-submit">Ajukan</button>`,
      onMount: () => {
        document.getElementById('ot-submit').addEventListener('click', async () => {
          const date = document.getElementById('ot-date').value;
          const startTime = document.getElementById('ot-start').value;
          const endTime = document.getElementById('ot-end').value;
          if (!date || !startTime || !endTime) return toast('Lengkapi tanggal dan jam', 'error');
          try {
            await api('/overtime', { method: 'POST', body: { date, startTime, endTime, reason: document.getElementById('ot-reason').value } });
            toast('Pengajuan lembur dikirim', 'success');
            closeModal();
            route();
          } catch (e) { toast(e.message, 'error'); }
        });
      },
    });
  },
};
