const { hasPermission } = require('../services/permissions');

// Static role gate - use for hard boundaries that must never be reassigned
// through the permission matrix (e.g. "must be super_admin"). For anything
// a Super Admin should be able to delegate to HR/Manager, use
// requirePermission(...) instead - see src/services/permissions.js for the
// full list and src/routes/permissions.routes.js for the editable matrix.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient role' });
    }
    next();
  };
}

// Dynamic RBAC gate: checks the DB-backed role -> permission matrix.
// super_admin always passes. hr/manager pass only if a Super Admin has
// granted that permission code (Settings > Hak Akses in the UI). employee
// never holds any of these permissions.
function requirePermission(code) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!hasPermission(req.user.role, code)) {
      return res.status(403).json({ error: `Forbidden: missing permission '${code}'` });
    }
    next();
  };
}

function canViewSensitive(user) {
  return hasPermission(user.role, 'employees.view_sensitive');
}

function canViewConfidential(user, targetEmployeeId) {
  if (hasPermission(user.role, 'employees.view_sensitive')) return true;
  return user.employeeId === targetEmployeeId;
}

// Strips fields the requesting user isn't allowed to see from an employee row.
function maskEmployee(employee, user) {
  const out = { ...employee };
  const isSelf = user.employeeId === employee.id;

  if (!canViewSensitive(user) && !isSelf) {
    delete out.npwp;
    delete out.bpjs_number;
    delete out.bank_account;
  }
  if (!canViewConfidential(user, employee.id)) {
    delete out.phone;
    delete out.email;
    delete out.address;
    delete out.emergency_contact_name;
    delete out.emergency_contact_phone;
  }
  return out;
}

module.exports = { requireRole, requirePermission, canViewSensitive, canViewConfidential, maskEmployee };
