const { verifyAccessToken } = require('../utils/token');
const db = require('../db');

// Reads the access token from the httpOnly cookie (falls back to Authorization
// header for API clients / tests), verifies it, and confirms the user still
// exists and is active on every request (so a deactivated account is locked
// out immediately, not just until its token expires). Async because the
// user lookup is a real DB round trip - Express supports async middleware
// as long as errors are caught and forwarded, which the try/catch below does.
async function requireAuth(req, res, next) {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  const token = req.cookies?.access_token || bearer;

  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const payload = verifyAccessToken(token);
    if (payload.pending2fa) {
      return res.status(401).json({ error: 'Two-factor verification required' });
    }
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Session invalid' });
    }
    req.user = { id: user.id, email: user.email, role: user.role, employeeId: user.employee_id };
    next();
  } catch (err) {
    if (err.status || err.message?.includes('jwt') || err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired' });
    }
    next(err); // an unexpected (e.g. DB) error - let the global error handler deal with it
  }
}

module.exports = { requireAuth };
