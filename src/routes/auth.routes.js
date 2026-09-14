const express = require('express');
const crypto = require('crypto');
const { authenticator } = require('otplib');
const qrcode = require('qrcode');
const db = require('../db');
const { newId, nowIso } = require('../utils/id');
const { verifyPassword, hashPassword, isStrongPassword } = require('../utils/password');
const { signAccessToken, signPendingTotpToken, signRefreshToken, verifyAccessToken, verifyRefreshToken } = require('../utils/token');
const { loginSchema } = require('../utils/validators');
const { logAudit } = require('../utils/audit');
const { requireAuth } = require('../middleware/auth');
const { loginLimiter, passwordResetLimiter } = require('../middleware/rateLimiter');
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const { isMailerConfigured, sendPasswordResetEmail } = require('../utils/mailer');
const { getEffectivePermissions } = require('../services/permissions');

const router = express.Router();

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
};

function issueTokens(res, user) {
  const payload = { sub: user.id, role: user.role, employeeId: user.employee_id };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken({ sub: user.id });
  res.cookie('access_token', accessToken, { ...COOKIE_OPTS, maxAge: 15 * 60 * 1000 });
  res.cookie('refresh_token', refreshToken, { ...COOKIE_OPTS, maxAge: 7 * 24 * 60 * 60 * 1000 });
  return accessToken;
}

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const ua = req.headers['user-agent'];

    if (!user || !user.is_active) {
      if (user) {
        await db.prepare(
          'INSERT INTO login_history (id, user_id, ip_address, user_agent, success, created_at) VALUES (?,?,?,?,0,?)'
        ).run(newId(), user.id, ip, ua, nowIso());
      }
      throw new ApiError(401, 'Invalid credentials');
    }

    const ok = await verifyPassword(password, user.password);
    await db.prepare(
      'INSERT INTO login_history (id, user_id, ip_address, user_agent, success, created_at) VALUES (?,?,?,?,?,?)'
    ).run(newId(), user.id, ip, ua, ok ? 1 : 0, nowIso());

    if (!ok) {
      await logAudit({ userId: user.id, action: 'login_failed', req });
      throw new ApiError(401, 'Invalid credentials');
    }

    if (user.totp_enabled) {
      const tempToken = signPendingTotpToken(user.id);
      await logAudit({ userId: user.id, action: 'login_password_ok_awaiting_2fa', req });
      return res.json({ requiresTotp: true, tempToken });
    }

    await db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), user.id);
    const accessToken = issueTokens(res, user);
    await logAudit({ userId: user.id, action: 'login', req });

    const employee = user.employee_id
      ? await db.prepare('SELECT id, full_name, photo_url FROM employees WHERE id = ?').get(user.employee_id)
      : null;

    res.json({
      accessToken, // also returned in body so the SPA/socket client can use it without reading the httpOnly cookie
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        mustChangePassword: !!user.must_change_pw,
        employee,
      },
    });
  })
);

// Step 2 of login when the account has 2FA enabled: exchange the short-lived
// pending token + a valid TOTP code for real access/refresh tokens.
router.post(
  '/2fa/verify-login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { tempToken, token } = req.body;
    if (!tempToken || !token) throw new ApiError(400, 'tempToken and token are required');

    let payload;
    try {
      payload = verifyAccessToken(tempToken);
    } catch {
      throw new ApiError(401, 'Verification session expired, please log in again');
    }
    if (!payload.pending2fa) throw new ApiError(400, 'Invalid verification session');

    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
    if (!user || !user.is_active || !user.totp_enabled) throw new ApiError(401, 'Session invalid');

    const valid = authenticator.verify({ token, secret: user.totp_secret });
    if (!valid) {
      await logAudit({ userId: user.id, action: 'login_2fa_failed', req });
      throw new ApiError(401, 'Invalid authenticator code');
    }

    await db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), user.id);
    const accessToken = issueTokens(res, user);
    await logAudit({ userId: user.id, action: 'login', req, metadata: { via2fa: true } });

    const employee = user.employee_id
      ? await db.prepare('SELECT id, full_name, photo_url FROM employees WHERE id = ?').get(user.employee_id)
      : null;

    res.json({
      accessToken,
      user: { id: user.id, email: user.email, role: user.role, mustChangePassword: !!user.must_change_pw, employee },
    });
  })
);

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.refresh_token;
    if (!token) throw new ApiError(401, 'No refresh token');
    let payload;
    try {
      payload = verifyRefreshToken(token);
    } catch {
      throw new ApiError(401, 'Refresh token invalid or expired');
    }
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
    if (!user || !user.is_active) throw new ApiError(401, 'Session invalid');
    const accessToken = issueTokens(res, user);
    res.json({ accessToken });
  })
);

router.post('/logout', requireAuth, asyncHandler(async (req, res) => {
  await logAudit({ userId: req.user.id, action: 'logout', req });
  res.clearCookie('access_token');
  res.clearCookie('refresh_token');
  res.json({ ok: true });
}));

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const employee = user.employee_id
      ? await db.prepare(
            `SELECT e.*, d.name as department_name, p.title as position_title
             FROM employees e
             LEFT JOIN departments d ON d.id = e.department_id
             LEFT JOIN positions p ON p.id = e.position_id
             WHERE e.id = ?`
          )
          .get(user.employee_id)
      : null;
    res.json({
      id: user.id,
      email: user.email,
      role: user.role,
      mustChangePassword: !!user.must_change_pw,
      totpEnabled: !!user.totp_enabled,
      permissions: getEffectivePermissions(user.role),
      employee,
    });
  })
);

router.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!isStrongPassword(newPassword)) {
      throw new ApiError(400, 'Password must be at least 8 characters and include letters and numbers');
    }
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const ok = await verifyPassword(currentPassword, user.password);
    if (!ok) throw new ApiError(401, 'Current password is incorrect');
    const hash = await hashPassword(newPassword);
    await db.prepare('UPDATE users SET password = ?, must_change_pw = 0, updated_at = ? WHERE id = ?').run(
      hash,
      nowIso(),
      user.id
    );
    await logAudit({ userId: user.id, action: 'password_change', req });
    res.json({ ok: true });
  })
);

router.get(
  '/login-history',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await db.prepare('SELECT * FROM login_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
      .all(req.user.id);
    res.json(rows);
  })
);

// ---- Two-factor authentication (TOTP) --------------------------------------

// Generates a new secret and returns a scannable QR code. Not yet active -
// the user must confirm a code via /2fa/enable before totp_enabled flips on,
// so a half-finished setup can't accidentally lock anyone out.
router.post(
  '/2fa/setup',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const secret = authenticator.generateSecret();
    await db.prepare('UPDATE users SET totp_secret = ?, updated_at = ? WHERE id = ?').run(secret, nowIso(), user.id);
    const otpauth = authenticator.keyuri(user.email, 'EmployeeHub', secret);
    const qrDataUrl = await qrcode.toDataURL(otpauth);
    res.json({ secret, qrDataUrl });
  })
);

router.post(
  '/2fa/enable',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { token } = req.body;
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user.totp_secret) throw new ApiError(400, 'Run 2FA setup first');
    const valid = authenticator.verify({ token: token || '', secret: user.totp_secret });
    if (!valid) throw new ApiError(400, 'Invalid code - check your authenticator app and try again');
    await db.prepare('UPDATE users SET totp_enabled = 1, updated_at = ? WHERE id = ?').run(nowIso(), user.id);
    await logAudit({ userId: user.id, action: '2fa_enabled', req });
    res.json({ ok: true });
  })
);

router.post(
  '/2fa/disable',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { password } = req.body;
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const ok = await verifyPassword(password || '', user.password);
    if (!ok) throw new ApiError(401, 'Current password is incorrect');
    await db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL, updated_at = ? WHERE id = ?').run(nowIso(), user.id);
    await logAudit({ userId: user.id, action: '2fa_disabled', req });
    res.json({ ok: true });
  })
);

// ---- Forgot / reset password (unauthenticated) -----------------------------

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// Always responds the same way regardless of whether the email exists, to
// avoid leaking which addresses have accounts. Requires SMTP_HOST/USER/PASS
// in .env to actually deliver the email - see README. Outside production,
// if SMTP isn't configured, the raw reset link is returned in the response
// so the flow stays testable without a mail account.
router.post(
  '/forgot-password',
  passwordResetLimiter,
  asyncHandler(async (req, res) => {
    const { email } = req.body;
    const generic = { ok: true, message: 'Jika email terdaftar, link reset password telah dikirim.' };
    if (!email) return res.json(generic);

    const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase());
    if (!user || !user.is_active) return res.json(generic);

    const rawToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
    await db.prepare('INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?,?,?,?,?)').run(
      newId(), user.id, hashToken(rawToken), expiresAt, nowIso()
    );

    const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const resetLink = `${baseUrl}/reset-password.html?token=${rawToken}`;
    await logAudit({ userId: user.id, action: 'password_reset_requested', req });

    if (isMailerConfigured()) {
      try {
        await sendPasswordResetEmail(user.email, resetLink);
      } catch (err) {
        console.error('[mailer] Failed to send password reset email:', err.message);
      }
      return res.json(generic);
    }

    // Dev-mode fallback: no SMTP configured, so there's no way to actually
    // deliver the email. Surface the link directly (never do this in
    // production - see the isMailerConfigured() branch above for that path).
    if (process.env.NODE_ENV !== 'production') {
      return res.json({ ...generic, devResetLink: resetLink, devNote: 'SMTP is not configured - this link is only shown because NODE_ENV != production.' });
    }
    return res.json(generic);
  })
);

router.post(
  '/reset-password',
  passwordResetLimiter,
  asyncHandler(async (req, res) => {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) throw new ApiError(400, 'token and newPassword are required');
    if (!isStrongPassword(newPassword)) {
      throw new ApiError(400, 'Password must be at least 8 characters and include letters and numbers');
    }

    const row = await db.prepare('SELECT * FROM password_reset_tokens WHERE token_hash = ?').get(hashToken(token));
    if (!row || row.used_at || new Date(row.expires_at) < new Date()) {
      throw new ApiError(400, 'This reset link is invalid or has expired');
    }

    const hash = await hashPassword(newPassword);
    await db.prepare('UPDATE users SET password = ?, must_change_pw = 0, updated_at = ? WHERE id = ?').run(hash, nowIso(), row.user_id);
    await db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?').run(nowIso(), row.id);
    await logAudit({ userId: row.user_id, action: 'password_reset_completed', req });
    res.json({ ok: true });
  })
);

module.exports = router;
