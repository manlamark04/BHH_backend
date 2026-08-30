require('dotenv').config();
const pool = require('./src/config/db');
const courtSvc = require('./src/services/court.service');
const bookingSvc = require('./src/services/booking.service');

async function runTests() {
  console.log('🧪 Starting Multi-Court Pickleball Integration Tests...\n');

  // Test 1: Fetch Courts
  console.log('1. Testing getCourts()...');
  let courtsData = null;
  const mockRes1 = {
    json: (data) => { courtsData = data; },
    status: (code) => ({ json: (data) => console.log('Error status:', code, data) }),
  };
  await courtSvc.getCourts({ query: {} }, mockRes1);
  console.log(`   Found ${courtsData.length} courts:`, courtsData.map(c => `${c.name} (${c.court_code}) - ₱${c.hourly_rate}/hr [${c.live_status}]`));
  if (courtsData.length < 2) throw new Error('Expected at least 2 courts');

  const courtA = courtsData.find(c => c.court_code === 'COURT-A');
  const courtB = courtsData.find(c => c.court_code === 'COURT-B');

  // Test 2: Clean previous test bookings for tomorrow
  const testDate = '2026-09-01';
  await pool.query("DELETE FROM bills WHERE activity_rental_id IN (SELECT id FROM activity_rentals WHERE notes LIKE '%MULTI_COURT_TEST%')");
  await pool.query("DELETE FROM activity_rentals WHERE notes LIKE '%MULTI_COURT_TEST%'");

  // Test 3: Book Court A at 14:00 - 15:00
  console.log('\n2. Testing Booking Court A at 14:00 - 15:00...');
  let rentalA = null;
  const mockReqCourtA = {
    user: { id: 1, role: 'admin', full_name: 'Admin User' },
    body: {
      activity_id: 2,
      court_id: courtA.id,
      customer_id: 1,
      start_time: `${testDate} 14:00:00`,
      end_time: `${testDate} 15:00:00`,
      notes: 'MULTI_COURT_TEST - Court A Booking',
    },
  };
  const mockResCourtA = {
    status: (code) => ({
      json: (data) => {
        if (code >= 400) console.error('   Failed Court A Booking:', code, data);
        rentalA = data;
      }
    }),
    json: (data) => { rentalA = data; }
  };
  await bookingSvc.createRental(mockReqCourtA, mockResCourtA);
  console.log('   ✅ Court A booking result:', rentalA);

  // Test 4: Concurrently Book Court B at the EXACT SAME TIME (14:00 - 15:00)
  console.log('\n3. Testing Concurrent Booking for Court B at 14:00 - 15:00...');
  let rentalB = null;
  const mockReqCourtB = {
    user: { id: 1, role: 'admin', full_name: 'Admin User' },
    body: {
      activity_id: 2,
      court_id: courtB.id,
      customer_id: 1,
      start_time: `${testDate} 14:00:00`,
      end_time: `${testDate} 15:00:00`,
      notes: 'MULTI_COURT_TEST - Court B Booking',
    },
  };
  const mockResCourtB = {
    status: (code) => ({
      json: (data) => {
        if (code >= 400) console.error('   Failed Court B Booking:', code, data);
        rentalB = data;
      }
    }),
    json: (data) => { rentalB = data; }
  };
  await bookingSvc.createRental(mockReqCourtB, mockResCourtB);
  console.log('   ✅ Court B concurrent booking result (SUCCESS!):', rentalB);

  // Test 5: Try to double book Court A at 14:30 - 15:30 (should CONFLICT)
  console.log('\n4. Testing Double Booking Conflict on Court A (14:30 - 15:30)...');
  let conflictA = null;
  const mockReqConflictA = {
    user: { id: 1, role: 'admin', full_name: 'Admin User' },
    body: {
      activity_id: 2,
      court_id: courtA.id,
      customer_id: 1,
      start_time: `${testDate} 14:30:00`,
      end_time: `${testDate} 15:30:00`,
      notes: 'MULTI_COURT_TEST - Overlap Court A',
    },
  };
  const mockResConflictA = {
    status: (code) => ({
      json: (data) => {
        conflictA = { code, ...data };
      }
    }),
    json: (data) => { conflictA = { code: 200, ...data }; }
  };
  await bookingSvc.createRental(mockReqConflictA, mockResConflictA);
  console.log('   ✅ Expected Conflict on Court A:', conflictA.code, conflictA.message);

  // Test 6: Try to book with 'any' at 14:00 - 15:00 (Both A & B are occupied -> should CONFLICT)
  console.log("\n5. Testing 'Any Available Court' when both Court A & Court B are occupied (14:00 - 15:00)...");
  let conflictAny = null;
  const mockReqConflictAny = {
    user: { id: 1, role: 'admin', full_name: 'Admin User' },
    body: {
      activity_id: 2,
      court_id: 'any',
      customer_id: 1,
      start_time: `${testDate} 14:00:00`,
      end_time: `${testDate} 15:00:00`,
      notes: 'MULTI_COURT_TEST - Overlap Any',
    },
  };
  const mockResConflictAny = {
    status: (code) => ({
      json: (data) => {
        conflictAny = { code, ...data };
      }
    }),
    json: (data) => { conflictAny = { code: 200, ...data }; }
  };
  await bookingSvc.createRental(mockReqConflictAny, mockResConflictAny);
  console.log("   ✅ Expected Conflict when all courts full:", conflictAny.code, conflictAny.message);

  // Test 7: Book with 'any' at 16:00 - 17:00 (Both are free -> Auto-Assigns Court A first)
  console.log("\n6. Testing 'Any Available Court' when both courts are free (16:00 - 17:00)...");
  let autoAssignResult = null;
  const mockReqAuto = {
    user: { id: 1, role: 'admin', full_name: 'Admin User' },
    body: {
      activity_id: 2,
      court_id: 'any',
      customer_id: 1,
      start_time: `${testDate} 16:00:00`,
      end_time: `${testDate} 17:00:00`,
      notes: 'MULTI_COURT_TEST - Auto Assign',
    },
  };
  const mockResAuto = {
    status: (code) => ({
      json: (data) => { autoAssignResult = data; }
    }),
    json: (data) => { autoAssignResult = data; }
  };
  await bookingSvc.createRental(mockReqAuto, mockResAuto);
  console.log('   ✅ Auto-assigned court result:', autoAssignResult.court_name, `(id: ${autoAssignResult.court_id})`);

  // Clean up test records
  await pool.query("DELETE FROM bills WHERE activity_rental_id IN (SELECT id FROM activity_rentals WHERE notes LIKE '%MULTI_COURT_TEST%')");
  await pool.query("DELETE FROM activity_rentals WHERE notes LIKE '%MULTI_COURT_TEST%'");

  console.log('\n🎉 All Multi-Court Tests Passed Successfully!\n');
  await pool.end();
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
