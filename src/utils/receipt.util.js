const crypto = require('crypto');

/**
 * Generate a random 6-character OR code with format LLLDDD (3 letters + 3 digits)
 * Prefixed with 'OR-' for clear official receipt identification (e.g. 'OR-KJD482')
 */
function generateReceiptCode() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digits = '0123456789';
  
  let l = '';
  for (let i = 0; i < 3; i++) {
    l += letters[crypto.randomInt(0, letters.length)];
  }
  
  let d = '';
  for (let i = 0; i < 3; i++) {
    d += digits[crypto.randomInt(0, digits.length)];
  }
  
  return `OR-${l}${d}`;
}

/**
 * Generate a guaranteed unique receipt number by checking against database
 */
async function getUniqueReceiptNumber(pool) {
  for (let i = 0; i < 50; i++) {
    const code = generateReceiptCode();
    const [rows] = await pool.query('SELECT id FROM payments WHERE receipt_number = ?', [code]);
    if (rows.length === 0) {
      return code;
    }
  }
  throw new Error('Failed to generate a unique Official Receipt (OR) number.');
}

module.exports = {
  generateReceiptCode,
  getUniqueReceiptNumber,
};
