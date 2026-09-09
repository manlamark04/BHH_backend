const { validationResult } = require('express-validator');

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorList = errors.array();
    const primaryMsg = errorList[0]?.msg || 'Validation failed.';
    return res.status(422).json({
      success: false,
      message: primaryMsg,
      errors: errorList,
      error: {
        code: 'VALIDATION_ERROR',
        message: primaryMsg,
        details: errorList,
      },
    });
  }
  next();
}

module.exports = { validate };
