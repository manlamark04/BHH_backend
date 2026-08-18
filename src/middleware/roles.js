/**
 * Role-based access control middleware factory.
 * Usage: require(['admin']) or require(['staff', 'admin'])
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Not authenticated.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Insufficient permissions.' });
    }
    next();
  };
}

module.exports = { requireRole };
