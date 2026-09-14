function openModal({ title, bodyHtml, footHtml = '', onMount, width = 560 }) {
  closeModal();
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="overlay" id="modal-overlay">
      <div class="modal" style="max-width:${width}px">
        <div class="modal-head">
          <h3>${escapeHtml(title)}</h3>
          <button class="close-x" id="modal-close" aria-label="Tutup">✕</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
        ${footHtml ? `<div class="modal-foot">${footHtml}</div>` : ''}
      </div>
    </div>`;
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeModal();
  });
  if (onMount) onMount(root);
}
function closeModal() {
  const root = document.getElementById('modal-root');
  if (root) root.innerHTML = '';
}

function openDrawer({ title, bodyHtml, onMount, width = 440 }) {
  closeDrawer();
  const root = document.getElementById('drawer-root');
  root.innerHTML = `
    <div class="drawer-overlay" id="drawer-overlay"></div>
    <div class="drawer" style="width:min(${width}px,100%)">
      <div class="modal-head"><h3>${escapeHtml(title)}</h3><button class="close-x" id="drawer-close">✕</button></div>
      <div class="modal-body">${bodyHtml}</div>
    </div>`;
  document.getElementById('drawer-close').addEventListener('click', closeDrawer);
  document.getElementById('drawer-overlay').addEventListener('click', closeDrawer);
  if (onMount) onMount(root);
}
function closeDrawer() {
  const root = document.getElementById('drawer-root');
  if (root) root.innerHTML = '';
}

function confirmDialog(message, { title = 'Konfirmasi', confirmLabel = 'Ya, lanjutkan', danger = true } = {}) {
  return new Promise((resolve) => {
    openModal({
      title,
      width: 400,
      bodyHtml: `<div class="confirm-box"><p>${escapeHtml(message)}</p></div>`,
      footHtml: `
        <button class="btn btn-outline" id="confirm-cancel">Batal</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirm-ok">${escapeHtml(confirmLabel)}</button>`,
      onMount: () => {
        document.getElementById('confirm-cancel').addEventListener('click', () => { closeModal(); resolve(false); });
        document.getElementById('confirm-ok').addEventListener('click', () => { closeModal(); resolve(true); });
      },
    });
  });
}

function skeletonRows(cols, rows = 5) {
  return Array.from({ length: rows }).map(() =>
    `<tr>${Array.from({ length: cols }).map(() => `<td><div class="skeleton"></div></td>`).join('')}</tr>`
  ).join('');
}

function statusPill(status) {
  return `<span class="pill pill-${escapeHtml(status || 'absent')}">${escapeHtml(status || 'absent')}</span>`;
}

function paginationControls(page, pageSize, total, onChange) {
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const wrap = document.createElement('div');
  wrap.className = 'pagination';
  wrap.innerHTML = `
    <span>${total} data · Hal ${page}/${totalPages}</span>
    <button class="btn btn-outline btn-sm" ${page <= 1 ? 'disabled' : ''} id="pg-prev">‹ Prev</button>
    <button class="btn btn-outline btn-sm" ${page >= totalPages ? 'disabled' : ''} id="pg-next">Next ›</button>
  `;
  wrap.querySelector('#pg-prev')?.addEventListener('click', () => onChange(page - 1));
  wrap.querySelector('#pg-next')?.addEventListener('click', () => onChange(page + 1));
  return wrap;
}
