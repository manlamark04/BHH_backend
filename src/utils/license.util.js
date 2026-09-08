/**
 * Driver's License Validation & Formatting Utility
 * Standard Philippine LTO format: A12-34-567890
 *
 * Format Breakdown:
 *  - 1 uppercase letter (A-Z)
 *  - 2 digits (0-9)
 *  - Hyphen (-)
 *  - 2 digits (0-9)
 *  - Hyphen (-)
 *  - 6 digits (0-9)
 * Total length: 13 characters
 */

const DRIVER_LICENSE_REGEX = /^[A-Z][0-9]{2}-[0-9]{2}-[0-9]{6}$/;
const DRIVER_LICENSE_ERROR_MSG = "Invalid Driver’s License Number. Please use the format A12-34-567890.";

/**
 * Validates a driver's license number string.
 * @param {string} value - The license number to validate.
 * @returns {{ isValid: boolean, error?: string }}
 */
function validateDriverLicense(value) {
  if (!value || typeof value !== 'string') {
    return {
      isValid: false,
      error: "Driver's license number is required.",
    };
  }

  const trimmed = value.trim();

  // Must match exact pattern: A12-34-567890
  if (!DRIVER_LICENSE_REGEX.test(trimmed)) {
    return {
      isValid: false,
      error: DRIVER_LICENSE_ERROR_MSG,
    };
  }

  return { isValid: true };
}

/**
 * Automatically formats user input into standard format A12-34-567890.
 * Uppercases letter, prevents non-digits in numeric sections, and adds hyphens.
 * @param {string} input
 * @returns {string}
 */
function formatDriverLicense(input) {
  if (!input || typeof input !== 'string') return '';

  let cleaned = input.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (cleaned.length > 0 && !/^[A-Z]/.test(cleaned)) {
    cleaned = cleaned.replace(/^[^A-Z]+/, '');
    if (!cleaned) return '';
  }

  const firstChar = cleaned.charAt(0);
  const remainingRaw = cleaned.slice(1).replace(/[^0-9]/g, '').slice(0, 10);

  let formatted = firstChar;
  if (remainingRaw.length > 0) {
    formatted += remainingRaw.slice(0, 2);
  }
  if (remainingRaw.length > 2) {
    formatted += '-' + remainingRaw.slice(2, 4);
  } else if (remainingRaw.length === 2 && input.endsWith('-')) {
    formatted += '-';
  }

  if (remainingRaw.length > 4) {
    formatted += '-' + remainingRaw.slice(4, 10);
  } else if (remainingRaw.length === 4 && input.endsWith('-')) {
    formatted += '-';
  }

  return formatted.slice(0, 13);
}

module.exports = {
  DRIVER_LICENSE_REGEX,
  DRIVER_LICENSE_ERROR_MSG,
  validateDriverLicense,
  formatDriverLicense,
};
