// `permission: null` means "visible to any authenticated role" (still
// enforced properly server-side per-endpoint regardless). Everything else
// checks the live permission matrix via `canAccess()` below, so a
// permission a Super Admin just granted through Settings > Hak Akses is
// immediately reachable in the sidebar - not just allowed by the API.
const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', permission: null },
  { id: 'employees', label: 'Direktori Karyawan', icon: 'users', permission: null },
  { id: 'attendance-live', label: 'Live Attendance', icon: 'pulse', permission: 'attendance.live_monitor' },
  { id: 'attendance-history', label: 'Riwayat Absensi', icon: 'history', permission: null },
  { id: 'leave', label: 'Izin dan Cuti', icon: 'leave', permission: null },
  { id: 'overtime', label: 'Lembur', icon: 'overtime', permission: null },
  { id: 'organization', label: 'Organisasi', icon: 'org', permission: 'organization.manage' },
  { id: 'announcements', label: 'Pengumuman', icon: 'announce', permission: null },
  { id: 'reports', label: 'Laporan', icon: 'report', permission: 'reports.view' },
  { id: 'audit-log', label: 'Audit Log', icon: 'shield', permission: 'audit.view' },
  { id: 'settings', label: 'Pengaturan', icon: 'settings', permission: 'settings.manage', altPermission: 'audit.view' },
];

const SECTION_MAP = {
  'dashboard': () => DashboardSection,
  'employees': () => EmployeesSection,
  'attendance-live': () => AttendanceSection.live,
  'attendance-history': () => AttendanceSection.history,
  'leave': () => LeaveSection,
  'overtime': () => OvertimeSection,
  'organization': () => OrgSection,
  'announcements': () => AnnouncementsSection,
  'reports': () => ReportsSection,
  'audit-log': () => AuditLogSection,
  'settings': () => SettingsSection,
};

let CURRENT_USER = null;

// Navigation generation counter. Section renders capture it before each
// await and abort when it changes (user navigated away), so a slow
// response never overwrites the newly opened page.
let routeSeq = 0;
function currentRouteSeq() { return routeSeq; }

// Central permission check used by both nav visibility and in-page buttons
// (see sections/*.js). Reads CURRENT_USER.permissions, populated fresh from
// GET /auth/me on every login/page load - never assume it's stale within a
// session; a super_admin toggling the matrix takes effect next reload.
function can(code) {
  return !!CURRENT_USER?.permissions?.includes(code);
}

function visibleNavItems() {
  return NAV_ITEMS.filter((n) => {
    if (n.permission === null) return true;
    if (can(n.permission)) return true;
    if (n.altPermission && can(n.altPermission)) return true;
    return false;
  });
}


async function bootstrap() {
  try {
    CURRENT_USER = await api('/auth/me');
  } catch {
    window.location.href = '/index.html';
    return;
  }

  renderNav();
  renderUserChip();
  initRealtime();
  refreshUnreadCount();
  wireTopbar();

  window.addEventListener('hashchange', route);
  route();
}

function renderNav() {
  const group = document.getElementById('nav-group');
  const items = visibleNavItems();
  group.innerHTML = `
    <div class="nav-label">Menu</div>
    ${items.map((n) => `<a href="#${n.id}" class="nav-item" data-id="${n.id}"><span class="ic">${icon(n.icon, 17)}</span>${n.label}</a>`).join('')}
  `;
}

function renderUserChip() {
  const name = CURRENT_USER.employee?.full_name || CURRENT_USER.email;
  document.getElementById('user-avatar').textContent = initials(name);
  document.getElementById('user-name').textContent = name;
  const roleLabels = { super_admin: 'Super Admin', hr: 'HR / SDM', manager: 'Manager', employee: 'Karyawan' };
  document.getElementById('user-role').textContent = roleLabels[CURRENT_USER.role] || CURRENT_USER.role;

  document.getElementById('user-chip').addEventListener('click', () => {
    openModal({
      title: 'Akun saya',
      bodyHtml: `
        <div class="field"><label>Email</label><input value="${escapeHtml(CURRENT_USER.email)}" disabled /></div>
        <div class="field"><label>Peran</label><input value="${escapeHtml(document.getElementById('user-role').textContent)}" disabled /></div>
        <hr style="border:none;border-top:1px solid var(--border);margin:16px 0" />
        <div class="section-heading">Ubah kata sandi</div>
        <div class="field"><label>Kata sandi saat ini</label><input type="password" id="cur-pw" /></div>
        <div class="field"><label>Kata sandi baru</label><input type="password" id="new-pw" placeholder="Min. 8 karakter, huruf + angka" /></div>
        <hr style="border:none;border-top:1px solid var(--border);margin:16px 0" />
        <div class="section-heading">Autentikasi Dua Faktor (2FA)</div>
        <div id="twofa-area">${CURRENT_USER.totpEnabled
          ? `<p class="small" style="color:var(--success);font-weight:600;">2FA aktif untuk akun ini.</p>
             <div class="field"><label>Kata sandi (untuk menonaktifkan)</label><input type="password" id="disable-2fa-pw" /></div>
             <button class="btn btn-outline btn-sm" id="disable-2fa">Nonaktifkan 2FA</button>`
          : `<p class="small muted">Tambahkan lapisan keamanan menggunakan Google Authenticator / Authy.</p>
             <button class="btn btn-outline btn-sm" id="start-2fa">Aktifkan 2FA</button>
             <div id="twofa-setup-body"></div>`
        }</div>
      `,
      footHtml: `
        <button class="btn btn-outline" data-close-modal>Tutup</button>
        <button class="btn btn-primary" id="save-pw">Simpan Kata Sandi</button>
        <button class="btn btn-danger" id="do-logout">Keluar</button>`,
      onMount: () => {
        document.getElementById('do-logout').addEventListener('click', async () => {
          await api('/auth/logout', { method: 'POST' }).catch(() => {});
          localStorage.removeItem('accessToken');
          window.location.href = '/index.html';
        });
        document.getElementById('save-pw').addEventListener('click', async () => {
          try {
            await api('/auth/change-password', {
              method: 'POST',
              body: { currentPassword: document.getElementById('cur-pw').value, newPassword: document.getElementById('new-pw').value },
            });
            toast('Kata sandi diperbarui', 'success');
            closeModal();
          } catch (e) { toast(e.message, 'error'); }
        });

        document.getElementById('start-2fa')?.addEventListener('click', async () => {
          try {
            const res = await api('/auth/2fa/setup', { method: 'POST' });
            const qr = safeUrl(res.qrDataUrl, true);
            if (!qr) { toast('QR 2FA tidak valid dari server', 'error'); return; }
            document.getElementById('twofa-setup-body').innerHTML = `
              <div style="text-align:center;margin-top:12px;">
                <img src="${escapeHtml(qr)}" alt="QR 2FA" style="width:160px;height:160px;border:1px solid var(--border);border-radius:8px;" />
                <p class="small muted mt-16">Atau masukkan manual: <code>${escapeHtml(res.secret)}</code></p>
              </div>
              <div class="field"><label>Kode dari Authenticator</label><input id="confirm-2fa-code" inputmode="numeric" maxlength="6" placeholder="123456" /></div>
              <button class="btn btn-primary btn-sm btn-block" id="confirm-2fa">Konfirmasi dan Aktifkan</button>
            `;
            document.getElementById('confirm-2fa').addEventListener('click', async () => {
              try {
                await api('/auth/2fa/enable', { method: 'POST', body: { token: document.getElementById('confirm-2fa-code').value.trim() } });
                toast('2FA berhasil diaktifkan', 'success');
                CURRENT_USER.totpEnabled = true;
                closeModal();
              } catch (e) { toast(e.message, 'error'); }
            });
          } catch (e) { toast(e.message, 'error'); }
        });

        document.getElementById('disable-2fa')?.addEventListener('click', async () => {
          try {
            await api('/auth/2fa/disable', { method: 'POST', body: { password: document.getElementById('disable-2fa-pw').value } });
            toast('2FA dinonaktifkan', 'success');
            CURRENT_USER.totpEnabled = false;
            closeModal();
          } catch (e) { toast(e.message, 'error'); }
        });
      },
    });
  });
}

function isSidebarOpen() {
  return document.getElementById('sidebar').classList.contains('open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-scrim')?.classList.remove('visible');
}

function wireTopbar() {
  document.getElementById('menu-toggle').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('open');
    document.getElementById('sidebar-scrim')?.classList.toggle('visible', sidebar.classList.contains('open'));
  });
  document.getElementById('sidebar-scrim')?.addEventListener('click', closeSidebar);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isSidebarOpen()) closeSidebar();
  });

  document.getElementById('notif-btn').addEventListener('click', async () => {
    const notifs = await api('/notifications').catch(() => []);
    openDrawer({
      title: 'Notifikasi',
      bodyHtml: notifs.length
        ? notifs.map((n) => `
          <div style="padding:10px 0;border-bottom:1px solid var(--border);${n.is_read ? 'opacity:.55' : ''}">
            <strong style="font-size:13px;">${escapeHtml(n.title)}</strong>
            <div class="small muted">${escapeHtml(n.message || '')}</div>
            <div class="small muted">${fmtDateTime(n.created_at)}</div>
          </div>`).join('')
        : emptyState('Belum ada notifikasi', 'Notifikasi baru akan muncul di sini.'),
      onMount: async () => {
        await api('/notifications/read-all', { method: 'POST' }).catch(() => {});
        refreshUnreadCount();
      },
    });
  });

  const searchInput = document.getElementById('global-search');
  const resultsBox = document.getElementById('search-results');
  searchInput.addEventListener('input', debounce(async (e) => {
    const q = e.target.value.trim();
    if (!q) { resultsBox.classList.add('hidden'); return; }
    const res = await api(`/search?q=${encodeURIComponent(q)}`).catch(() => null);
    if (!res) return;
    if (searchInput.value.trim() !== q) return; // typed ahead, drop stale result
    const rows = [
      ...res.employees.map((x) => `<div class="nav-item" style="color:var(--ink)" data-goto="employees">${icon('users', 15)} ${escapeHtml(x.full_name)} <span class="muted small">(${escapeHtml(x.employee_code)})</span></div>`),
      ...res.departments.map((x) => `<div class="nav-item" style="color:var(--ink)" data-goto="organization">${icon('org', 15)} ${escapeHtml(x.name)}</div>`),
      ...res.announcements.map((x) => `<div class="nav-item" style="color:var(--ink)" data-goto="announcements">${icon('announce', 15)} ${escapeHtml(x.title)}</div>`),
    ];
    resultsBox.innerHTML = rows.length ? rows.join('') : `<div class="small muted" style="padding:8px;">Tidak ditemukan</div>`;
    resultsBox.classList.remove('hidden');
  }, 300));
  resultsBox.addEventListener('click', (e) => {
    const t = e.target.closest('[data-goto]');
    if (!t) return;
    window.location.hash = t.dataset.goto;
    searchInput.value = '';
    resultsBox.classList.add('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!resultsBox.contains(e.target) && e.target !== searchInput) resultsBox.classList.add('hidden');
  });
}

function route() {
  routeSeq++;
  if (window.__clockTimer) { clearInterval(window.__clockTimer); window.__clockTimer = null; }
  let id = (window.location.hash || '#dashboard').slice(1);
  const allowed = visibleNavItems().map((n) => n.id);
  if (!allowed.includes(id)) id = allowed[0];

  document.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.id === id));
  closeSidebar();

  const navItem = NAV_ITEMS.find((n) => n.id === id);
  document.getElementById('page-title').textContent = navItem ? navItem.label : 'Dashboard';

  const content = document.getElementById('content');
  content.innerHTML = `<div class="empty-state">Memuat…</div>`;
  const section = SECTION_MAP[id] && SECTION_MAP[id]();
  if (section && section.render) {
    section.render(content, { user: CURRENT_USER });
  } else {
    content.innerHTML = `<div class="empty-state">Halaman tidak ditemukan.</div>`;
  }
}

bootstrap();
