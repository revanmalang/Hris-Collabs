const SettingsSection = {
  async render(container, { user }) {
    const canEdit = can('settings.manage');
    container.innerHTML = `
      <div class="tabs" id="settings-tabs">
        <div class="tab active" data-tab="general">Konfigurasi Umum</div>
        ${user.role === 'super_admin' ? `<div class="tab" data-tab="permissions">Hak Akses</div>` : ''}
        ${user.role === 'super_admin' ? `<div class="tab" data-tab="backup">Backup & Restore</div>` : ''}
      </div>
      <div id="settings-body"></div>
    `;
    document.querySelectorAll('#settings-tabs .tab').forEach((t) => t.addEventListener('click', () => {
      document.querySelectorAll('#settings-tabs .tab').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      if (t.dataset.tab === 'general') this.renderGeneral(canEdit);
      else if (t.dataset.tab === 'permissions') this.renderPermissions();
      else this.renderBackup();
    }));
    this.renderGeneral(canEdit);
  },

  async renderGeneral(canEdit) {
    const body = document.getElementById('settings-body');
    const settings = await api('/settings').catch(() => ({}));
    body.innerHTML = `
      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">Konfigurasi Umum</div>
          <div class="field"><label>Nama Perusahaan</label><input id="s-company" value="${escapeHtml(settings.company_name)}" ${canEdit ? '' : 'disabled'} /></div>
          <div class="field"><label>Zona Waktu</label><input id="s-tz" value="${escapeHtml(settings.timezone)}" ${canEdit ? '' : 'disabled'} /></div>
          <div class="field"><label>Mode GPS Absensi</label>
            <select id="s-gps" ${canEdit ? '' : 'disabled'}>
              <option value="required" ${settings.gps_mode === 'required' ? 'selected' : ''}>Wajib</option>
              <option value="optional" ${settings.gps_mode === 'optional' ? 'selected' : ''}>Opsional</option>
              <option value="disabled" ${settings.gps_mode === 'disabled' ? 'selected' : ''}>Tanpa GPS</option>
            </select>
          </div>
          <div class="field"><label>Grace Period Keterlambatan (menit)</label><input type="number" id="s-grace" value="${settings.grace_period_minutes}" ${canEdit ? '' : 'disabled'} /></div>
          <div class="field"><label>Radius Geofence Default (meter)</label><input type="number" id="s-radius" value="${settings.default_radius_meters}" ${canEdit ? '' : 'disabled'} /></div>
          ${canEdit ? `<button class="btn btn-primary btn-sm" id="s-save">Simpan Pengaturan</button>` : `<p class="small muted">Hanya pengguna dengan izin settings.manage yang dapat mengubah ini.</p>`}
        </div>
        <div class="card">
          <div class="card-title">System Health</div>
          <div id="s-health"><div class="empty-state">Memuat…</div></div>
        </div>
      </div>
    `;
    if (canEdit) {
      document.getElementById('s-save').addEventListener('click', async () => {
        try {
          await api('/settings', { method: 'PUT', body: {
            companyName: document.getElementById('s-company').value,
            timezone: document.getElementById('s-tz').value,
            gpsMode: document.getElementById('s-gps').value,
            gracePeriodMinutes: Number(document.getElementById('s-grace').value),
            defaultRadiusMeters: Number(document.getElementById('s-radius').value),
          }});
          toast('Pengaturan disimpan', 'success');
        } catch (e) { toast(e.message, 'error'); }
      });
    }
    try {
      const health = await api('/settings/system-health');
      document.getElementById('s-health').innerHTML = `
        ${infoRow('Status', health.status)}
        ${infoRow('Uptime', `${health.uptimeSeconds}s`)}
        ${infoRow('Node.js', health.nodeVersion)}
        <div class="section-heading">Jumlah Data</div>
        ${Object.entries(health.tableCounts).map(([k, v]) => infoRow(k, v)).join('')}
      `;
    } catch (e) {
      document.getElementById('s-health').innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
    }
  },

  async renderPermissions() {
    const body = document.getElementById('settings-body');
    body.innerHTML = `<div class="empty-state">Memuat…</div>`;
    let matrix;
    try { matrix = await api('/permissions'); } catch (e) { body.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; return; }

    const categories = [...new Set(matrix.permissions.map((p) => p.category))];
    const roleLabel = { hr: 'HR / SDM', manager: 'Manager' };

    body.innerHTML = `
      <div class="card">
        <div class="card-title">Hak Akses (RBAC Dinamis) <span class="sub">Super Admin selalu memiliki semua akses; Karyawan tidak pernah memiliki akses admin ini.</span></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Permission</th>${matrix.roles.map((r) => `<th style="text-align:center;">${roleLabel[r]}</th>`).join('')}</tr></thead>
            <tbody>
              ${categories.map((cat) => `
                <tr><td colspan="${matrix.roles.length + 1}" style="background:var(--gray-100);font-weight:700;font-size:11.5px;">${escapeHtml(cat)}</td></tr>
                ${matrix.permissions.filter((p) => p.category === cat).map((p) => {
                  const idx = matrix.permissions.indexOf(p);
                  return `<tr>
                    <td>${escapeHtml(p.label)}</td>
                    ${matrix.roles.map((role) => `<td style="text-align:center;">
                      <input type="checkbox" class="perm-chk" data-role="${role}" data-code="${p.code}" ${matrix.grants[role][idx] ? 'checked' : ''} />
                    </td>`).join('')}
                  </tr>`;
                }).join('')}
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    body.querySelectorAll('.perm-chk').forEach((chk) => {
      chk.addEventListener('change', async () => {
        chk.disabled = true;
        try {
          await api('/permissions', { method: 'PUT', body: { role: chk.dataset.role, code: chk.dataset.code, enabled: chk.checked } });
          toast('Hak akses diperbarui', 'success');
        } catch (e) {
          toast(e.message, 'error');
          chk.checked = !chk.checked;
        }
        chk.disabled = false;
      });
    });
  },

  async renderBackup() {
    const body = document.getElementById('settings-body');
    body.innerHTML = `
      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">Backup Database</div>
          <p class="small muted">Unduh salinan lengkap database (file .sql) untuk disimpan sebagai cadangan. File ini berisi semua data termasuk akun login — simpan di tempat yang aman.</p>
          <button class="btn btn-outline btn-sm" id="dl-backup">⇩ Unduh Backup (.sql)</button>
          <div class="section-heading">Export Data (JSON)</div>
          <p class="small muted">Ekspor seluruh data bisnis (karyawan, absensi, izin/cuti, dll.) dalam format JSON yang mudah dibaca — untuk migrasi atau ditinjau di luar aplikasi. Tidak menyertakan password/kredensial login.</p>
          <button class="btn btn-outline btn-sm" id="dl-export">⇩ Export Data (JSON)</button>
        </div>
        <div class="card">
          <div class="card-title" style="color:var(--red);">⚠️ Restore dari Backup</div>
          <p class="small" style="color:var(--red);">
            <strong>Peringatan:</strong> Restore akan MENGGANTI SELURUH data saat ini dengan isi file backup yang diunggah. Tindakan ini tidak bisa dibatalkan. Proses ini dijalankan langsung ke database — tidak perlu restart server.
          </p>
          <div class="field"><label>File Backup (.sql)</label><input type="file" id="restore-file" accept=".sql" /></div>
          <button class="btn btn-danger btn-sm" id="do-restore">Restore Sekarang</button>
          <div id="restore-result" class="small mt-16"></div>
        </div>
      </div>

      <div class="card mt-16" style="border-color:var(--red);">
        <div class="card-title" style="color:var(--red);">☠️ Danger Zone — Hapus Semua Data</div>
        <p class="small" style="color:var(--red);">
          Menghapus SEMUA karyawan, absensi, izin/cuti, lembur, departemen, jabatan, lokasi, shift, jadwal, rotasi,
          pengumuman, dokumen, dan akun login lain (termasuk akun demo) — sekali klik, tidak bisa dibatalkan.
          Akun Anda yang sedang login <strong>tetap aman</strong> dan tidak ikut terhapus. Audit log dan pengaturan
          sistem juga tetap dipertahankan. Gunakan ini untuk membersihkan data contoh sebelum mulai pakai data asli —
          <strong>ambil backup dulu di atas kalau ragu.</strong>
        </p>
        <div class="field" style="max-width:360px;">
          <label>Ketik <code>HAPUS SEMUA DATA</code> untuk konfirmasi</label>
          <input id="reset-confirm-input" placeholder="HAPUS SEMUA DATA" />
        </div>
        <button class="btn btn-danger btn-sm" id="do-reset" disabled>Hapus Semua Data Sekarang</button>
        <div id="reset-result" class="small mt-16"></div>
      </div>
    `;

    document.getElementById('dl-backup').addEventListener('click', () => {
      window.open('/api/settings/backup/download', '_blank');
    });
    document.getElementById('dl-export').addEventListener('click', () => {
      window.open('/api/settings/backup/export-json', '_blank');
    });

    document.getElementById('do-restore').addEventListener('click', async () => {
      const file = document.getElementById('restore-file').files[0];
      if (!file) return toast('Pilih file backup terlebih dahulu', 'error');
      const ok = await confirmDialog(
        `Anda akan mengganti SELURUH data saat ini dengan isi "${file.name}". Semua perubahan setelah backup ini dibuat akan HILANG. Lanjutkan?`,
        { confirmLabel: 'Ya, restore sekarang', danger: true }
      );
      if (!ok) return;

      const fd = new FormData();
      fd.append('backup', file);
      const resultBox = document.getElementById('restore-result');
      try {
        const res = await api('/settings/backup/restore', { method: 'POST', body: fd, isForm: true });
        resultBox.innerHTML = `<span style="color:var(--green);">${escapeHtml(res.message)}</span><br/><span class="muted">Muat ulang halaman ini untuk melihat data terbaru.</span>`;
        toast('Restore diterapkan, server sedang restart…', 'success');
      } catch (e) {
        resultBox.innerHTML = `<span style="color:var(--red);">${escapeHtml(e.message)}</span>`;
      }
    });

    const resetInput = document.getElementById('reset-confirm-input');
    const resetBtn = document.getElementById('do-reset');
    resetInput.addEventListener('input', () => {
      resetBtn.disabled = resetInput.value.trim() !== 'HAPUS SEMUA DATA';
    });
    resetBtn.addEventListener('click', async () => {
      const ok = await confirmDialog(
        'Ini adalah tindakan terakhir untuk memastikan. Semua data akan hilang permanen. Lanjutkan?',
        { confirmLabel: 'Ya, hapus semua data', danger: true }
      );
      if (!ok) return;
      const resultBox = document.getElementById('reset-result');
      resetBtn.disabled = true;
      resetBtn.textContent = 'Menghapus…';
      try {
        const res = await api('/settings/reset-data', { method: 'POST', body: { confirm: resetInput.value.trim() } });
        resultBox.innerHTML = `<span style="color:var(--green);">${escapeHtml(res.message)}</span>`;
        toast('Semua data berhasil dihapus', 'success');
        resetInput.value = '';
      } catch (e) {
        resultBox.innerHTML = `<span style="color:var(--red);">${escapeHtml(e.message)}</span>`;
      }
      resetBtn.textContent = 'Hapus Semua Data Sekarang';
    });
  },
};
