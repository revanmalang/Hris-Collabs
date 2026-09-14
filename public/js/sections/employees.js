const EmployeesSection = {
  state: { q: '', department: '', status: '', page: 1, pageSize: 12, departments: [], positions: [], locations: [], shifts: [] },

  async render(container, { user }) {
    this.user = user;
    const canEdit = can('employees.manage');
    [this.state.departments, this.state.positions, this.state.locations, this.state.shifts] = await Promise.all([
      api('/departments').catch(() => []),
      api('/positions').catch(() => []),
      api('/locations').catch(() => []),
      api('/shifts').catch(() => []),
    ]);

    container.innerHTML = `
      <div class="toolbar">
        <div class="grow"><input id="emp-q" placeholder="Cari nama atau ID karyawan…" value="${escapeHtml(this.state.q)}" /></div>
        <select id="emp-dept"><option value="">Semua Departemen</option>${this.state.departments.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('')}</select>
        <select id="emp-status">
          <option value="">Semua Status</option>
          <option value="active">Active</option><option value="inactive">Inactive</option>
          <option value="resigned">Resigned</option><option value="terminated">Terminated</option>
        </select>
        <div class="gap-8">
          <button class="btn btn-outline btn-sm" id="view-grid">▦ Grid</button>
          <button class="btn btn-outline btn-sm" id="view-list">☰ List</button>
          ${canEdit ? `<button class="btn btn-outline btn-sm" id="import-emp">⇩ Import Excel</button>` : ''}
          ${canEdit ? `<button class="btn btn-amber btn-sm" id="add-emp">+ Tambah Karyawan</button>` : ''}
        </div>
      </div>
      <div id="emp-body"><div class="empty-state">Memuat…</div></div>
      <div id="emp-pagination"></div>
    `;

    this.view = 'grid';
    document.getElementById('emp-q').addEventListener('input', debounce((e) => { this.state.q = e.target.value; this.state.page = 1; this.load(); }, 350));
    document.getElementById('emp-dept').addEventListener('change', (e) => { this.state.department = e.target.value; this.state.page = 1; this.load(); });
    document.getElementById('emp-status').addEventListener('change', (e) => { this.state.status = e.target.value; this.state.page = 1; this.load(); });
    document.getElementById('view-grid').addEventListener('click', () => { this.view = 'grid'; this.load(); });
    document.getElementById('view-list').addEventListener('click', () => { this.view = 'list'; this.load(); });
    if (canEdit) document.getElementById('add-emp').addEventListener('click', () => this.openForm());
    if (canEdit) document.getElementById('import-emp').addEventListener('click', () => this.openImport());

    this.load();
  },

  async load() {
    const body = document.getElementById('emp-body');
    if (!body) return;
    const { q, department, status, page, pageSize } = this.state;
    const params = new URLSearchParams({ page, pageSize });
    if (q) params.set('q', q);
    if (department) params.set('department', department);
    if (status) params.set('status', status);
    let res;
    try {
      res = await api(`/employees?${params}`);
    } catch (e) {
      body.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
      return;
    }
    if (res.data.length === 0) {
      body.innerHTML = `<div class="empty-state"><div class="ic">👥</div>Tidak ada karyawan yang cocok.</div>`;
      document.getElementById('emp-pagination').innerHTML = '';
      return;
    }
    body.innerHTML = this.view === 'grid' ? this.gridHtml(res.data) : this.listHtml(res.data);
    body.querySelectorAll('[data-open-profile]').forEach((el) => {
      el.addEventListener('click', () => this.openProfile(el.dataset.openProfile));
    });
    const pagi = document.getElementById('emp-pagination');
    pagi.innerHTML = '';
    pagi.appendChild(paginationControls(res.page, res.pageSize, res.total, (p) => { this.state.page = p; this.load(); }));
  },

  gridHtml(rows) {
    return `<div class="grid grid-4">${rows.map((e) => `
      <div class="card" style="cursor:pointer;text-align:center;" data-open-profile="${e.id}">
        <div class="emp-photo" style="width:56px;height:56px;margin:0 auto 10px;font-size:16px;">
          ${e.photo_url ? `<img src="${e.photo_url}" />` : initials(e.full_name)}
        </div>
        <div class="emp-name">${escapeHtml(e.full_name)}</div>
        <div class="emp-sub">${escapeHtml(e.position_title || '—')}</div>
        <div class="emp-sub">${escapeHtml(e.department_name || '—')}</div>
        <div style="margin-top:8px;">${statusPill(e.status)}</div>
      </div>`).join('')}</div>`;
  },

  listHtml(rows) {
    return `<div class="card table-wrap"><table class="data-table">
      <thead><tr><th>Karyawan</th><th>Jabatan</th><th>Departemen</th><th>Status</th><th>Kontak</th></tr></thead>
      <tbody>${rows.map((e) => `
        <tr style="cursor:pointer" data-open-profile="${e.id}">
          <td><div class="emp-cell"><div class="emp-photo">${e.photo_url ? `<img src="${e.photo_url}" />` : initials(e.full_name)}</div>
            <div><div class="emp-name">${escapeHtml(e.full_name)}</div><div class="emp-sub">${escapeHtml(e.employee_code)}</div></div></div></td>
          <td>${escapeHtml(e.position_title || '—')}</td>
          <td>${escapeHtml(e.department_name || '—')}</td>
          <td>${statusPill(e.status)}</td>
          <td>${escapeHtml(e.phone || e.email || '—')}</td>
        </tr>`).join('')}</tbody>
    </table></div>`;
  },

  async openProfile(id) {
    const canEdit = can('employees.manage');
    let data;
    try { data = await api(`/employees/${id}/profile`); } catch (e) { toast(e.message, 'error'); return; }
    const emp = data.employee;
    openDrawer({
      title: emp.full_name,
      width: 480,
      bodyHtml: `
        <div style="text-align:center;margin-bottom:16px;">
          <div class="emp-photo" style="width:72px;height:72px;margin:0 auto 10px;font-size:20px;">${emp.photo_url ? `<img src="${emp.photo_url}" />` : initials(emp.full_name)}</div>
          <div style="font-weight:700;font-size:16px;">${escapeHtml(emp.full_name)}</div>
          <div class="muted small">${escapeHtml(emp.employee_code)} · ${escapeHtml(emp.position_title || '—')}</div>
          <div style="margin-top:6px;">${statusPill(emp.status)}</div>
        </div>

        <div class="tabs" id="profile-tabs">
          <div class="tab active" data-tab="info">Identitas</div>
          <div class="tab" data-tab="attendance">Absensi</div>
          <div class="tab" data-tab="leave">Izin/Cuti</div>
          <div class="tab" data-tab="history">Riwayat Kepegawaian</div>
          <div class="tab" data-tab="docs">Dokumen</div>
        </div>
        <div id="profile-tab-body"></div>
      `,
      onMount: () => {
        const body = document.getElementById('profile-tab-body');
        const stats = data.stats || {};
        const renderInfo = () => {
          const account = data.account;
          body.innerHTML = `
            <div class="grid grid-2" style="margin-bottom:14px;">
              <div class="card stat-card"><div class="label">Kehadiran (30 hr)</div><div class="stat-value" style="font-size:18px;">${stats.presentDays || 0}/${stats.totalDays || 0}</div></div>
              <div class="card stat-card"><div class="label">Terlambat (30 hr)</div><div class="stat-value" style="font-size:18px;">${stats.lateDays || 0}</div></div>
            </div>
            ${infoRow('Departemen', emp.department_name)}
            ${infoRow('Manager', emp.manager_name)}
            ${infoRow('Lokasi Kerja', emp.location_name)}
            ${infoRow('Shift', emp.shift_name ? `${emp.shift_name} (${emp.start_time}-${emp.end_time})` : '—')}
            ${infoRow('Tanggal Mulai', fmtDate(emp.hire_date))}
            ${infoRow('Jenis Kontrak', emp.contract_type)}
            ${emp.phone !== undefined ? infoRow('Telepon', emp.phone) : ''}
            ${emp.email !== undefined ? infoRow('Email', emp.email) : ''}
            ${emp.address !== undefined ? infoRow('Alamat', emp.address) : ''}
            ${emp.npwp !== undefined ? infoRow('NPWP', emp.npwp) : ''}
            ${emp.bpjs_number !== undefined ? infoRow('BPJS', emp.bpjs_number) : ''}
            ${emp.bank_account !== undefined ? infoRow('No. Rekening', emp.bank_account) : ''}
            ${canEdit ? `
              <div class="section-heading">Akun Login</div>
              ${account
                ? `${infoRow('Email Login', account.email)}${infoRow('Role', account.role)}${infoRow('Status', account.is_active ? 'Aktif' : 'Nonaktif')}`
                : `<p class="small muted">Karyawan ini belum punya akun login.</p>`}
              <div class="gap-8 mt-16">
                <button class="btn btn-outline btn-sm" id="edit-emp">Edit Data</button>
                ${account ? `<button class="btn btn-outline btn-sm" id="reset-pw-emp">Reset Password</button>` : ''}
                ${account
                  ? (account.is_active
                      ? `<button class="btn btn-danger btn-sm" id="toggle-account-emp" data-action="deactivate">Nonaktifkan Akun</button>`
                      : `<button class="btn btn-outline btn-sm" id="toggle-account-emp" data-action="activate">Aktifkan Akun</button>`)
                  : `<button class="btn btn-amber btn-sm" id="create-account-emp">+ Buat Akun Login</button>`}
                <button class="btn btn-danger btn-sm" id="del-emp">Nonaktifkan Karyawan</button>
              </div>` : ''}
          `;
          if (canEdit) {
            document.getElementById('edit-emp')?.addEventListener('click', () => { closeDrawer(); this.openForm(emp); });
            document.getElementById('reset-pw-emp')?.addEventListener('click', async () => {
              const ok = await confirmDialog(`Reset password login untuk ${emp.full_name}? Password baru akan ditampilkan sekali.`, { danger: false, confirmLabel: 'Ya, reset' });
              if (!ok) return;
              try {
                const res = await api(`/employees/${emp.id}/reset-password`, { method: 'POST' });
                openModal({
                  title: 'Password Berhasil Direset',
                  width: 420,
                  bodyHtml: `<p class="small muted">Sampaikan kredensial ini ke karyawan secara aman. Password ini hanya ditampilkan satu kali.</p>
                    <div class="field"><label>Email</label><input value="${escapeHtml(res.email)}" disabled /></div>
                    <div class="field"><label>Password Sementara</label><input value="${escapeHtml(res.temporaryPassword)}" disabled style="font-family:monospace;" /></div>
                    <p class="small muted">Karyawan akan diminta mengganti password saat login berikutnya.</p>`,
                  footHtml: `<button class="btn btn-primary" onclick="closeModal()">Selesai</button>`,
                });
              } catch (e) { toast(e.message, 'error'); }
            });
            document.getElementById('toggle-account-emp')?.addEventListener('click', async (e) => {
              const action = e.target.dataset.action;
              const label = action === 'deactivate' ? 'menonaktifkan' : 'mengaktifkan';
              const ok = await confirmDialog(`Yakin ${label} akun login ${emp.full_name}?`, { danger: action === 'deactivate', confirmLabel: 'Ya, lanjutkan' });
              if (!ok) return;
              try {
                await api(`/employees/${emp.id}/account/${action}`, { method: 'POST' });
                toast(`Akun login berhasil di${action === 'deactivate' ? 'nonaktifkan' : 'aktifkan'}`, 'success');
                this.openProfile(emp.id);
              } catch (e) { toast(e.message, 'error'); }
            });
            document.getElementById('create-account-emp')?.addEventListener('click', () => this.openCreateAccountForm(emp, () => this.openProfile(emp.id)));
            document.getElementById('del-emp')?.addEventListener('click', async () => {
              const ok = await confirmDialog(`Nonaktifkan ${emp.full_name}? Akun login (jika ada) ikut dinonaktifkan otomatis. Data tetap tersimpan untuk audit.`);
              if (!ok) return;
              try { await api(`/employees/${emp.id}`, { method: 'DELETE' }); toast('Karyawan dinonaktifkan', 'success'); closeDrawer(); this.load(); }
              catch (e) { toast(e.message, 'error'); }
            });
          }
        };
        const renderAttendance = () => {
          body.innerHTML = data.attendanceRecent.length
            ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Tanggal</th><th>Masuk</th><th>Keluar</th><th>Status</th></tr></thead><tbody>${
                data.attendanceRecent.map((a) => `<tr><td>${fmtDate(a.date)}</td><td>${fmtTime(a.check_in_at)}</td><td>${fmtTime(a.check_out_at)}</td><td>${statusPill(a.status)}</td></tr>`).join('')
              }</tbody></table></div>`
            : emptyLine('Belum ada riwayat absensi');
        };
        const renderLeave = () => {
          body.innerHTML = data.leaveHistory.length
            ? data.leaveHistory.map((l) => rowLine(`${l.type} · ${fmtDate(l.start_date)}–${fmtDate(l.end_date)}`, '', statusPill(l.status))).join('')
            : emptyLine('Belum ada riwayat izin/cuti');
        };
        const renderDocs = () => {
          body.innerHTML = `
            ${data.documents.length ? data.documents.map((d) => `<div class="flex-between" style="padding:6px 0;"><a href="${d.file_url}" target="_blank">📄 ${escapeHtml(d.file_name)}</a><span class="muted small">${escapeHtml(d.type)}</span></div>`).join('') : emptyLine('Belum ada dokumen')}
            ${canEdit ? `<div class="mt-16"><input type="file" id="doc-file" /> <select id="doc-type"><option value="cv">CV</option><option value="contract">Kontrak</option><option value="certificate">Sertifikat</option><option value="other">Lainnya</option></select> <button class="btn btn-sm btn-outline" id="doc-upload">Unggah</button></div>` : ''}
          `;
          document.getElementById('doc-upload')?.addEventListener('click', async () => {
            const file = document.getElementById('doc-file').files[0];
            if (!file) return toast('Pilih file terlebih dahulu', 'error');
            const fd = new FormData();
            fd.append('file', file);
            fd.append('type', document.getElementById('doc-type').value);
            try {
              await api(`/employees/${emp.id}/documents`, { method: 'POST', body: fd, isForm: true });
              toast('Dokumen diunggah', 'success');
              this.openProfile(emp.id);
            } catch (e) { toast(e.message, 'error'); }
          });
        };
        const renderHistory = async () => {
          body.innerHTML = `<div class="empty-state">Memuat…</div>`;
          const typeLabel = { onboarding: '🟢 Onboarding', promotion: '⬆️ Promosi', transfer: '🔁 Mutasi', offboarding: '🔴 Offboarding', contract_change: '📄 Perubahan Kontrak', status_change: '🔄 Perubahan Status' };
          let rows;
          try { rows = await api(`/employees/${emp.id}/history`); } catch (e) { body.innerHTML = escapeHtml(e.message); return; }
          body.innerHTML = `
            ${canEdit ? `<button class="btn btn-amber btn-sm mt-16" id="add-history" style="margin-bottom:12px;">+ Catat Promosi/Mutasi/Offboarding</button>` : ''}
            ${rows.length ? rows.map((h) => `
              <div style="padding:8px 0;border-bottom:1px solid var(--border);">
                <div class="flex-between"><strong style="font-size:13px;">${typeLabel[h.type] || h.type}</strong><span class="muted small">${fmtDate(h.effective_date)}</span></div>
                ${h.from_department_name || h.to_department_name ? `<div class="small muted">${escapeHtml(h.from_department_name || '—')} → ${escapeHtml(h.to_department_name || '—')}</div>` : ''}
                ${h.from_position_title || h.to_position_title ? `<div class="small muted">${escapeHtml(h.from_position_title || '—')} → ${escapeHtml(h.to_position_title || '—')}</div>` : ''}
                ${h.note ? `<div class="small">${escapeHtml(h.note)}</div>` : ''}
              </div>`).join('') : emptyLine('Belum ada riwayat kepegawaian')}
          `;
          document.getElementById('add-history')?.addEventListener('click', () => this.openHistoryForm(emp, () => renderHistory()));
        };
        const tabs = { info: renderInfo, attendance: renderAttendance, leave: renderLeave, history: renderHistory, docs: renderDocs };
        document.querySelectorAll('#profile-tabs .tab').forEach((t) => t.addEventListener('click', () => {
          document.querySelectorAll('#profile-tabs .tab').forEach((x) => x.classList.remove('active'));
          t.classList.add('active');
          tabs[t.dataset.tab]();
        }));
        renderInfo();
      },
    });
  },

  openForm(existing = null) {
    const d = this.state.departments, p = this.state.positions, l = this.state.locations, sh = this.state.shifts;
    const v = (field, def = '') => existing ? (existing[field] ?? def) : def;
    openModal({
      title: existing ? 'Edit Karyawan' : 'Tambah Karyawan',
      width: 640,
      bodyHtml: `
        <div class="section-heading">Identitas</div>
        <div class="form-grid">
          <div class="field"><label>ID Karyawan *</label><input id="f-code" value="${escapeHtml(v('employee_code'))}" ${existing ? 'disabled' : ''} /></div>
          <div class="field"><label>Nama Lengkap *</label><input id="f-name" value="${escapeHtml(v('full_name'))}" /></div>
          <div class="field"><label>Jenis Kelamin</label><select id="f-gender"><option value="">-</option><option value="male" ${v('gender')==='male'?'selected':''}>Laki-laki</option><option value="female" ${v('gender')==='female'?'selected':''}>Perempuan</option></select></div>
          <div class="field"><label>No. Telepon</label><input id="f-phone" value="${escapeHtml(v('phone'))}" /></div>
          <div class="field span-2"><label>Email</label><input id="f-email" type="email" value="${escapeHtml(v('email'))}" /></div>
          <div class="field span-2"><label>Alamat</label><input id="f-address" value="${escapeHtml(v('address'))}" /></div>
        </div>
        <div class="section-heading">Data Pekerjaan</div>
        <div class="form-grid">
          <div class="field"><label>Departemen</label><select id="f-dept"><option value="">-</option>${d.map((x) => `<option value="${x.id}" ${v('department_id')===x.id?'selected':''}>${escapeHtml(x.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Jabatan</label><select id="f-pos"><option value="">-</option>${p.map((x) => `<option value="${x.id}" ${v('position_id')===x.id?'selected':''}>${escapeHtml(x.title)}</option>`).join('')}</select></div>
          <div class="field"><label>Lokasi Kerja</label><select id="f-loc"><option value="">-</option>${l.map((x) => `<option value="${x.id}" ${v('location_id')===x.id?'selected':''}>${escapeHtml(x.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Shift</label><select id="f-shift"><option value="">-</option>${sh.map((x) => `<option value="${x.id}" ${v('shift_id')===x.id?'selected':''}>${escapeHtml(x.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Status</label><select id="f-status">${['active','inactive','resigned','terminated'].map((s) => `<option value="${s}" ${v('status','active')===s?'selected':''}>${s}</option>`).join('')}</select></div>
          <div class="field"><label>Jenis Kontrak</label><select id="f-contract"><option value="">-</option>${['permanent','contract','intern','probation'].map((s) => `<option value="${s}" ${v('contract_type')===s?'selected':''}>${s}</option>`).join('')}</select></div>
          <div class="field"><label>Tanggal Mulai Kerja</label><input type="date" id="f-hire" value="${v('hire_date','').slice(0,10)}" /></div>
        </div>
      `,
      footHtml: `<button class="btn btn-outline" onclick="closeModal()">Batal</button><button class="btn btn-primary" id="save-emp">Simpan</button>`,
      onMount: () => {
        document.getElementById('save-emp').addEventListener('click', async () => {
          const payload = {
            employeeCode: document.getElementById('f-code').value.trim(),
            fullName: document.getElementById('f-name').value.trim(),
            gender: document.getElementById('f-gender').value || null,
            phone: document.getElementById('f-phone').value || null,
            email: document.getElementById('f-email').value || null,
            address: document.getElementById('f-address').value || null,
            departmentId: document.getElementById('f-dept').value || null,
            positionId: document.getElementById('f-pos').value || null,
            locationId: document.getElementById('f-loc').value || null,
            shiftId: document.getElementById('f-shift').value || null,
            status: document.getElementById('f-status').value,
            contractType: document.getElementById('f-contract').value || null,
            hireDate: document.getElementById('f-hire').value || null,
          };
          if (!payload.employeeCode || !payload.fullName) return toast('ID dan Nama wajib diisi', 'error');
          try {
            if (existing) await api(`/employees/${existing.id}`, { method: 'PUT', body: payload });
            else await api('/employees', { method: 'POST', body: payload });
            toast('Data karyawan disimpan', 'success');
            closeModal();
            this.load();
          } catch (e) { toast(e.message, 'error'); }
        });
      },
    });
  },

  openHistoryForm(emp, onSaved) {
    const d = this.state.departments, p = this.state.positions;
    openModal({
      title: `Catat Perubahan — ${emp.full_name}`,
      bodyHtml: `
        <div class="field"><label>Jenis</label>
          <select id="hist-type">
            <option value="promotion">Promosi</option>
            <option value="transfer">Mutasi</option>
            <option value="onboarding">Onboarding (aktifkan kembali)</option>
            <option value="offboarding">Offboarding (resign)</option>
            <option value="contract_change">Perubahan Kontrak</option>
            <option value="status_change">Perubahan Status</option>
          </select>
        </div>
        <div class="form-grid">
          <div class="field"><label>Departemen Baru (opsional)</label><select id="hist-dept"><option value="">Tidak berubah</option>${d.map((x) => `<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Jabatan Baru (opsional)</label><select id="hist-pos"><option value="">Tidak berubah</option>${p.map((x) => `<option value="${x.id}">${escapeHtml(x.title)}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label>Tanggal Efektif</label><input type="date" id="hist-date" value="${new Date().toISOString().slice(0,10)}" /></div>
        <div class="field"><label>Catatan</label><textarea id="hist-note" rows="3"></textarea></div>
      `,
      footHtml: `<button class="btn btn-outline" onclick="closeModal()">Batal</button><button class="btn btn-primary" id="hist-save">Simpan</button>`,
      onMount: () => {
        document.getElementById('hist-save').addEventListener('click', async () => {
          try {
            await api(`/employees/${emp.id}/history`, {
              method: 'POST',
              body: {
                type: document.getElementById('hist-type').value,
                toDepartmentId: document.getElementById('hist-dept').value || null,
                toPositionId: document.getElementById('hist-pos').value || null,
                effectiveDate: document.getElementById('hist-date').value,
                note: document.getElementById('hist-note').value,
              },
            });
            toast('Riwayat kepegawaian dicatat', 'success');
            closeModal();
            onSaved();
          } catch (e) { toast(e.message, 'error'); }
        });
      },
    });
  },

  openImport() {
    openModal({
      title: 'Import Karyawan dari Excel',
      width: 560,
      bodyHtml: `
        <p class="small muted">Kolom yang dibaca: <code>Employee Code</code>, <code>Full Name</code>, <code>Email</code>, <code>Phone</code>, <code>Department</code>, <code>Position</code>, <code>Hire Date</code> (YYYY-MM-DD). Nama Department/Position dicocokkan otomatis ke data yang sudah ada.</p>
        <button class="btn btn-outline btn-sm" id="dl-template">⇩ Unduh Template</button>
        <div class="field mt-16"><label>File Excel (.xlsx/.csv)</label><input type="file" id="import-file" accept=".xlsx,.xls,.csv" /></div>
        <div id="import-preview"></div>
      `,
      footHtml: `<button class="btn btn-outline" onclick="closeModal()">Batal</button><button class="btn btn-primary hidden" id="import-confirm">Import Sekarang</button>`,
      onMount: () => {
        document.getElementById('dl-template').addEventListener('click', () => {
          const ws = XLSX.utils.json_to_sheet([
            { 'Employee Code': 'EMP2001', 'Full Name': 'Contoh Nama', 'Email': 'contoh@email.com', 'Phone': '081234567890', 'Department': this.state.departments[0]?.name || 'IT', 'Position': this.state.positions[0]?.title || 'Staff', 'Hire Date': '2026-01-01' },
          ]);
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, 'Template');
          XLSX.writeFile(wb, 'template-import-karyawan.xlsx');
        });

        let parsedRows = [];
        document.getElementById('import-file').addEventListener('change', (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (evt) => {
            const wb = XLSX.read(evt.target.result, { type: 'array' });
            const sheet = wb.Sheets[wb.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(sheet);
            const deptByName = Object.fromEntries(this.state.departments.map((d) => [d.name.toLowerCase().trim(), d.id]));
            const posByName = Object.fromEntries(this.state.positions.map((p) => [p.title.toLowerCase().trim(), p.id]));
            parsedRows = json.map((row) => ({
              employeeCode: String(row['Employee Code'] || '').trim(),
              fullName: String(row['Full Name'] || '').trim(),
              email: row['Email'] ? String(row['Email']).trim() : null,
              phone: row['Phone'] ? String(row['Phone']).trim() : null,
              departmentId: deptByName[String(row['Department'] || '').toLowerCase().trim()] || null,
              positionId: posByName[String(row['Position'] || '').toLowerCase().trim()] || null,
              hireDate: row['Hire Date'] ? String(row['Hire Date']).trim() : null,
            })).filter((r) => r.employeeCode && r.fullName);

            const box = document.getElementById('import-preview');
            box.innerHTML = parsedRows.length
              ? `<p class="small mt-16"><strong>${parsedRows.length}</strong> baris siap diimport.</p>
                 <div class="table-wrap" style="max-height:200px;overflow-y:auto;"><table class="data-table">
                   <thead><tr><th>Kode</th><th>Nama</th><th>Departemen</th><th>Jabatan</th></tr></thead>
                   <tbody>${parsedRows.slice(0, 20).map((r) => `<tr><td>${escapeHtml(r.employeeCode)}</td><td>${escapeHtml(r.fullName)}</td><td>${r.departmentId ? '✓' : '<span class=\"muted\">tidak cocok</span>'}</td><td>${r.positionId ? '✓' : '<span class=\"muted\">tidak cocok</span>'}</td></tr>`).join('')}</tbody>
                 </table></div>`
              : `<p class="small mt-16" style="color:var(--red)">Tidak ada baris valid (Employee Code dan Full Name wajib ada).</p>`;
            document.getElementById('import-confirm').classList.toggle('hidden', parsedRows.length === 0);
          };
          reader.readAsArrayBuffer(file);
        });

        document.getElementById('import-confirm').addEventListener('click', async () => {
          try {
            const res = await api('/employees/bulk-import', { method: 'POST', body: { rows: parsedRows } });
            toast(`${res.created} karyawan berhasil diimport${res.failed.length ? `, ${res.failed.length} gagal` : ''}`, res.failed.length ? 'error' : 'success');
            closeModal();
            this.load();
          } catch (e) { toast(e.message, 'error'); }
        });
      },
    });
  },

  openCreateAccountForm(emp, onCreated) {
    const isSuperAdmin = this.user.role === 'super_admin';
    openModal({
      title: `Buat Akun Login — ${emp.full_name}`,
      bodyHtml: `
        <div class="field"><label>Email Login</label><input type="email" id="acc-email" value="${emp.email ? escapeHtml(emp.email) : ''}" placeholder="nama@perusahaan.com" /></div>
        <div class="field"><label>Role</label>
          <select id="acc-role">
            <option value="employee">Karyawan</option>
            <option value="manager">Manager</option>
            ${isSuperAdmin ? `<option value="hr">HR / SDM</option><option value="super_admin">Super Admin</option>` : ''}
          </select>
        </div>
        ${!isSuperAdmin ? `<p class="small muted">Hanya Super Admin yang dapat membuat akun dengan role HR atau Super Admin.</p>` : ''}
      `,
      footHtml: `<button class="btn btn-outline" onclick="closeModal()">Batal</button><button class="btn btn-primary" id="acc-save">Buat Akun</button>`,
      onMount: () => {
        document.getElementById('acc-save').addEventListener('click', async () => {
          const email = document.getElementById('acc-email').value.trim();
          const role = document.getElementById('acc-role').value;
          if (!email) return toast('Email wajib diisi', 'error');
          try {
            const res = await api(`/employees/${emp.id}/account`, { method: 'POST', body: { email, role } });
            closeModal();
            openModal({
              title: 'Akun Berhasil Dibuat',
              width: 420,
              bodyHtml: `<p class="small muted">Sampaikan kredensial ini ke karyawan secara aman. Password ini hanya ditampilkan satu kali.</p>
                <div class="field"><label>Email</label><input value="${escapeHtml(res.email)}" disabled /></div>
                <div class="field"><label>Password Sementara</label><input value="${escapeHtml(res.temporaryPassword)}" disabled style="font-family:'IBM Plex Mono',monospace;" /></div>
                <p class="small muted">Karyawan akan diminta mengganti password saat login pertama kali.</p>`,
              footHtml: `<button class="btn btn-primary" id="acc-done">Selesai</button>`,
              onMount: () => document.getElementById('acc-done').addEventListener('click', () => { closeModal(); onCreated(); }),
            });
          } catch (e) { toast(e.message, 'error'); }
        });
      },
    });
  },
};

function infoRow(label, value) {
  return `<div class="flex-between" style="padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">
    <span class="muted">${escapeHtml(label)}</span><span>${escapeHtml(value || '—')}</span></div>`;
}
