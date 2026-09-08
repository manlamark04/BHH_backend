/**
 * Unified Test Suite Runner for BHH Backend
 * Runs all integration and validation tests sequentially.
 */
const { spawn } = require('child_process');
const path = require('path');

const testFiles = [
  'test_env_validation.js',
  'test_error_handling.js',
  'test_payment_validation.js',
  'test_official_receipt.js',
  'test_multi_court.js',
  'test_motor_late_fee.js',
  'test_motor_damage.js',
  'test_cancellation_billing.js',
];

async function runTest(file) {
  return new Promise((resolve, reject) => {
    console.log(`\n========================================`);
    console.log(`▶ Running: ${file}`);
    console.log(`========================================`);

    const filePath = path.join(__dirname, file);
    const proc = spawn('node', [filePath], { stdio: 'inherit', env: process.env });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Test ${file} failed with exit code ${code}`));
      }
    });
  });
}

async function main() {
  console.log('🚀 Starting BHH Backend Test Suite...\n');
  let passed = 0;
  let failed = 0;

  for (const file of testFiles) {
    try {
      await runTest(file);
      passed++;
    } catch (err) {
      console.error(`❌ ${err.message}`);
      failed++;
    }
  }

  console.log('\n========================================');
  console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
  console.log('========================================');

  process.exit(failed > 0 ? 1 : 0);
}

main();
