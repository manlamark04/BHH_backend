/**
 * Unit & Integration Tests for Environment Configuration & Schema Validation
 */

const assert = require('assert');
const { validateEnv } = require('../src/config/env');

function runTests() {
  console.log('=== Running Environment Schema Validation Tests ===\n');

  // [Test 1] Valid Configuration Parsing & Type Casting
  console.log('[Test 1] Testing Valid Environment Variables...');
  const validMock = {
    NODE_ENV: 'test',
    PORT: '8080',
    DB_HOST: '127.0.0.1',
    DB_PORT: '3307',
    DB_NAME: 'bhh_test',
    DB_USER: 'bhh_admin',
    DB_PASSWORD: 'secretpassword',
    JWT_SECRET: 'this_is_a_secure_jwt_secret_with_over_32_characters_123',
    JWT_EXPIRES_IN: '14d',
    FRONTEND_URL: 'http://localhost:3000',
    UPLOADS_DIR: 'custom_uploads',
    MIN_DEPOSIT_PERCENT: '50',
    PENDING_PAYMENT_TIMEOUT_HOURS: '12',
    NO_SHOW_FEE_POLICY: 'flat',
    NO_SHOW_FEE_FLAT_AMOUNT: '500',
    NO_SHOW_FEE_PERCENTAGE: '30',
  };

  const parsed = validateEnv(validMock);

  assert.strictEqual(parsed.port, 8080);
  assert.strictEqual(parsed.isTest, true);
  assert.strictEqual(parsed.db.host, '127.0.0.1');
  assert.strictEqual(parsed.db.port, 3307);
  assert.strictEqual(parsed.db.name, 'bhh_test');
  assert.strictEqual(parsed.db.user, 'bhh_admin');
  assert.strictEqual(parsed.db.password, 'secretpassword');
  assert.strictEqual(parsed.jwt.expiresIn, '14d');
  assert.strictEqual(parsed.business.minDepositPercent, 50);
  assert.strictEqual(parsed.business.pendingPaymentTimeoutHours, 12);
  assert.strictEqual(parsed.business.noShowPolicy, 'flat');
  assert.strictEqual(parsed.business.noShowFlatAmount, 500);
  assert.strictEqual(parsed.business.noShowPercentage, 30);

  // Object immutability check
  assert.strictEqual(Object.isFrozen(parsed), true);
  assert.strictEqual(Object.isFrozen(parsed.db), true);
  assert.strictEqual(Object.isFrozen(parsed.jwt), true);
  assert.strictEqual(Object.isFrozen(parsed.business), true);

  console.log('  ✓ Valid environment parsed, cast to numbers/booleans, and object is frozen.');
  console.log('✅ Test 1 Passed: Valid config correctly validated.\n');

  // [Test 2] Invalid Port Checking
  console.log('[Test 2] Testing Port Validation Bounds...');
  assert.throws(() => {
    validateEnv({ ...validMock, PORT: '99999' }, { throwOnError: true });
  }, /PORT must be a valid integer between 1 and 65535/);

  assert.throws(() => {
    validateEnv({ ...validMock, PORT: 'abc' }, { throwOnError: true });
  }, /PORT must be a valid integer between 1 and 65535/);

  console.log('  ✓ Out-of-bounds and non-numeric ports successfully caught.');
  console.log('✅ Test 2 Passed: Port validation verified.\n');

  // [Test 3] Production Mode Security Constraints
  console.log('[Test 3] Testing Production Mode Security Checks...');

  // Short JWT Secret in Production
  assert.throws(() => {
    validateEnv({
      ...validMock,
      NODE_ENV: 'production',
      JWT_SECRET: 'short_key',
    }, { throwOnError: true });
  }, /JWT_SECRET must be at least 32 characters in production/);

  // Default Placeholder JWT Secret in Production
  assert.throws(() => {
    validateEnv({
      ...validMock,
      NODE_ENV: 'production',
      JWT_SECRET: 'your_super_secret_jwt_key_change_this_min_32_chars',
    }, { throwOnError: true });
  }, /JWT_SECRET is set to the default placeholder/);

  console.log('  ✓ Insecure and placeholder JWT secrets blocked in production mode.');
  console.log('✅ Test 3 Passed: Production security gates verified.\n');

  // [Test 4] Business Parameter Range Constraints
  console.log('[Test 4] Testing Business Parameter Bounds...');

  assert.throws(() => {
    validateEnv({ ...validMock, MIN_DEPOSIT_PERCENT: '150' }, { throwOnError: true });
  }, /MIN_DEPOSIT_PERCENT must be a number between 0 and 100/);

  assert.throws(() => {
    validateEnv({ ...validMock, PENDING_PAYMENT_TIMEOUT_HOURS: '-5' }, { throwOnError: true });
  }, /PENDING_PAYMENT_TIMEOUT_HOURS must be a positive integer/);

  assert.throws(() => {
    validateEnv({ ...validMock, NO_SHOW_FEE_POLICY: 'invalid_policy' }, { throwOnError: true });
  }, /NO_SHOW_FEE_POLICY must be "percentage" or "flat"/);

  console.log('  ✓ Deposit %, timeout hours, and cancellation fee policies strictly bounded.');
  console.log('✅ Test 4 Passed: Business rules validation verified.\n');

  console.log('🎉 ALL ENVIRONMENT VALIDATION TESTS PASSED! 🎉\n');
}

runTests();
