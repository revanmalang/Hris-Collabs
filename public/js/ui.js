// Central close handling: one delegated listener installed once at boot.
// Per-render wiring is fragile (a render error or stale node silently kills
// the close button), delegation keeps working no matter how the modal HTML
// was produced. Buttons use data-close-modal / data-close-drawer.
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-close-drawer]')) { closeDrawer(); return; }
  if (e.target.closest('[data-close-modal]')) { closeModal(); return; }
  if (e.target.id === 'modal-overlay') closeModal();
  if (e.target.id === 'drawer-overlay') closeDrawer();
});

function openModal({ title, bodyHtml, footHtml = '', onMount, width = 560, onClose = null }) {
  closeModal();
  modalOnClose = typeof onClose === 'function' ? onClose : null;
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="overlay" id="modal-overlay">
      <div class="modal" style="max-width:${width}px">
        <div class="modal-head">
          <h3>${escapeHtml(title)}</h3>
          <button class="close-x" id="modal-close" data-close-modal aria-label="Tutup">${icon('close', 16)}</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
        ${footHtml ? `<div class="modal-foot">${footHtml}</div>` : ''}
      </div>
    </div>`;
  document.addEventListener('keydown', closeModalOnEscape, { once: true });
  if (onMount) {
    try {
      onMount(root);
    } catch (err) {
      console.error(err);
      toast('Gagal membuka form. Coba lagi.', 'error');
    }
  }
}
function closeModalOnEscape(e) {
  if (e.key === 'Escape') closeModal();
}
function closeModal() {
  const root = document.getElementById('modal-root');
  if (root) root.innerHTML = '';
  // Resolve pending confirmDialog even when dismissed via X, overlay, or Escape.
  if (modalOnClose) {
    const cb = modalOnClose;
    modalOnClose = null;
    cb();
  }
}
let modalOnClose = null;

function openDrawer({ title, bodyHtml, onMount, width = 440 }) {
  closeDrawer();
  const root = document.getElementById('drawer-root');
  root.innerHTML = `
    <div class="drawer-overlay" id="drawer-overlay"></div>
    <div class="drawer" style="width:min(${width}px,100%)">
      <div class="modal-head"><h3>${escapeHtml(title)}</h3><button class="close-x" id="drawer-close" data-close-drawer aria-label="Tutup">${icon('close', 16)}</button></div>
      <div class="modal-body">${bodyHtml}</div>
    </div>`;
  if (onMount) {
    try {
      onMount(root);
    } catch (err) {
      console.error(err);
      toast('Gagal membuka panel. Coba lagi.', 'error');
    }
  }
}
function closeDrawer() {
  const root = document.getElementById('drawer-root');
  if (root) root.innerHTML = '';
}

function confirmDialog(message, { title = 'Konfirmasi', confirmLabel = 'Ya, lanjutkan', danger = true } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    openModal({
      title,
      width: 400,
      onClose: () => done(false),
      bodyHtml: `<div class="confirm-box"><p>${escapeHtml(message)}</p></div>`,
      footHtml: `
        <button class="btn btn-outline" id="confirm-cancel">Batal</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirm-ok">${escapeHtml(confirmLabel)}</button>`,
      onMount: () => {
        document.getElementById('confirm-cancel').addEventListener('click', () => { closeModal(); done(false); });
        document.getElementById('confirm-ok').addEventListener('click', () => { closeModal(); done(true); });
      },
    });
  });
}

function skeletonRows(cols, rows = 5) {
  return Array.from({ length: rows }).map(() =>
    `<tr>${Array.from({ length: cols }).map(() => `<td><div class="skeleton"></div></td>`).join('')}</tr>`
  ).join('');
}

function emptyState(title, desc = '') {
  return `<div class="empty-state"><div class="empty-title">${escapeHtml(title)}</div>${desc ? `<div class="empty-desc">${escapeHtml(desc)}</div>` : ''}</div>`;
}

const STATUS_LABELS = {
  present: 'Hadir', completed: 'Selesai', working: 'Proses', approved: 'Disetujui', active: 'Aktif',
  late: 'Terlambat', pending: 'Pending',
  absent: 'Absen', rejected: 'Ditolak', terminated: 'Terminated', inactive: 'Nonaktif',
  leave: 'Izin', permission: 'Izin', sick: 'Sakit', cuti: 'Cuti',
};

function statusPill(status) {
  const key = status || 'absent';
  const label = STATUS_LABELS[key] || status;
  return `<span class="pill pill-${escapeHtml(key)}">${escapeHtml(label)}</span>`;
}

function paginationControls(page, pageSize, total, onChange) {
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const wrap = document.createElement('div');
  wrap.className = 'pagination';
  wrap.innerHTML = `
    <span>${total} data, halaman ${page} dari ${totalPages}</span>
    <button class="btn btn-outline btn-sm" ${page <= 1 ? 'disabled' : ''} id="pg-prev">${icon('chevLeft', 14)} Sebelumnya</button>
    <button class="btn btn-outline btn-sm" ${page >= totalPages ? 'disabled' : ''} id="pg-next">Berikutnya ${icon('chevRight', 14)}</button>
  `;
  wrap.querySelector('#pg-prev')?.addEventListener('click', () => onChange(page - 1));
  wrap.querySelector('#pg-next')?.addEventListener('click', () => onChange(page + 1));
  return wrap;
}
