// Login page logic: form login, 2FA TOTP step, dan forgot password.
// Dipisah dari index.html agar markup halaman tetap bersih.
const form = document.getElementById('login-form');
const errorBox = document.getElementById('error-box');
const btn = document.getElementById('login-btn');

document.querySelectorAll('.demo-accounts button').forEach((b) => {
  b.addEventListener('click', () => {
    document.getElementById('email').value = b.dataset.email;
    document.getElementById('password').value = b.dataset.pass;
  });
});

// If already logged in, skip straight to the app shell.
api('/auth/me').then(() => { window.location.href = '/app.html'; }).catch(() => {});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Memproses…';
  try {
    const res = await api('/auth/login', {
      method: 'POST',
      body: { email: document.getElementById('email').value, password: document.getElementById('password').value },
    });
    if (res.requiresTotp) {
      pendingTempToken = res.tempToken;
      form.classList.add('hidden');
      document.getElementById('totp-form').classList.remove('hidden');
      document.getElementById('totp-code').focus();
      btn.disabled = false;
      btn.textContent = 'Masuk';
      return;
    }
    localStorage.setItem('accessToken', res.accessToken);
    window.location.href = '/app.html';
  } catch (err) {
    errorBox.textContent = err.message || 'Login gagal. Periksa kembali email dan kata sandi.';
    errorBox.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Masuk';
  }
});

let pendingTempToken = null;
const totpForm = document.getElementById('totp-form');
const totpBtn = document.getElementById('totp-btn');
totpForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.classList.add('hidden');
  totpBtn.disabled = true;
  totpBtn.textContent = 'Memverifikasi…';
  try {
    const res = await api('/auth/2fa/verify-login', {
      method: 'POST',
      body: { tempToken: pendingTempToken, token: document.getElementById('totp-code').value.trim() },
    });
    localStorage.setItem('accessToken', res.accessToken);
    window.location.href = '/app.html';
  } catch (err) {
    errorBox.textContent = err.message || 'Kode verifikasi salah.';
    errorBox.classList.remove('hidden');
    totpBtn.disabled = false;
    totpBtn.textContent = 'Verifikasi';
  }
});
document.getElementById('totp-back').addEventListener('click', () => {
  totpForm.classList.add('hidden');
  form.classList.remove('hidden');
  errorBox.classList.add('hidden');
});

document.getElementById('forgot-link').addEventListener('click', () => {
  document.getElementById('forgot-box').classList.toggle('hidden');
});
document.getElementById('forgot-submit').addEventListener('click', async () => {
  const email = document.getElementById('forgot-email').value.trim();
  const resultBox = document.getElementById('forgot-result');
  if (!email) return;
  const submitBtn = document.getElementById('forgot-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Mengirim…';
  try {
    const res = await api('/auth/forgot-password', { method: 'POST', body: { email } });
    resultBox.innerHTML = `<span style="color:var(--success);">${escapeHtml(res.message)}</span>`;
    if (res.devResetLink) {
      const link = safeUrl(res.devResetLink);
      if (link) {
        resultBox.innerHTML += `<div class="mt-16" style="background:var(--neutral-soft);padding:10px;border-radius:6px;">
          <strong>Mode dev</strong> - SMTP belum dikonfigurasi, link ditampilkan langsung:<br/>
          <a href="${escapeHtml(link)}">${escapeHtml(link)}</a></div>`;
      }
    }
  } catch (err) {
    resultBox.innerHTML = `<span style="color:var(--danger);">${escapeHtml(err.message)}</span>`;
  }
  submitBtn.disabled = false;
  submitBtn.textContent = 'Kirim Link Reset';
});
