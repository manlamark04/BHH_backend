/**
 * Centralized Environment Configuration & Schema Validation
 * Validates all required environment variables on startup with type casting and sanity checks.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

function validateEnv(env = process.env, { throwOnError = false } = {}) {
  const errors = [];
  const warnings = [];

  const nodeEnv = (env.NODE_ENV || 'development').toLowerCase();
  const isProd = nodeEnv === 'production';
  const isDev = nodeEnv === 'development';
  const isTest = nodeEnv === 'test';

  // 1. Port validation
  const port = parseInt(env.PORT || '5000', 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    errors.push(`PORT must be a valid integer between 1 and 65535 (received: "${env.PORT}")`);
  }

  // 2. Database validation
  const dbHost = env.DB_HOST || 'localhost';
  const dbPort = parseInt(env.DB_PORT || '3306', 10);
  if (isNaN(dbPort) || dbPort < 1 || dbPort > 65535) {
    errors.push(`DB_PORT must be a valid integer between 1 and 65535 (received: "${env.DB_PORT}")`);
  }

  const dbName = env.DB_NAME ? env.DB_NAME.trim() : '';
  if (!dbName && !isTest && !throwOnError) {
    errors.push('DB_NAME is required but was not provided');
  }

  const dbUser = env.DB_USER ? env.DB_USER.trim() : '';
  if (!dbUser && !isTest && !throwOnError) {
    errors.push('DB_USER is required but was not provided');
  }

  const dbPassword = env.DB_PASSWORD !== undefined ? env.DB_PASSWORD : '';

  // 3. JWT validation
  const jwtSecret = env.JWT_SECRET ? env.JWT_SECRET.trim() : '';
  if (!jwtSecret && !isTest && !throwOnError) {
    errors.push('JWT_SECRET is required to secure authentication tokens');
  } else if (isProd && jwtSecret.length < 32) {
    errors.push(`JWT_SECRET must be at least 32 characters in production (currently ${jwtSecret.length})`);
  } else if (isProd && jwtSecret.includes('change_this')) {
    errors.push('JWT_SECRET is set to the default placeholder; must be changed in production');
  } else if (jwtSecret.includes('change_this') && !isTest && !throwOnError) {
    warnings.push('JWT_SECRET is using a default example string; consider setting a unique secret');
  }

  const jwtExpiresIn = env.JWT_EXPIRES_IN || '7d';

  // 4. URLs and paths
  const frontendUrl = env.FRONTEND_URL || 'http://localhost:5173';
  const uploadsDir = env.UPLOADS_DIR || 'uploads';

  // 5. Business rules validation
  const minDepositPercent = parseFloat(env.MIN_DEPOSIT_PERCENT || '100');
  if (isNaN(minDepositPercent) || minDepositPercent < 0 || minDepositPercent > 100) {
    errors.push(`MIN_DEPOSIT_PERCENT must be a number between 0 and 100 (received: "${env.MIN_DEPOSIT_PERCENT}")`);
  }

  const pendingPaymentTimeoutHours = parseInt(env.PENDING_PAYMENT_TIMEOUT_HOURS || '24', 10);
  if (isNaN(pendingPaymentTimeoutHours) || pendingPaymentTimeoutHours <= 0) {
    errors.push(`PENDING_PAYMENT_TIMEOUT_HOURS must be a positive integer (received: "${env.PENDING_PAYMENT_TIMEOUT_HOURS}")`);
  }

  const noShowPolicy = (env.NO_SHOW_FEE_POLICY || 'percentage').toLowerCase();
  if (!['percentage', 'flat'].includes(noShowPolicy)) {
    errors.push(`NO_SHOW_FEE_POLICY must be "percentage" or "flat" (received: "${env.NO_SHOW_FEE_POLICY}")`);
  }

  const noShowFlatAmount = parseFloat(env.NO_SHOW_FEE_FLAT_AMOUNT || '200');
  if (isNaN(noShowFlatAmount) || noShowFlatAmount < 0) {
    errors.push(`NO_SHOW_FEE_FLAT_AMOUNT must be a non-negative number (received: "${env.NO_SHOW_FEE_FLAT_AMOUNT}")`);
  }

  const noShowPercentage = parseFloat(env.NO_SHOW_FEE_PERCENTAGE || '20');
  if (isNaN(noShowPercentage) || noShowPercentage < 0 || noShowPercentage > 100) {
    errors.push(`NO_SHOW_FEE_PERCENTAGE must be between 0 and 100 (received: "${env.NO_SHOW_FEE_PERCENTAGE}")`);
  }

  // Handle errors
  if (errors.length > 0) {
    const errorBanner = [
      '\n╔═══════════════════════════════════════════════════════════════════════╗',
      '║               ❌ ENVIRONMENT CONFIGURATION ERROR                     ║',
      '╚═══════════════════════════════════════════════════════════════════════╝',
      ...errors.map(err => `  • ${err}`),
      '═════════════════════════════════════════════════════════════════════════\n',
    ].join('\n');

    if (throwOnError || isTest) {
      throw new Error(`Environment Validation Failed: ${errors.join('; ')}`);
    } else {
      console.error(errorBanner);
      process.exit(1);
    }
  }

  // Log warnings if any
  if (warnings.length > 0 && !isTest) {
    console.warn('\n⚠️ [ENV WARNINGS]:');
    warnings.forEach(w => console.warn(`  • ${w}`));
  }

  // Backfill process.env to ensure consistency
  env.PORT = String(port);
  env.NODE_ENV = nodeEnv;
  env.DB_HOST = dbHost;
  env.DB_PORT = String(dbPort);
  env.DB_NAME = dbName || 'bhh';
  env.DB_USER = dbUser || 'bhh';
  env.DB_PASSWORD = dbPassword;
  env.JWT_SECRET = jwtSecret || 'test_secret_for_unit_tests_only_32_chars';
  env.JWT_EXPIRES_IN = jwtExpiresIn;
  env.FRONTEND_URL = frontendUrl;
  env.UPLOADS_DIR = uploadsDir;
  env.MIN_DEPOSIT_PERCENT = String(minDepositPercent);
  env.PENDING_PAYMENT_TIMEOUT_HOURS = String(pendingPaymentTimeoutHours);

  return Object.freeze({
    env: nodeEnv,
    isProd,
    isDev,
    isTest,
    port,
    frontendUrl,
    uploadsDir,
    db: Object.freeze({
      host: dbHost,
      port: dbPort,
      name: dbName || 'bhh',
      user: dbUser || 'bhh',
      password: dbPassword,
    }),
    jwt: Object.freeze({
      secret: jwtSecret || 'test_secret_for_unit_tests_only_32_chars',
      expiresIn: jwtExpiresIn,
    }),
    business: Object.freeze({
      minDepositPercent,
      pendingPaymentTimeoutHours,
      noShowPolicy,
      noShowFlatAmount,
      noShowPercentage,
    }),
  });
}

const config = validateEnv(process.env);

module.exports = {
  config,
  validateEnv,
};
