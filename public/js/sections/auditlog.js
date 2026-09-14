const AuditLogSection = {
  state: { page: 1, pageSize: 25, action: '' },

  async render(container) {
    container.innerHTML = `
      <div class="toolbar">
        <select id="al-action">
          <option value="">Semua Aksi</option>
          ${['login','login_failed','logout','password_change','check_in','check_out','employee_create','employee_update','employee_delete','leave_approve','leave_reject','attendance_correction','report_export','settings_update'].map((a) => `<option value="${a}">${a}</option>`).join('')}
        </select>
      </div>
      <div class="card table-wrap"><table class="data-table">
        <thead><tr><th>Waktu</th><th>Pengguna</th><th>Aksi</th><th>Objek</th><th>IP</th><th>Device</th></tr></thead>
        <tbody id="al-body">${skeletonRows(6, 8)}</tbody>
      </table></div>
      <div id="al-pagination"></div>
    `;
    document.getElementById('al-action').addEventListener('change', (e) => { this.state.action = e.target.value; this.state.page = 1; this.load(); });
    this.load();
  },

  async load() {
    const tbody = document.getElementById('al-body');
    const { page, pageSize, action } = this.state;
    const params = new URLSearchParams({ page, pageSize });
    if (action) params.set('action', action);
    let res;
    try { res = await api(`/audit-logs?${params}`); } catch (e) { tbody.innerHTML = `<tr><td colspan="6">${escapeHtml(e.message)}</td></tr>`; return; }
    tbody.innerHTML = res.data.length ? res.data.map((r) => `
      <tr>
        <td>${fmtDateTime(r.created_at)}</td>
        <td>${escapeHtml(r.user_email || 'system')}</td>
        <td><span class="pill pill-working">${escapeHtml(r.action)}</span></td>
        <td class="small">${escapeHtml(r.object_type || '')} ${escapeHtml(r.object_id ? '#' + r.object_id.slice(0, 8) : '')}</td>
        <td class="small">${escapeHtml(r.ip_address || '—')}</td>
        <td class="small" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(r.device || '—')}</td>
      </tr>`).join('') : `<tr><td colspan="6"><div class="empty-state">Tidak ada log</div></td></tr>`;
    const pagi = document.getElementById('al-pagination');
    pagi.innerHTML = '';
    pagi.appendChild(paginationControls(res.page, res.pageSize, res.total, (p) => { this.state.page = p; this.load(); }));
  },
};
