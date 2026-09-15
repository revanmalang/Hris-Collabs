const AnnouncementsSection = {
  async render(container, { user }) {
    const canCreate = can('announcements.manage');
    container.innerHTML = `
      <div class="toolbar">${canCreate ? `<div style="margin-left:auto"><button class="btn btn-primary btn-sm" id="add-ann">Buat Pengumuman</button></div>` : ''}</div>
      <div id="ann-body"><div class="empty-state">Memuat…</div></div>
    `;
    canCreate && document.getElementById('add-ann').addEventListener('click', () => this.openForm());
    // Re-register cleanly: render() runs on every visit, guard against duplicates.
    window.removeEventListener('hris:announcement', this._listener);
    this._listener = () => this.load(canCreate);
    window.addEventListener('hris:announcement', this._listener);
    this.load(canCreate);
  },

  async load(canCreate) {
    const body = document.getElementById('ann-body');
    if (!body) return;
    let rows;
    try { rows = await api('/announcements'); } catch (e) { body.innerHTML = escapeHtml(e.message); return; }
    body.innerHTML = rows.length ? `<div class="grid grid-2">${rows.map((a) => `
      <div class="card">
        ${a.image_url && safeUrl(a.image_url) ? `<img src="${escapeHtml(safeUrl(a.image_url))}" style="width:100%;border-radius:8px;margin-bottom:10px;" />` : ''}
        <div class="flex-between"><strong>${escapeHtml(a.title)}</strong>${canCreate ? `<button class="btn btn-sm btn-danger" data-del="${a.id}">Hapus</button>` : ''}</div>
        <p class="small" style="color:var(--muted)">${escapeHtml(a.content)}</p>
        <div class="small muted">${fmtDateTime(a.publish_at)}${a.target_department_name ? ` · ${escapeHtml(a.target_department_name)}` : ''}</div>
      </div>`).join('')}</div>` : emptyState('Belum ada pengumuman', 'Pengumuman baru akan tampil di sini.');
    body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmDialog('Hapus pengumuman ini?');
      if (!ok) return;
      try { await api(`/announcements/${b.dataset.del}`, { method: 'DELETE' }); toast('Dihapus', 'success'); this.load(canCreate); } catch (e) { toast(e.message, 'error'); }
    }));
  },

  async openForm() {
    const departments = await api('/departments').catch(() => []);
    openModal({
      title: 'Buat Pengumuman',
      bodyHtml: `
        <div class="field"><label>Judul</label><input id="a-title" /></div>
        <div class="field"><label>Isi</label><textarea id="a-content" rows="4"></textarea></div>
        <div class="field"><label>Gambar (opsional)</label><input type="file" id="a-image" /></div>
        <div class="form-grid">
          <div class="field"><label>Target Departemen (opsional)</label><select id="a-dept"><option value="">Semua</option>${departments.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Target Role (opsional)</label><select id="a-role"><option value="">Semua</option><option value="employee">Karyawan</option><option value="manager">Manager</option><option value="hr">HR</option></select></div>
        </div>
        <div class="field"><label>Kedaluwarsa (opsional)</label><input type="date" id="a-expiry" /></div>
      `,
      footHtml: `<button class="btn btn-outline" data-close-modal>Batal</button><button class="btn btn-primary" id="a-save">Publikasikan</button>`,
      onMount: () => document.getElementById('a-save').addEventListener('click', async () => {
        const fd = new FormData();
        fd.append('title', document.getElementById('a-title').value);
        fd.append('content', document.getElementById('a-content').value);
        if (document.getElementById('a-dept').value) fd.append('targetDepartmentId', document.getElementById('a-dept').value);
        if (document.getElementById('a-role').value) fd.append('targetRole', document.getElementById('a-role').value);
        if (document.getElementById('a-expiry').value) fd.append('expiredAt', document.getElementById('a-expiry').value);
        const file = document.getElementById('a-image').files[0];
        if (file) fd.append('image', file);
        try {
          await api('/announcements', { method: 'POST', body: fd, isForm: true });
          toast('Pengumuman dipublikasikan', 'success');
          closeModal();
          route();
        } catch (e) { toast(e.message, 'error'); }
      }),
    });
  },
};
