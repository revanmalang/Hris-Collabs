// Thin fetch wrapper: sends the httpOnly cookie automatically, attaches the
// bearer token as a fallback, and transparently retries once after a silent
// token refresh on 401 (so a 15-minute access token doesn't log people out
// mid-shift while checking in).
async function apiRaw(path, { method = 'GET', body, isForm = false } = {}) {
  const headers = {};
  const token = localStorage.getItem('accessToken');
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!isForm && body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  return res;
}

async function api(path, opts = {}) {
  let res = await apiRaw(path, opts);
  if (res.status === 401 && path !== '/auth/login' && path !== '/auth/refresh') {
    const refreshRes = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
    if (refreshRes.ok) {
      const data = await refreshRes.json();
      localStorage.setItem('accessToken', data.accessToken);
      res = await apiRaw(path, opts);
    } else {
      // Refresh token dead: stop retrying and send the user back to login
      // instead of failing every subsequent request silently.
      localStorage.removeItem('accessToken');
      if (!window.location.pathname.endsWith('/index.html') && !window.location.pathname.endsWith('/reset-password.html')) {
        window.location.href = '/index.html';
      }
    }
  }
  let payload = null;
  try { payload = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error((payload && payload.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.details = payload && payload.details;
    throw err;
  }
  return payload;
}

function toast(message, type = 'info') {
  let stack = document.querySelector('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtTime(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}
function fmtDateTime(iso) {
  if (!iso) return '-';
  return `${fmtDate(iso)} ${fmtTime(iso)}`;
}
function initials(name) {
  if (!name) return '?';
  return name.split(' ').slice(0, 2).map((s) => s[0]).join('').toUpperCase();
}
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// URL allowlist for values rendered into src/href: relative paths plus
// http/https/data-image/blob. Anything else (e.g. javascript:) is dropped.
function safeUrl(url, allowDataImage = false) {
  const s = String(url ?? '').trim();
  if (s.startsWith('/')) return s;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('blob:')) return s;
  if (allowDataImage && s.startsWith('data:image/')) return s;
  return '';
}
function debounce(fn, ms = 350) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
