// Translates the handful of MySQL connection errors a first-time setup is
// most likely to hit into plain-language guidance, instead of a raw
// mysql2 stack trace. Used by migrate.js, seed.js, and server.js.
function explainDbError(err) {
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '3306';
  const user = process.env.DB_USER || 'root';
  const name = process.env.DB_NAME || 'employeehub';

  if (err.code === 'ER_ACCESS_DENIED_ERROR') {
    return [
      `Tidak bisa login ke MySQL sebagai user "${user}" — username atau password di file .env salah, atau user itu belum dibuat di MySQL/MariaDB kamu.`,
      '',
      'Cara paling cepat kalau pakai XAMPP (biasanya root tanpa password):',
      '  DB_USER=root',
      '  DB_PASSWORD=',
      '',
      `Atau buat user "${user}" secara eksplisit lewat phpMyAdmin / mysql CLI:`,
      `  CREATE USER '${user}'@'localhost' IDENTIFIED BY 'password_kamu';`,
      `  GRANT ALL PRIVILEGES ON ${name}.* TO '${user}'@'localhost';`,
      '  FLUSH PRIVILEGES;',
      '(lalu pastikan DB_PASSWORD di .env sama persis dengan password di atas)',
    ].join('\n');
  }
  if (err.code === 'ER_BAD_DB_ERROR') {
    return [
      `Database "${name}" belum ada.`,
      '',
      'Buat dulu lewat phpMyAdmin atau mysql CLI:',
      `  CREATE DATABASE ${name} CHARACTER SET utf8mb4;`,
    ].join('\n');
  }
  if (err.code === 'ECONNREFUSED') {
    return [
      `Tidak bisa konek ke MySQL di ${host}:${port} — servernya kemungkinan belum jalan.`,
      '',
      'Kalau pakai XAMPP: buka XAMPP Control Panel, klik Start di baris MySQL.',
      'Kalau pakai MySQL/MariaDB biasa: pastikan service-nya aktif (services.msc di Windows, atau `sudo service mysql start` di Linux).',
    ].join('\n');
  }
  return null; // unrecognized - let the caller fall back to the raw error
}

module.exports = { explainDbError };
