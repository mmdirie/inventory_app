const { error } = require('../utils/response');

/**
 * Checks if user has one of the allowed roles (Admin always bypasses)
 */
function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return error(res, 'Authentication required', 401);
    }

    if (req.user.role === 'Admin' || allowedRoles.includes(req.user.role)) {
      return next();
    }

    return error(
      res,
      `Access denied. Your role '${req.user.role}' is not authorized to access this resource.`,
      403
    );
  };
}

/**
 * Checks if user has a specific permission (Admin always bypasses)
 */
function requirePermission(permissionName) {
  return (req, res, next) => {
    if (!req.user) {
      return error(res, 'Authentication required', 401);
    }

    if (req.user.role === 'Admin') {
      return next();
    }

    if (req.user.permissions && req.user.permissions.includes(permissionName)) {
      return next();
    }

    return error(
      res,
      `Access denied. You lack the required permission '${permissionName}'.`,
      403
    );
  };
}

module.exports = {
  authorizeRoles,
  requirePermission
};
