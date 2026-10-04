const pool = require('../config/db');

async function test() {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO motor_rentals (
        rental_id, customer_id, motor_id, start_datetime, expected_return_datetime,
        duration, rate, rate_type, total_amount, final_amount, status, notes,
        license_type, passport_number, country_of_issuance, foreign_license_number, foreign_license_expiry, idp_number, idp_expiry, idp_category_a,
        driver_license_number, driver_license_expiry, driver_license_restrictions, designated_driver_name,
        payment_deadline, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        'TEST-6666',
        undefined, // Pass undefined
        1,
        new Date(),
        new Date(),
        1,
        700,
        'daily',
        700,
        700,
        'PENDING_PAYMENT',
        'Test Notes',
        'PH',
        null, null, null, null, null, null, 0,
        'L123', '2030', 'A', 'Driver',
        null,
        1
      ]
    );
    console.log("Insert success!", result);
    await conn.rollback();
  } catch (err) {
    console.error("Insert failed:", err.message);
    if (conn) await conn.rollback();
  } finally {
    if (conn) conn.release();
    process.exit(0);
  }
}
test();
