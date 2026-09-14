const OrgSection = {
  async render(container) {
    container.innerHTML = `
      <div class="tabs" id="org-tabs">
        <div class="tab active" data-tab="departments">Departemen</div>
        <div class="tab" data-tab="positions">Jabatan</div>
        <div class="tab" data-tab="locations">Lokasi & Geofence</div>
        <div class="tab" data-tab="shifts">Shift</div>
        <div class="tab" data-tab="schedule">Jadwal Mingguan</div>
        <div class="tab" data-tab="rotation">Rotasi Shift</div>
        <div class="tab" data-tab="orgchart">Org Chart</div>
      </div>
      <div id="org-body"></div>
    `;
    document.querySelectorAll('#org-tabs .tab').forEach((t) => t.addEventListener('click', () => {
      document.querySelectorAll('#org-tabs .tab').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      this.renderTab(t.dataset.tab);
    }));
    this.renderTab('departments');
  },

  async renderTab(tab) {
    const body = document.getElementById('org-body');
    body.innerHTML = `<div class="empty-state">Memuat…</div>`;
    if (tab === 'departments') return this.departments(body);
    if (tab === 'positions') return this.positions(body);
    if (tab === 'locations') return this.locations(body);
    if (tab === 'shifts') return this.shifts(body);
    if (tab === 'schedule') return this.schedule(body);
    if (tab === 'rotation') return this.rotation(body);
    if (tab === 'orgchart') return this.orgChart(body);
  },

  async departments(body) {
    const rows = await api('/departments').catch(() => []);
    body.innerHTML = `
      <div class="toolbar"><div style="margin-left:auto"><button class="btn btn-amber btn-sm" id="add-dept">+ Tambah Departemen</button></div></div>
      <div class="card table-wrap"><table class="data-table">
        <thead><tr><th>Nama</th><th>Manager</th><th>Jumlah Karyawan</th></tr></thead>
        <tbody>${rows.map((d) => `<tr><td>${escapeHtml(d.name)}</td><td>${escapeHtml(d.manager_name || '—')}</td><td>${d.employee_count}</td></tr>`).join('') || `<tr><td colspan="3"><div class="empty-state">Belum ada departemen</div></td></tr>`}</tbody>
      </table></div>`;
    document.getElementById('add-dept').addEventListener('click', () => {
      openModal({
        title: 'Tambah Departemen',
        bodyHtml: `<div class="field"><label>Nama</label><input id="d-name" /></div><div class="field"><label>Deskripsi</label><input id="d-desc" /></div>`,
        footHtml: `<button class="btn btn-outline" onclick="closeModal()">Batal</button><button class="btn btn-primary" id="d-save">Simpan</button>`,
        onMount: () => document.getElementById('d-save').addEventListener('click', async () => {
          try {
            await api('/departments', { method: 'POST', body: { name: document.getElementById('d-name').value, description: document.getElementById('d-desc').value } });
            toast('Departemen ditambahkan', 'success'); closeModal(); this.departments(body);
          } catch (e) { toast(e.message, 'error'); }
        }),
      });
    });
  },

  async positions(body) {
    const [rows, departments] = await Promise.all([api('/positions').catch(() => []), api('/departments').catch(() => [])]);
    body.innerHTML = `
      <div class="toolbar"><div style="margin-left:auto"><button class="btn btn-amber btn-sm" id="add-pos">+ Tambah Jabatan</button></div></div>
      <div class="card table-wrap"><table class="data-table">
        <thead><tr><th>Jabatan</th><th>Departemen</th></tr></thead>
        <tbody>${rows.map((p) => `<tr><td>${escapeHtml(p.title)}</td><td>${escapeHtml(p.department_name || '—')}</td></tr>`).join('') || `<tr><td colspan="2"><div class="empty-state">Belum ada jabatan</div></td></tr>`}</tbody>
      </table></div>`;
    document.getElementById('add-pos').addEventListener('click', () => {
      openModal({
        title: 'Tambah Jabatan',
        bodyHtml: `<div class="field"><label>Nama Jabatan</label><input id="p-title" /></div>
          <div class="field"><label>Departemen</label><select id="p-dept"><option value="">-</option>${departments.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('')}</select></div>`,
        footHtml: `<button class="btn btn-outline" onclick="closeModal()">Batal</button><button class="btn btn-primary" id="p-save">Simpan</button>`,
        onMount: () => document.getElementById('p-save').addEventListener('click', async () => {
          try {
            await api('/positions', { method: 'POST', body: { title: document.getElementById('p-title').value, departmentId: document.getElementById('p-dept').value || null } });
            toast('Jabatan ditambahkan', 'success'); closeModal(); this.positions(body);
          } catch (e) { toast(e.message, 'error'); }
        }),
      });
    });
  },

  async locations(body) {
    const rows = await api('/locations').catch(() => []);
    body.innerHTML = `
      <div class="toolbar"><div style="margin-left:auto"><button class="btn btn-amber btn-sm" id="add-loc">+ Tambah Lokasi</button></div></div>
      <div class="card table-wrap"><table class="data-table">
        <thead><tr><th>Nama</th><th>Alamat</th><th>Koordinat</th><th>Radius Geofence</th></tr></thead>
        <tbody>${rows.map((l) => `<tr><td>${escapeHtml(l.name)}</td><td>${escapeHtml(l.address || '—')}</td><td class="small">${l.latitude}, ${l.longitude}</td><td>${l.radius_meters} m</td></tr>`).join('') || `<tr><td colspan="4"><div class="empty-state">Belum ada lokasi</div></td></tr>`}</tbody>
      </table></div>`;
    document.getElementById('add-loc').addEventListener('click', () => {
      openModal({
        title: 'Tambah Lokasi Kerja',
        bodyHtml: `
          <div class="field"><label>Nama Lokasi</label><input id="l-name" /></div>
          <div class="field"><label>Alamat</label><input id="l-address" /></div>
          <div class="form-grid">
            <div class="field"><label>Latitude</label><input id="l-lat" type="number" step="0.000001" /></div>
            <div class="field"><label>Longitude</label><input id="l-lng" type="number" step="0.000001" /></div>
          </div>
          <div class="field"><label>Radius Geofence (meter)</label><input id="l-radius" type="number" value="100" /></div>
          <p class="small muted">Tip: buka Google Maps, klik kanan lokasi kantor untuk menyalin koordinat.</p>
        `,
        footHtml: `<button class="btn btn-outline" onclick="closeModal()">Batal</button><button class="btn btn-primary" id="l-save">Simpan</button>`,
        onMount: () => document.getElementById('l-save').addEventListener('click', async () => {
          try {
            await api('/locations', { method: 'POST', body: {
              name: document.getElementById('l-name').value,
              address: document.getElementById('l-address').value,
              latitude: Number(document.getElementById('l-lat').value),
              longitude: Number(document.getElementById('l-lng').value),
              radiusMeters: Number(document.getElementById('l-radius').value) || 100,
            }});
            toast('Lokasi ditambahkan', 'success'); closeModal(); this.locations(body);
          } catch (e) { toast(e.message, 'error'); }
        }),
      });
    });
  },

  async shifts(body) {
    const [rows, employees] = await Promise.all([api('/shifts').catch(() => []), api('/employees?pageSize=100').catch(() => ({ data: [] }))]);
    body.innerHTML = `
      <div class="toolbar"><div style="margin-left:auto"><button class="btn btn-amber btn-sm" id="add-shift">+ Tambah Shift</button></div></div>
      <div class="card table-wrap"><table class="data-table">
        <thead><tr><th>Nama Shift</th><th>Jam Kerja</th><th>Grace Period</th><th>Aksi</th></tr></thead>
        <tbody>${rows.map((s) => `<tr><td>${escapeHtml(s.name)}</td><td>${s.start_time}–${s.end_time}</td><td>${s.grace_period_minutes} menit</td>
          <td><button class="btn btn-sm btn-outline" data-assign="${s.id}">Assign Karyawan</button></td></tr>`).join('') || `<tr><td colspan="4"><div class="empty-state">Belum ada shift</div></td></tr>`}</tbody>
      </table></div>`;
    document.getElementById('add-shift').addEventListener('click', () => {
      openModal({
        title: 'Tambah Shift',
        bodyHtml: `<div class="field"><label>Nama Shift</label><input id="s-name" /></div>
          <div class="form-grid"><div class="field"><label>Jam Mulai</label><input type="time" id="s-start" /></div><div class="field"><label>Jam Selesai</label><input type="time" id="s-end" /></div></div>
          <div class="field"><label>Grace Period (menit)</label><input id="s-grace" type="number" value="15" /></div>`,
        footHtml: `<button class="btn btn-outline" onclick="closeModal()">Batal</button><button class="btn btn-primary" id="s-save">Simpan</button>`,
        onMount: () => document.getElementById('s-save').addEventListener('click', async () => {
          try {
            await api('/shifts', { method: 'POST', body: { name: document.getElementById('s-name').value, startTime: document.getElementById('s-start').value, endTime: document.getElementById('s-end').value, gracePeriodMinutes: Number(document.getElementById('s-grace').value) } });
            toast('Shift ditambahkan', 'success'); closeModal(); this.shifts(body);
          } catch (e) { toast(e.message, 'error'); }
        }),
      });
    });
    body.querySelectorAll('[data-assign]').forEach((b) => b.addEventListener('click', () => {
      const shiftId = b.dataset.assign;
      openModal({
        title: 'Bulk Assign Shift',
        bodyHtml: `<p class="small muted">Pilih karyawan yang akan menggunakan shift ini.</p>
          <div style="max-height:280px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:8px;">
            ${employees.data.map((e) => `<label style="display:flex;align-items:center;gap:8px;padding:4px 0;"><input type="checkbox" value="${e.id}" class="assign-chk" /> ${escapeHtml(e.full_name)} <span class="muted small">(${escapeHtml(e.employee_code)})</span></label>`).join('')}
          </div>`,
        footHtml: `<button class="btn btn-outline" onclick="closeModal()">Batal</button><button class="btn btn-primary" id="assign-save">Assign</button>`,
        onMount: () => document.getElementById('assign-save').addEventListener('click', async () => {
          const ids = Array.from(document.querySelectorAll('.assign-chk:checked')).map((c) => c.value);
          if (!ids.length) return toast('Pilih minimal satu karyawan', 'error');
          try {
            const res = await api(`/shifts/${shiftId}/assign`, { method: 'POST', body: { employeeIds: ids } });
            toast(`${res.updated} karyawan diperbarui`, 'success'); closeModal();
          } catch (e) { toast(e.message, 'error'); }
        }),
      });
    }));
  },

  async schedule(body) {
    const [shifts, employees] = await Promise.all([
      api('/shifts').catch(() => []),
      api('/employees?pageSize=100').catch(() => ({ data: [] })),
    ]);
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const weekDates = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d.toISOString().slice(0, 10);
    });

    body.innerHTML = `
      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">Assign Shift ke Rentang Tanggal</div>
          <div class="form-grid">
            <div class="field"><label>Dari Tanggal</label><input type="date" id="sc-from" value="${weekDates[0]}" /></div>
            <div class="field"><label>Sampai Tanggal</label><input type="date" id="sc-to" value="${weekDates[6]}" /></div>
          </div>
          <div class="field"><label>Shift</label><select id="sc-shift">${shifts.map((s) => `<option value="${s.id}">${escapeHtml(s.name)} (${s.start_time}-${s.end_time})</option>`).join('')}</select></div>
          <div class="field"><label>Karyawan</label>
            <div style="max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:8px;">
              ${employees.data.map((e) => `<label style="display:flex;align-items:center;gap:8px;padding:4px 0;"><input type="checkbox" value="${e.id}" class="sc-emp-chk" /> ${escapeHtml(e.full_name)} <span class="muted small">(${escapeHtml(e.employee_code)})</span></label>`).join('')}
            </div>
          </div>
          <div class="small muted" style="margin-bottom:10px;">Akhir pekan (Sab/Min) dilewati otomatis.</div>
          <button class="btn btn-amber btn-sm" id="sc-apply">Terapkan Jadwal</button>
        </div>
        <div class="card">
          <div class="card-title">Pratinjau Minggu Ini <span class="sub" id="sc-range-label"></span></div>
          <div id="sc-preview"><div class="empty-state">Pilih rentang lalu terapkan untuk melihat pratinjau.</div></div>
        </div>
      </div>
    `;

    const loadPreview = async () => {
      const from = document.getElementById('sc-from').value || weekDates[0];
      const to = document.getElementById('sc-to').value || weekDates[6];
      document.getElementById('sc-range-label').textContent = `${fmtDate(from)} – ${fmtDate(to)}`;
      const rows = await api(`/schedules?from=${from}&to=${to}`).catch(() => []);
      const box = document.getElementById('sc-preview');
      box.innerHTML = rows.length
        ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Tanggal</th><th>Karyawan</th><th>Shift</th></tr></thead><tbody>${
            rows.map((r) => `<tr><td>${fmtDate(r.date)}</td><td>${escapeHtml(r.full_name)}</td><td>${escapeHtml(r.shift_name)}</td></tr>`).join('')
          }</tbody></table></div>`
        : `<div class="empty-state">Belum ada jadwal pada rentang ini</div>`;
    };
    loadPreview();
    document.getElementById('sc-from').addEventListener('change', loadPreview);
    document.getElementById('sc-to').addEventListener('change', loadPreview);

    document.getElementById('sc-apply').addEventListener('click', async () => {
      const employeeIds = Array.from(document.querySelectorAll('.sc-emp-chk:checked')).map((c) => c.value);
      if (!employeeIds.length) return toast('Pilih minimal satu karyawan', 'error');
      const from = new Date(document.getElementById('sc-from').value);
      const to = new Date(document.getElementById('sc-to').value);
      if (!(from <= to)) return toast('Rentang tanggal tidak valid', 'error');
      const dates = [];
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        if (d.getDay() !== 0 && d.getDay() !== 6) dates.push(d.toISOString().slice(0, 10));
      }
      try {
        const res = await api('/schedules/bulk', { method: 'POST', body: { employeeIds, shiftId: document.getElementById('sc-shift').value, dates } });
        toast(`${res.assignmentsWritten} jadwal disimpan`, 'success');
        loadPreview();
      } catch (e) { toast(e.message, 'error'); }
    });
  },

  async rotation(body) {
    const [shifts, employees, rotations, assignments] = await Promise.all([
      api('/shifts').catch(() => []),
      api('/employees?pageSize=100').catch(() => ({ data: [] })),
      api('/shift-rotations').catch(() => []),
      api('/shift-rotations/assignments').catch(() => []),
    ]);

    body.innerHTML = `
      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">Pola Rotasi <span class="sub">Contoh: kerja-kerja-libur berulang</span></div>
          <div id="rot-list">${rotations.length ? rotations.map((r) => `
            <div class="flex-between" style="padding:8px 0;border-bottom:1px solid var(--border);">
              <div><strong style="font-size:13px;">${escapeHtml(r.name)}</strong><div class="small muted">${r.pattern.length} hari siklus: ${r.pattern.map((s) => s ? (shifts.find(sh => sh.id === s)?.name || '?') : 'Libur').join(' → ')}</div></div>
              <button class="btn btn-sm btn-danger" data-del-rot="${r.id}">Hapus</button>
            </div>`).join('') : emptyLine('Belum ada pola rotasi')}</div>
          <button class="btn btn-amber btn-sm mt-16" id="add-rotation">+ Buat Pola Rotasi</button>
        </div>
        <div class="card">
          <div class="card-title">Assign Karyawan ke Rotasi</div>
          <div class="field"><label>Pola Rotasi</label><select id="rot-select">${rotations.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Tanggal Mulai (hari ke-0 pola)</label><input type="date" id="rot-start" value="${new Date().toISOString().slice(0,10)}" /></div>
          <div class="field"><label>Karyawan</label>
            <div style="max-height:180px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:8px;">
              ${employees.data.map((e) => `<label style="display:flex;align-items:center;gap:8px;padding:4px 0;"><input type="checkbox" value="${e.id}" class="rot-emp-chk" /> ${escapeHtml(e.full_name)}</label>`).join('')}
            </div>
          </div>
          <button class="btn btn-outline btn-sm" id="rot-assign" ${rotations.length ? '' : 'disabled'}>Assign</button>

          <div class="section-heading">Generate Jadwal dari Rotasi</div>
          <p class="small muted">Setelah karyawan di-assign ke rotasi, generate jadwal konkret untuk rentang tanggal berikut. Aman dijalankan berulang.</p>
          <div class="form-grid">
            <div class="field"><label>Dari</label><input type="date" id="rot-gen-from" value="${new Date().toISOString().slice(0,10)}" /></div>
            <div class="field"><label>Sampai</label><input type="date" id="rot-gen-to" /></div>
          </div>
          <button class="btn btn-primary btn-sm" id="rot-generate">Generate Jadwal</button>
          <div id="rot-gen-result" class="small mt-16"></div>
        </div>
      </div>
      <div class="card mt-16">
        <div class="card-title">Karyawan Ter-assign</div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Karyawan</th><th>Rotasi</th><th>Mulai</th></tr></thead>
          <tbody>${assignments.length ? assignments.map((a) => `<tr><td>${escapeHtml(a.full_name)}</td><td>${escapeHtml(a.rotation_name)}</td><td>${fmtDate(a.start_date)}</td></tr>`).join('') : `<tr><td colspan="3"><div class="empty-state">Belum ada assignment</div></td></tr>`}</tbody>
        </table></div>
      </div>
    `;

    const to = new Date(); to.setDate(to.getDate() + 30);
    document.getElementById('rot-gen-to').value = to.toISOString().slice(0, 10);

    document.getElementById('add-rotation').addEventListener('click', () => {
      openModal({
        title: 'Buat Pola Rotasi',
        bodyHtml: `
          <div class="field"><label>Nama Pola</label><input id="rp-name" placeholder="Contoh: 2 Kerja 1 Libur" /></div>
          <div class="field"><label>Urutan Siklus (pisahkan koma, gunakan nama shift atau "Libur")</label>
            <select id="rp-day-shift" style="margin-bottom:8px;">${shifts.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}<option value="">Libur</option></select>
            <button type="button" class="btn btn-outline btn-sm" id="rp-add-day">+ Tambah ke Pola</button>
          </div>
          <div id="rp-pattern-preview" class="small" style="padding:10px;background:var(--gray-100);border-radius:6px;min-height:20px;">Pola: (kosong)</div>
        `,
        footHtml: `<button class="btn btn-outline" onclick="closeModal()">Batal</button><button class="btn btn-primary" id="rp-save">Simpan Pola</button>`,
        onMount: () => {
          const pattern = [];
          const renderPreview = () => {
            document.getElementById('rp-pattern-preview').textContent = pattern.length
              ? `Pola (${pattern.length} hari): ${pattern.map((s) => s ? (shifts.find(sh => sh.id === s)?.name || '?') : 'Libur').join(' → ')}`
              : 'Pola: (kosong)';
          };
          document.getElementById('rp-add-day').addEventListener('click', () => {
            const val = document.getElementById('rp-day-shift').value;
            pattern.push(val || null);
            renderPreview();
          });
          document.getElementById('rp-save').addEventListener('click', async () => {
            if (!pattern.length) return toast('Tambahkan minimal 1 hari ke pola', 'error');
            try {
              await api('/shift-rotations', { method: 'POST', body: { name: document.getElementById('rp-name').value, pattern } });
              toast('Pola rotasi dibuat', 'success');
              closeModal();
              this.rotation(body);
            } catch (e) { toast(e.message, 'error'); }
          });
        },
      });
    });

    body.querySelectorAll('[data-del-rot]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmDialog('Hapus pola rotasi ini? Assignment terkait juga akan dihapus.');
      if (!ok) return;
      try { await api(`/shift-rotations/${b.dataset.delRot}`, { method: 'DELETE' }); toast('Dihapus', 'success'); this.rotation(body); }
      catch (e) { toast(e.message, 'error'); }
    }));

    document.getElementById('rot-assign')?.addEventListener('click', async () => {
      const employeeIds = Array.from(document.querySelectorAll('.rot-emp-chk:checked')).map((c) => c.value);
      if (!employeeIds.length) return toast('Pilih minimal satu karyawan', 'error');
      try {
        const res = await api(`/shift-rotations/${document.getElementById('rot-select').value}/assign`, {
          method: 'POST',
          body: { employeeIds, startDate: document.getElementById('rot-start').value },
        });
        toast(`${res.assigned} karyawan di-assign ke rotasi`, 'success');
        this.rotation(body);
      } catch (e) { toast(e.message, 'error'); }
    });

    document.getElementById('rot-generate').addEventListener('click', async () => {
      try {
        const res = await api('/shift-rotations/generate', {
          method: 'POST',
          body: { from: document.getElementById('rot-gen-from').value, to: document.getElementById('rot-gen-to').value },
        });
        document.getElementById('rot-gen-result').innerHTML = `<span style="color:var(--green);">✓ ${res.scheduleEntriesWritten} jadwal dibuat, ${res.daysOff} hari libur, untuk ${res.employeesAffected} karyawan.</span>`;
      } catch (e) { toast(e.message, 'error'); }
    });
  },

  async orgChart(body) {
    const rows = await api('/org-chart').catch(() => []);
    const byManager = {};
    rows.forEach((e) => { const key = e.manager_id || 'root'; (byManager[key] = byManager[key] || []).push(e); });
    const renderNode = (e) => `
      <div style="margin-bottom:4px;">
        <div class="card" style="display:inline-flex;align-items:center;gap:8px;padding:8px 12px;">
          <div class="emp-photo" style="width:28px;height:28px;font-size:10px;">${initials(e.full_name)}</div>
          <div><div style="font-weight:600;font-size:12.5px;">${escapeHtml(e.full_name)}</div><div class="muted" style="font-size:10.5px;">${escapeHtml(e.position_title || '')}</div></div>
        </div>
        ${byManager[e.id] ? `<div style="margin-left:28px;border-left:2px solid var(--border);padding-left:16px;margin-top:8px;">${byManager[e.id].map(renderNode).join('')}</div>` : ''}
      </div>`;
    const roots = byManager['root'] || [];
    body.innerHTML = `<div class="card">${roots.length ? roots.map(renderNode).join('') : emptyLine('Belum ada data struktur organisasi')}</div>`;
  },
};
