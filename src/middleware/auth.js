const jwt = require('jsonwebtoken');
const db  = require('../db/procedures');

/**
 * Verifies JWT and attaches the user to req.user.
 */
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided.' });
    }
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await db.auth.getUserById(decoded.id);
    if (!user) return res.status(401).json({ message: 'User not found.' });
    if (user.status !== 'active') {
      const msgs = {
        pending:  'Your account is awaiting admin approval.',
        disabled: 'Your account has been disabled. Contact the front desk.',
        rejected: 'Your account was not approved. Contact the front desk.',
      };
      return res.status(403).json({ message: msgs[user.status] || 'Account not active.' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
}

module.exports = { authenticate };
