const nodemailer = require('nodemailer');

// SMTP is optional. If not configured, this app still works for everything
// except actually delivering the password-reset email - see
// routes/auth.routes.js forgot-password handler for the dev-mode fallback
// that surfaces the reset link directly in the API response instead
// (non-production only), so the flow is testable without a mail account.
function isMailerConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

let transporter = null;
function getTransporter() {
  if (!isMailerConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

async function sendPasswordResetEmail(toEmail, resetLink) {
  const t = getTransporter();
  if (!t) throw new Error('SMTP is not configured');
  await t.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject: 'Reset Password - EmployeeHub',
    text: `Kami menerima permintaan reset password untuk akun Anda.\n\nKlik link berikut untuk membuat password baru (berlaku 1 jam):\n${resetLink}\n\nJika Anda tidak meminta ini, abaikan email ini.`,
    html: `<p>Kami menerima permintaan reset password untuk akun Anda.</p>
           <p><a href="${resetLink}">Klik di sini untuk membuat password baru</a> (berlaku 1 jam).</p>
           <p>Jika Anda tidak meminta ini, abaikan email ini.</p>`,
  });
}

module.exports = { isMailerConfigured, sendPasswordResetEmail };
