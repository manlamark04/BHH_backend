/**
 * Integration Test for Socket.IO Authentication & Room Authorization
 * Validates:
 * 1. Unauthenticated connections are rejected.
 * 2. Invalid tokens are rejected.
 * 3. Authenticated customers cannot spoof or join admin rooms.
 * 4. Authenticated admins auto-join admin rooms and receive admin notifications.
 */

const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const path = require('path');
const ioClient = require('c:/Users/jhone/OneDrive/Documents/GitHub/BHH_frontend/CBI_frontend/node_modules/socket.io-client');
const socketConfig = require('../src/config/socket');
const { config } = require('../src/config/env');
const pool = require('../src/config/db');

const TEST_PORT = 5055;

function createTestToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET || 'test_secret_for_unit_tests_only_32_chars',
    { expiresIn: '1h' }
  );
}

async function runTests() {
  console.log('\n========================================');
  console.log('▶ Running: test_socket_auth.js');
  console.log('========================================');

  const app = express();
  const server = http.createServer(app);
  const ioServer = socketConfig.init(server);

  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  console.log(`📡 Test Socket Server listening on port ${TEST_PORT}`);

  // Fetch or mock test users from db
  const [users] = await pool.query("SELECT id, username, role, status FROM users WHERE status = 'active' LIMIT 10");
  const adminUser = users.find(u => u.role === 'admin') || { id: 1, username: 'admin', role: 'admin', status: 'active' };
  const customerUser = users.find(u => u.role === 'customer') || { id: 999, username: 'guest', role: 'customer', status: 'active' };

  const adminToken = createTestToken(adminUser);
  const customerToken = createTestToken(customerUser);

  try {
    // ── Test 1: Connect without token ──
    console.log('\n[Test 1] Testing unauthenticated connection rejection...');
    const unauthClient = ioClient(`http://localhost:${TEST_PORT}`, {
      transports: ['websocket'],
      autoConnect: true,
      reconnection: false,
    });

    const test1Passed = await new Promise((resolve) => {
      unauthClient.on('connect_error', (err) => {
        if (err.message.includes('Token required')) {
          console.log('  ✓ Connection rejected as expected:', err.message);
          unauthClient.disconnect();
          resolve(true);
        } else {
          console.error('  ❌ Unexpected error message:', err.message);
          unauthClient.disconnect();
          resolve(false);
        }
      });
      unauthClient.on('connect', () => {
        console.error('  ❌ Unauthenticated connection was allowed!');
        unauthClient.disconnect();
        resolve(false);
      });
    });

    if (!test1Passed) throw new Error('Test 1 Failed: Unauthenticated connection was not rejected.');
    console.log('✅ Test 1 Passed: Unauthenticated connection rejected.');

    // ── Test 2: Connect with invalid token ──
    console.log('\n[Test 2] Testing invalid token rejection...');
    const invalidClient = ioClient(`http://localhost:${TEST_PORT}`, {
      auth: { token: 'invalid_malformed_token' },
      transports: ['websocket'],
      autoConnect: true,
      reconnection: false,
    });

    const test2Passed = await new Promise((resolve) => {
      invalidClient.on('connect_error', (err) => {
        if (err.message.includes('Invalid or expired token')) {
          console.log('  ✓ Invalid token rejected as expected:', err.message);
          invalidClient.disconnect();
          resolve(true);
        } else {
          console.error('  ❌ Unexpected error message:', err.message);
          invalidClient.disconnect();
          resolve(false);
        }
      });
      invalidClient.on('connect', () => {
        console.error('  ❌ Invalid token connection was allowed!');
        invalidClient.disconnect();
        resolve(false);
      });
    });

    if (!test2Passed) throw new Error('Test 2 Failed: Invalid token was not rejected.');
    console.log('✅ Test 2 Passed: Invalid token rejected.');

    // ── Test 3: Authenticated Customer cannot join Admin room ──
    console.log('\n[Test 3] Testing Customer authorization & anti-spoofing...');
    const customerClient = ioClient(`http://localhost:${TEST_PORT}`, {
      auth: { token: customerToken },
      transports: ['websocket'],
      autoConnect: true,
      reconnection: false,
    });

    await new Promise((resolve, reject) => {
      customerClient.on('connect', () => {
        console.log('  ✓ Customer successfully connected with valid token.');
        resolve();
      });
      customerClient.on('connect_error', (err) => reject(new Error(err.message)));
    });

    // Customer tries to spoof join_role('admin')
    customerClient.emit('join_role', 'admin');
    await new Promise((r) => setTimeout(r, 200));

    // Admin connects
    const adminClient = ioClient(`http://localhost:${TEST_PORT}`, {
      auth: { token: adminToken },
      transports: ['websocket'],
      autoConnect: true,
      reconnection: false,
    });

    await new Promise((resolve, reject) => {
      adminClient.on('connect', () => {
        console.log('  ✓ Admin successfully connected with valid token.');
        resolve();
      });
      adminClient.on('connect_error', (err) => reject(new Error(err.message)));
    });

    // Broadcast test message to 'admin' room
    let customerReceivedAdminMsg = false;
    let adminReceivedAdminMsg = false;

    customerClient.on('secret_admin_event', () => {
      customerReceivedAdminMsg = true;
    });

    adminClient.on('secret_admin_event', () => {
      adminReceivedAdminMsg = true;
    });

    ioServer.to('admin').emit('secret_admin_event');
    await new Promise((r) => setTimeout(r, 300));

    if (customerReceivedAdminMsg) {
      throw new Error('Test 3 Failed: Customer received admin room broadcast!');
    }
    if (!adminReceivedAdminMsg) {
      throw new Error('Test 3 Failed: Admin did not receive admin room broadcast.');
    }

    console.log('  ✓ Admin received admin broadcast.');
    console.log('  ✓ Customer was BLOCKED from admin broadcast (spoofing prevented).');
    console.log('✅ Test 3 Passed: Role-based room authorization strictly enforced.');

    customerClient.disconnect();
    adminClient.disconnect();

    console.log('\n========================================');
    console.log('🎉 ALL SOCKET.IO AUTHENTICATION TESTS PASSED!');
    console.log('========================================\n');
  } finally {
    server.close();
  }
}

if (require.main === module) {
  runTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n❌ Socket Test Failed:', err);
      process.exit(1);
    });
}

module.exports = runTests;
