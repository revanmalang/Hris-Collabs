const express = require('express');
const { getMatrix, setGrant, PERMISSION_DEFS } = require('../services/permissions');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { logAudit } = require('../utils/audit');
const asyncHandler = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(requireAuth);

// Editing the permission matrix is a Super Admin-only capability and is
// deliberately NOT itself one of the delegatable permissions - letting HR
// grant itself more permissions would defeat the point of having a matrix
// at all.
router.get(
  '/permissions',
  requireRole('super_admin'),
  asyncHandler(async (req, res) => {
    res.json(getMatrix());
  })
);

router.put(
  '/permissions',
  requireRole('super_admin'),
  asyncHandler(async (req, res) => {
    const { role, code, enabled } = req.body;
    if (!['hr', 'manager'].includes(role)) throw new ApiError(400, 'role must be hr or manager');
    if (!PERMISSION_DEFS.some((p) => p.code === code)) throw new ApiError(400, 'Unknown permission code');
    await setGrant(role, code, !!enabled);
    await logAudit({ userId: req.user.id, action: 'permission_grant_changed', req, metadata: { role, code, enabled: !!enabled } });
    res.json(getMatrix());
  })
);

module.exports = router;
