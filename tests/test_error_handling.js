/**
 * Integration & Unit Tests for API Response Envelope & Centralized Error Handling
 */

const assert = require('assert');
const {
  AppError,
  BadRequestError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  InternalServerError,
  sendSuccess,
  sendError,
  sendEnvelope,
} = require('../src/utils/apiResponse');
const { errorHandler, notFoundHandler } = require('../src/middleware/errorHandler');

// Mock response helper
function createMockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

async function runTests() {
  console.log('=== Running Standard API Response & Centralized Error Handler Tests ===\n');

  // [Test 1] Error Class Hierarchy & Codes
  console.log('[Test 1] Testing AppError and Subclass Properties...');
  const badReq = new BadRequestError('Invalid input field', { field: 'email' });
  assert.strictEqual(badReq.statusCode, 400);
  assert.strictEqual(badReq.code, 'BAD_REQUEST');
  assert.strictEqual(badReq.message, 'Invalid input field');
  assert.deepStrictEqual(badReq.details, { field: 'email' });
  assert.strictEqual(badReq.isOperational, true);

  const valErr = new ValidationError('Password is too short');
  assert.strictEqual(valErr.statusCode, 400);
  assert.strictEqual(valErr.code, 'VALIDATION_ERROR');

  const authErr = new UnauthorizedError();
  assert.strictEqual(authErr.statusCode, 401);
  assert.strictEqual(authErr.code, 'UNAUTHORIZED');

  const forbidErr = new ForbiddenError();
  assert.strictEqual(forbidErr.statusCode, 403);
  assert.strictEqual(forbidErr.code, 'FORBIDDEN');

  const notFound = new NotFoundError('Room not found');
  assert.strictEqual(notFound.statusCode, 404);
  assert.strictEqual(notFound.code, 'NOT_FOUND');

  const conflict = new ConflictError('Time slot already occupied');
  assert.strictEqual(conflict.statusCode, 409);
  assert.strictEqual(conflict.code, 'CONFLICT');

  console.log('  ✓ All error classes have expected status codes, error codes, and operational flags.');
  console.log('✅ Test 1 Passed: Error class hierarchy verified.\n');

  // [Test 2] Response Envelope Formatter (sendSuccess, sendEnvelope, sendError)
  console.log('[Test 2] Testing Response Envelope Formatters...');
  
  // Object response (merges payload, ensures success & message)
  const res1 = createMockRes();
  sendSuccess(res1, { id: 42, role: 'staff' }, 'Created successfully', 201);
  assert.strictEqual(res1.statusCode, 201);
  assert.strictEqual(res1.body.success, true);
  assert.strictEqual(res1.body.message, 'Created successfully');
  assert.strictEqual(res1.body.id, 42);
  assert.strictEqual(res1.body.role, 'staff');

  // Array response (returns directly to keep frontend array types intact)
  const res2 = createMockRes();
  sendSuccess(res2, [{ id: 1 }, { id: 2 }]);
  assert.strictEqual(res2.statusCode, 200);
  assert.strictEqual(Array.isArray(res2.body), true);
  assert.strictEqual(res2.body.length, 2);

  // Explicit envelope response
  const res3 = createMockRes();
  sendEnvelope(res3, { total: 100 }, 'Success summary', 200, { page: 1, limit: 10 });
  assert.strictEqual(res3.statusCode, 200);
  assert.strictEqual(res3.body.success, true);
  assert.strictEqual(res3.body.message, 'Success summary');
  assert.deepStrictEqual(res3.body.data, { total: 100 });
  assert.deepStrictEqual(res3.body.meta, { page: 1, limit: 10 });

  // sendError helper
  const res4 = createMockRes();
  sendError(res4, 'Payment amount too low', 400, 'PAYMENT_TOO_LOW');
  assert.strictEqual(res4.statusCode, 400);
  assert.strictEqual(res4.body.success, false);
  assert.strictEqual(res4.body.message, 'Payment amount too low');
  assert.strictEqual(res4.body.error.code, 'PAYMENT_TOO_LOW');

  console.log('  ✓ sendSuccess, sendEnvelope, and sendError generate correct status and payloads.');
  console.log('✅ Test 2 Passed: Envelope helpers verified.\n');

  // [Test 3] Global Error Handler Normalization
  console.log('[Test 3] Testing Global Error Handler Normalization...');

  const mockReq = { method: 'POST', originalUrl: '/api/test' };

  // 3A: Operational AppError
  const resErr1 = createMockRes();
  errorHandler(new NotFoundError('Booking #999 not found'), mockReq, resErr1, () => {});
  assert.strictEqual(resErr1.statusCode, 404);
  assert.strictEqual(resErr1.body.success, false);
  assert.strictEqual(resErr1.body.message, 'Booking #999 not found');
  assert.strictEqual(resErr1.body.error.code, 'NOT_FOUND');

  // 3B: MySQL Duplicate Key Error (ER_DUP_ENTRY / 1062)
  const resErr2 = createMockRes();
  const mysqlDupErr = new Error('Duplicate entry for key users.email');
  mysqlDupErr.code = 'ER_DUP_ENTRY';
  mysqlDupErr.errno = 1062;
  errorHandler(mysqlDupErr, mockReq, resErr2, () => {});
  assert.strictEqual(resErr2.statusCode, 409);
  assert.strictEqual(resErr2.body.success, false);
  assert.strictEqual(resErr2.body.error.code, 'DUPLICATE_ENTRY');

  // 3C: MySQL Foreign Key Error (ER_NO_REFERENCED_ROW_2 / 1452)
  const resErr3 = createMockRes();
  const mysqlFkErr = new Error('Cannot add or update child row');
  mysqlFkErr.code = 'ER_NO_REFERENCED_ROW_2';
  mysqlFkErr.errno = 1452;
  errorHandler(mysqlFkErr, mockReq, resErr3, () => {});
  assert.strictEqual(resErr3.statusCode, 400);
  assert.strictEqual(resErr3.body.success, false);
  assert.strictEqual(resErr3.body.error.code, 'FOREIGN_KEY_NOT_FOUND');

  // 3D: JSON Syntax Error
  const resErr4 = createMockRes();
  const jsonErr = new SyntaxError('Unexpected token } in JSON');
  jsonErr.status = 400;
  jsonErr.body = '{ bad }';
  errorHandler(jsonErr, mockReq, resErr4, () => {});
  assert.strictEqual(resErr4.statusCode, 400);
  assert.strictEqual(resErr4.body.error.code, 'INVALID_JSON');

  // 3E: 404 Not Found Handler
  const res404 = createMockRes();
  notFoundHandler({ method: 'GET', originalUrl: '/api/nonexistent' }, res404);
  assert.strictEqual(res404.statusCode, 404);
  assert.strictEqual(res404.body.success, false);
  assert.strictEqual(res404.body.error.code, 'ROUTE_NOT_FOUND');

  console.log('  ✓ Operational errors, MySQL errors, JSON syntax, and 404 routes correctly normalized.');
  console.log('✅ Test 3 Passed: Error handler normalization verified.\n');

  console.log('🎉 ALL ERROR HANDLING & RESPONSE TESTS PASSED! 🎉\n');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
