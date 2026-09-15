// Reset password page logic. Dipisah dari reset-password.html.
const token = new URLSearchParams(window.location.search).get('token');
const form = document.getElementById('reset-form');
const errorBox = document.getElementById('error-box');

if (!token) {
  document.getElementById('lead-text').textContent = 'Link reset tidak valid.';
  errorBox.textContent = 'Token tidak ditemukan pada URL. Minta link reset baru dari halaman login.';
  errorBox.classList.remove('hidden');
  form.classList.add('hidden');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.classList.add('hidden');
  const pw = document.getElementById('new-password').value;
  const confirm = document.getElementById('confirm-password').value;
  if (pw !== confirm) {
    errorBox.textContent = 'Konfirmasi password tidak cocok.';
    errorBox.classList.remove('hidden');
    return;
  }
  const btn = document.getElementById('reset-btn');
  btn.disabled = true;
  btn.textContent = 'Menyimpan…';
  try {
    await api('/auth/reset-password', { method: 'POST', body: { token, newPassword: pw } });
    form.classList.add('hidden');
    document.getElementById('success-box').classList.remove('hidden');
    setTimeout(() => { window.location.href = '/index.html'; }, 2000);
  } catch (err) {
    errorBox.textContent = err.message || 'Gagal mereset password. Link mungkin sudah kedaluwarsa.';
    errorBox.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Simpan Password Baru';
  }
});
