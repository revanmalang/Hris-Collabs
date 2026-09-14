const jwt = require('jsonwebtoken');

function signAccessToken(payload) {
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m',
  });
}

// Short-lived token issued after password verification for an account with
// 2FA enabled, but before the TOTP code is confirmed. Deliberately cannot be
// used as a normal access token - requireAuth() rejects anything carrying
// the `pending2fa` claim.
function signPendingTotpToken(userId) {
  return jwt.sign({ sub: userId, pending2fa: true }, process.env.JWT_ACCESS_SECRET, { expiresIn: '5m' });
}

function signRefreshToken(payload) {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES || '7d',
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}

module.exports = { signAccessToken, signPendingTotpToken, signRefreshToken, verifyAccessToken, verifyRefreshToken };
