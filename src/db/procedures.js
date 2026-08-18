/**
 * procedures.js
 * ─────────────────────────────────────────────────────────────
 * The ONLY file that touches the database.
 * All stored procedure calls are centralised here.
 * Controllers and services must import from this file.
 * ─────────────────────────────────────────────────────────────
 */
const pool = require('../config/db');

// ─── Helper ───────────────────────────────────────────────────
async function call(fnName, params = []) {
  const placeholders = params.map(() => '?').join(', ');
  const sql = `CALL ${fnName}(${placeholders})`;
  const [result] = await pool.query(sql, params);
  return Array.isArray(result) && Array.isArray(result[0]) ? result[0] : (result || []);
}

async function callOne(fnName, params = []) {
  const rows = await call(fnName, params);
  return rows[0] || null;
}

async function callVoid(fnName, params = []) {
  const placeholders = params.map(() => '?').join(', ');
  const sql = `CALL ${fnName}(${placeholders})`;
  await pool.query(sql, params);
}

// ─── AUTH ──────────────────────────────────────────────────────
const auth = {
  login:          (identifier)           => callOne('sp_login', [identifier]),
  getUserById:    (id)                   => callOne('sp_get_user_by_id', [id]),
  changePassword: (userId, newHash)      => callVoid('sp_change_password', [userId, newHash]),
  updateProfile:  (userId, name, phone)  => callOne('sp_update_user_profile', [userId, name, phone]),
};

// ─── USERS ─────────────────────────────────────────────────────
const users = {
  create:          (role, fullName, email, phone, username, passwordHash, createdBy, validIdPath) =>
    callOne('sp_create_user', [role, fullName, email, phone, username, passwordHash, createdBy || null, validIdPath || null]),
  approve:         (userId, adminId)            => callOne('sp_approve_user', [userId, adminId]),
  reject:          (userId, adminId, reason)    => callOne('sp_reject_user', [userId, adminId, reason || null]),
  toggleStatus:    (userId, adminId)            => callOne('sp_toggle_user_status', [userId, adminId]),
  getAll:          (role)                       => call('sp_get_all_users', [role || null]),
  getPending:      ()                           => call('sp_get_pending_users', []),
  searchCustomers: (query)                      => call('sp_search_customers', [query || null]),
};

// ─── ROOMS ─────────────────────────────────────────────────────
const rooms = {
  getCatalog:       (availableOnly)                      => call('sp_get_room_catalog', [availableOnly || false]),
  getAvailable:     (checkIn, checkOut)                  => call('sp_get_available_rooms', [checkIn, checkOut]),
  upsert:           (id, roomNumber, roomType, capacity, ratePerNight, status, description, imageUrls) =>
    callOne('sp_upsert_room', [id || null, roomNumber, roomType, capacity, ratePerNight, status, description, JSON.stringify(imageUrls || [])]),
};

// ─── SERVICES ──────────────────────────────────────────────────
const services = {
  getAll:  (activeOnly) => call('sp_get_services', [activeOnly || false]),
  upsert:  (id, name, description, price, iconUrl, isActive) =>
    callOne('sp_upsert_service', [id || null, name, description, price || null, iconUrl || null, isActive !== undefined ? isActive : true]),
};

// ─── ACTIVITIES ────────────────────────────────────────────────
const activities = {
  getAll:  (activeOnly) => call('sp_get_activities', [activeOnly || false]),
  upsert:  (id, name, type, pricePerUnit, unit, inventoryCount, description, imageUrl, isActive) =>
    callOne('sp_upsert_activity', [id || null, name, type, pricePerUnit, unit || 'hour', inventoryCount || 1, description, imageUrl, isActive !== undefined ? isActive : true]),
};

// ─── BOOKINGS ──────────────────────────────────────────────────
const bookings = {
  create:        (customerId, roomId, checkIn, checkOut, notes, createdBy) =>
    callOne('sp_create_booking', [customerId, roomId, checkIn, checkOut, notes || null, createdBy || null]),
  updateStatus:  (bookingId, status)  => callOne('sp_update_booking_status', [bookingId, status]),
  getForCustomer:(customerId)         => call('sp_get_customer_bookings', [customerId]),
  getAll:        (status)             => call('sp_get_all_bookings', [status || null]),
};

// ─── ACTIVITY RENTALS ──────────────────────────────────────────
const rentals = {
  create:        (customerId, activityId, startTime, endTime, notes, createdBy) =>
    callOne('sp_create_activity_rental', [customerId, activityId, startTime, endTime, notes || null, createdBy || null]),
  updateStatus:  (rentalId, status)   => callOne('sp_update_rental_status', [rentalId, status]),
  getForCustomer:(customerId)         => call('sp_get_customer_activity_history', [customerId]),
  getAll:        (status)             => call('sp_get_all_rentals', [status || null]),
};

// ─── BILLING ───────────────────────────────────────────────────
const billing = {
  generateBill:   (customerId, bookingId, rentalId, lineItems, staffId) =>
    callOne('sp_generate_bill', [customerId, bookingId || null, rentalId || null, JSON.stringify(lineItems), staffId]),
  getBillsForCustomer: (customerId)  => call('sp_get_bills_for_customer', [customerId]),
  getAllBills:          (status)      => call('sp_get_all_bills', [status || null]),
  getLineItems:        (billId)      => call('sp_get_bill_line_items', [billId]),
};

// ─── PAYMENTS ──────────────────────────────────────────────────
const payments = {
  record:           (billId, amount, method, staffId, notes) =>
    callOne('sp_record_payment', [billId, amount, method, staffId, notes || null]),
  getForBill:       (billId)         => call('sp_get_payments_for_bill', [billId]),
};

// ─── REPORTS ───────────────────────────────────────────────────
const reports = {
  monthly: (year, month) => callOne('sp_get_monthly_report', [year, month]),
  yearly:  (year)        => call('sp_get_yearly_report', [year]),
};

// ─── DASHBOARDS ────────────────────────────────────────────────
const dashboards = {
  staff: () => callOne('sp_get_staff_dashboard', []),
  admin: () => callOne('sp_get_admin_dashboard', []),
};

module.exports = { auth, users, rooms, services, activities, bookings, rentals, billing, payments, reports, dashboards };
