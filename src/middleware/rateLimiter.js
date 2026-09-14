const rateLimit = require('express-rate-limit');

// Login-attempt protection: 10 attempts / 15 minutes per IP.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' },
});

// Forgot/reset-password: separate from login-brute-force protection since a
// legitimate user might retry a few times (typo'd email, expired link,
// requesting a fresh one) without that being credential-stuffing behavior.
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset attempts. Try again later.' },
});

// General API rate limit: generous, just to blunt abuse/scraping.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Slow down.' },
});

module.exports = { loginLimiter, passwordResetLimiter, apiLimiter };
