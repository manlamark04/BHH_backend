# Batuan Hammock Hostel — Walk-In Motel Management System
### System Design & Build Instructions
**Version:** 1.0 &nbsp;|&nbsp; **Prepared as:** Full System Specification for Development &nbsp;|&nbsp; **Author role:** Senior Full-Stack Engineer & Product Designer

---

## 1. Executive Summary

Batuan Hammock Hostel needs a walk-in motel management platform that serves three distinct users — **Customer**, **Staff**, and **Admin** — under one unified system. The core business realities driving this design:

- Guests can **walk in** (profiled by staff) or **self-register** online — either path lands the account in a **pending** state until an Admin approves it.
- Every account gets a **unique alphanumeric ID** visible on the profile and in Admin's user management.
- New accounts start with a **default password** (`user123`) that must be changed on first meaningful use, enforced by a **strong password validator**.
- The **billing-before-payment** rule is a hard business constraint: Staff must generate a bill for a room/activity before any payment can be recorded against it.
- A public-facing **Landing Page** advertises rooms, services, and activities (e.g., Pickleball, Motorcycle Rental) to convert walk-ins and online visitors alike.

This document is written so a development team can pick it up and build the system end-to-end: information architecture, workflows, data model, screen-by-screen UX, validation rules, and design language.

---

## 2. Actors & Role Matrix

| Capability | Customer | Staff | Admin |
|---|:---:|:---:|:---:|
| Self-register (goes to Pending) | ✅ | — | — |
| Create/profile a walk-in customer (goes to Pending) | — | ✅ | — |
| Create Staff accounts | — | — | ✅ |
| Approve/reject pending accounts | — | — | ✅ |
| Enable/disable any account | — | — | ✅ |
| Browse rooms, services, activities | ✅ | ✅ | ✅ |
| Book a room | ✅ | on behalf of walk-in | — |
| Rent an activity (Pickleball, Motorcycle) | ✅ | on behalf of walk-in | — |
| View own bookings / history / activity rentals | ✅ | — | — |
| Accept/confirm bookings | — | ✅ | ✅ (override) |
| Generate a **bill** for room/activity | — | ✅ | ✅ (override) |
| Record a **payment** against a bill | — | ✅ | ✅ (override) |
| View monthly/yearly reports | — | — | ✅ |
| User management dashboard | — | limited (customer profiles only) | ✅ (full) |
| Change own password | ✅ | ✅ | ✅ |

---

## 3. Core Business Rules

1. **Pending-by-default account creation.** Regardless of who creates a customer account (self-service or staff walk-in profiling), the account status is `PENDING` until an Admin explicitly approves it. A pending account **cannot log in** to book or transact — it can only be told "your account is awaiting approval."
2. **Only Admin approves.** Staff can create/edit customer profiles, but the approval action (`PENDING → ACTIVE`) is Admin-exclusive.
3. **Default password issuance.** Any account created (by self-registration or by Staff) is auto-assigned the default password `user123` (hashed, never stored in plain text). The system flags the account with `must_change_password = true`.
4. **Forced password change flow.** On first login, or the first time the user opens **Profile → Security**, they're prompted to set a new password that passes the Strong Password Validator (see §7). `must_change_password` flips to `false` once satisfied.
5. **Billing precedes payment.** A `Booking` or `ActivityRental` must first be converted into a `Bill` by Staff. Only after a `Bill` exists can a `Payment` be recorded against it. The system must **block** payment creation if no matching unpaid bill exists.
6. **Unique Alphanumeric ID.** Every account (Customer, Staff, Admin) receives an immutable system-generated ID at creation, e.g. `BHH-CU-7X2K9A` (Customer), `BHH-ST-3M8P1Q` (Staff), `BHH-AD-9K2L4R` (Admin). Displayed on the Profile page and in Admin's User Management table.
7. **Enable/Disable, not delete.** Admin disables (soft-locks) accounts instead of deleting them, preserving transaction history and audit trails.
8. **Room availability is real-time.** A room shown as "Available" on the Customer dashboard must reflect live booking status (no double-booking).

---

## 4. Account Lifecycle (State Machine)

```
                 ┌───────────────┐
   self-register │               │  staff creates walk-in profile
  ───────────────►   PENDING     ◄─────────────────────────────
                 │               │
                 └───────┬───────┘
                         │ Admin approves
                         ▼
                 ┌───────────────┐   Admin disables   ┌───────────────┐
                 │    ACTIVE     ├───────────────────►│   DISABLED    │
                 │ (can log in)  │◄───────────────────┤ (locked out)  │
                 └───────────────┘   Admin re-enables └───────────────┘
                         │
                         │ Admin rejects (from PENDING)
                         ▼
                 ┌───────────────┐
                 │   REJECTED    │
                 └───────────────┘
```

- `PENDING`: account exists in DB, login is blocked with a friendly "Your account is under review" message.
- `ACTIVE`: full access per role.
- `DISABLED`: login blocked with "Your account has been disabled. Contact the front desk." message; history remains visible to Admin/Staff.
- `REJECTED`: optional terminal state if Admin declines a pending request (with a reason field).

---

## 5. Information Architecture

### 5.1 Public (unauthenticated) — Landing Page
```
/                       → Landing Page
/rooms                  → Room catalog (public preview)
/services               → Motel services (laundry, breakfast, Wi-Fi, etc.)
/activities              → Pickleball, Motorcycle Rental, etc.
/login                   → Login
/register                → Customer self-registration
/about, /contact         → Supporting pages
```

### 5.2 Customer (authenticated)
```
/customer/dashboard          → Available rooms, services, activities overview
/customer/rooms              → Browse & filter rooms → Book
/customer/activities         → Browse & rent activities
/customer/bookings           → My current & upcoming bookings
/customer/history            → Transaction history (payments, invoices)
/customer/activities/history → Activity rental history
/customer/profile            → Profile info, unique ID, change password
```

### 5.3 Staff (authenticated)
```
/staff/dashboard          → Today's arrivals, pending bills, room status board
/staff/customers           → Create/search/edit walk-in customer profiles
/staff/bookings             → Booking queue → Accept / Assign room
/staff/billing               → Generate bills for bookings & activity rentals
/staff/payments               → Record payments against existing bills
/staff/activities              → Manage activity rentals (Pickleball court schedule, Motorcycle fleet)
/staff/profile                  → Own profile, change password
```

### 5.4 Admin (authenticated)
```
/admin/dashboard             → KPI overview (occupancy, revenue snapshot)
/admin/users                  → User management (all roles), enable/disable
/admin/approvals               → Pending account queue → Approve/Reject
/admin/staff/create              → Create staff accounts
/admin/reports/monthly            → Monthly reports
/admin/reports/yearly              → Yearly reports
/admin/rooms                        → Manage room inventory & pricing
/admin/services                      → Manage services catalog
/admin/activities                     → Manage activities catalog & pricing
/admin/profile                         → Own profile, change password
```

---

## 6. Unique ID Generation Scheme

**Format:** `BHH-{ROLE}-{6-char Base36 random, uppercase}`

| Role | Prefix | Example |
|---|---|---|
| Customer | `CU` | `BHH-CU-7X2K9A` |
| Staff | `ST` | `BHH-ST-3M8P1Q` |
| Admin | `AD` | `BHH-AD-9K2L4R` |

**Rules:**
- Generated server-side at record creation; never client-supplied.
- Checked against the `users` table for collision (retry on collision — probability is negligible at 36^6 ≈ 2.1B combinations per role).
- Immutable once assigned; displayed read-only on Profile and Admin's User Management grid.
- Also used as the human-friendly booking/bill reference prefix, e.g. bill numbers can chain off the customer ID for traceability: `BHH-CU-7X2K9A-B0007`.

**Reference implementation (pseudo-code):**
```js
function generateUserId(role) {
  const prefixMap = { customer: 'CU', staff: 'ST', admin: 'AD' };
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1 ambiguity
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `BHH-${prefixMap[role]}-${suffix}`;
}
// Wrap in a uniqueness-check loop against the DB before persisting.
```

---

## 7. Password Policy

### 7.1 Default password on account creation
- Value: `user123`
- Stored as a **bcrypt/argon2 hash** — never plaintext, even as a "default."
- Account flagged `must_change_password = true`.
- Login succeeds with the default password, but the app **redirects to Profile → Security** before allowing any other action, until the password is changed.

### 7.2 Strong Password Validator (enforced on change)
A new password is accepted only if it passes **all** of the following:

| Rule | Requirement |
|---|---|
| Minimum length | 8 characters or more |
| Uppercase | At least 1 uppercase letter (A–Z) |
| Number | At least 1 digit (0–9) |
| Unique characters | No 3+ repeated identical characters in a row (e.g. `aaa1234A` is rejected); encourages varied character use |
| Cannot equal | Cannot be the same as the default password or the current password |

**Regex reference (baseline — combine with a repeat-character check in code):**
```
^(?=.*[A-Z])(?=.*\d).{8,}$
```
Additional JS check for "no 3 identical chars in a row":
```js
function hasNoTripleRepeat(pw) {
  return !/(.)\1{2,}/.test(pw);
}
```

**UI behavior:** live checklist under the "New Password" field with ✅/❌ indicators per rule (length, uppercase, number, no repeats), submit button disabled until all pass. This is a standard, well-tested UX pattern for password strength feedback (used by GitHub, Google, etc.) that reduces failed submissions.

---

## 8. Core Workflows

### 8.1 Customer Self-Registration
1. Visitor clicks **Register** on Landing Page.
2. Fills: Full Name, Email, Phone, Valid ID (optional upload), desired username.
3. System creates account → status `PENDING`, default password `user123`, unique ID generated.
4. Confirmation screen: "Your account is pending admin approval. You'll be notified once approved."
5. Admin sees it in `/admin/approvals` → Approve or Reject.
6. On approval: account → `ACTIVE`; (optional) email/SMS notification.

### 8.2 Staff Walk-In Profiling
1. Guest walks in without an account.
2. Staff opens `/staff/customers/new`, enters guest details (name, contact, valid ID).
3. System creates the account exactly as in 8.1 (status `PENDING`, default password, unique ID) — **same approval gate applies**, even for walk-ins, per the business rule.
4. Staff can still proceed to **book a room** for the guest immediately (an operational allowance) while approval is in progress — but the *guest's own login access* remains blocked until Admin approves. This lets the front desk keep operating without waiting on system approval bureaucracy, while account access control stays centralized with Admin.
   > **Design note:** Confirm with stakeholders whether "book now, approve later" is desired, or whether Staff should be blocked from booking too. Documented here as the recommended default so operations aren't bottlenecked by approval timing.

### 8.3 Room Booking (Customer-initiated)
1. Customer logs in → `/customer/rooms` → sees real-time room availability (filter by date, room type, capacity).
2. Selects room → chooses check-in/check-out → **Request Booking**.
3. Booking is created with status `REQUESTED`.
4. Staff reviews in `/staff/bookings` → **Accept** (status → `CONFIRMED`) or **Decline** (with reason).
5. Customer sees status update in `/customer/bookings`.

### 8.4 Activity Rental (Pickleball / Motorcycle)
1. Customer (or Staff on their behalf) browses `/customer/activities` or `/staff/activities`.
2. Selects activity, time slot (Pickleball court schedule) or rental duration (Motorcycle).
3. System checks resource availability (court slot not double-booked; motorcycle unit not already rented).
4. Rental created with status `REQUESTED` → Staff confirms → `CONFIRMED`.

### 8.5 Billing → Payment (the critical two-step)
```
 Booking/Rental CONFIRMED
          │
          ▼
 Staff → /staff/billing → "Generate Bill"
          │  (line items: room rate × nights, activity fees, add-ons, taxes)
          ▼
     Bill created (status: UNPAID)
          │
          ▼
 Staff → /staff/payments → select the UNPAID bill → record payment
          │  (cash / card / e-wallet, partial or full)
          ▼
   Payment recorded → Bill status: PARTIALLY_PAID or PAID
          │
          ▼
   Reflected in Customer's /customer/history
```
**System guardrail:** the Payment form only lists bills with status `UNPAID` or `PARTIALLY_PAID`. There is no path to create a payment without first selecting an existing bill — enforced at both UI and API level (reject any payment request lacking a valid `bill_id`).

### 8.6 Admin Approval Queue
1. `/admin/approvals` lists all `PENDING` accounts (customer & staff-created) with: name, unique ID, source (self-registered vs. staff-created), date requested.
2. Admin reviews details → **Approve** or **Reject** (reject requires a short reason, stored for audit).
3. Approved accounts get notified (email/SMS/in-app) and unlock login.

### 8.7 Reports (Admin)
- **Monthly Report:** occupancy rate, total bookings, total activity rentals, revenue breakdown (rooms vs. activities vs. services), top-performing room type, cancellations.
- **Yearly Report:** same metrics aggregated by month with trend charts, year-over-year comparison if prior-year data exists.
- Exportable as PDF/CSV.
- Filters: date range, room type, staff-processed transactions.

---

## 9. Data Model (Entity-Relationship Overview)

```
users
 ├─ id (PK)
 ├─ unique_id (e.g. BHH-CU-7X2K9A)          [unique, indexed]
 ├─ role (ENUM: customer, staff, admin)
 ├─ full_name
 ├─ email
 ├─ phone
 ├─ password_hash
 ├─ must_change_password (bool)
 ├─ status (ENUM: pending, active, disabled, rejected)
 ├─ created_by (FK → users.id, nullable — set if staff-created)
 ├─ created_at, updated_at

rooms
 ├─ id (PK), room_number, room_type, capacity, rate_per_night, status (available/occupied/maintenance), description, image_urls[]

services
 ├─ id (PK), name, description, price (nullable if free), icon/image

activities
 ├─ id (PK), name (Pickleball, Motorcycle Rental...), type, price_per_unit, unit (hour/day), inventory_count

bookings
 ├─ id (PK), customer_id (FK), room_id (FK), check_in, check_out, status (requested/confirmed/checked_in/checked_out/cancelled), created_by (FK → users.id)

activity_rentals
 ├─ id (PK), customer_id (FK), activity_id (FK), start_time, end_time/duration, status, created_by (FK)

bills
 ├─ id (PK), bill_number, customer_id (FK), booking_id (FK, nullable), activity_rental_id (FK, nullable), line_items (JSON), total_amount, status (unpaid/partially_paid/paid), issued_by (FK → staff), issued_at

payments
 ├─ id (PK), bill_id (FK, NOT NULL), amount, method (cash/card/ewallet), received_by (FK → staff), paid_at

approval_logs
 ├─ id (PK), user_id (FK), action (approved/rejected), acted_by (FK → admin), reason, acted_at
```

---

## 10. Landing Page Requirements

The public landing page is the storefront — it must sell the stay before the guest even logs in.

**Sections (top to bottom):**
1. **Hero banner** — hostel name, tagline, striking hero photo of the hammock-themed property, primary CTA "Book Now" / "Check Availability."
2. **Room Showcase** — card grid pulling live data from `rooms` (photo, type, capacity, starting rate, "See availability" CTA).
3. **Services Strip** — icon-based row: Free Wi-Fi, Breakfast, Laundry, 24/7 Front Desk, Parking, etc.
4. **Activities Spotlight** — Pickleball Court and Motorcycle Rental featured with photos, pricing teaser, and "Reserve an Activity" CTA.
5. **Why Batuan Hammock** — short trust section (location highlights, guest ratings if available).
6. **Call to Action band** — "Create your account" / "Already a guest? Log in."
7. **Footer** — contact info, map/location, social links.

**Design direction:** tropical-modern aesthetic reflecting "hammock" branding — warm neutral palette (sand, driftwood brown, deep teal/ocean accent), generous whitespace, rounded card corners, soft shadows, large legible typography, and photography-forward layout. Mobile-first responsive grid since walk-in guests will often browse on phones.

---

## 11. Design System (Slick, Professional UI)

### 11.1 Visual Language
- **Palette:** Sand `#F4EDE4`, Driftwood Brown `#8B6F53`, Deep Teal `#1F6F6B`, Sunset Coral (accent) `#FF6B57`, Charcoal text `#2B2B2B`.
- **Typography:** A humanist sans for UI (e.g., Inter / Poppins) — headings semi-bold, body regular, generous line-height for readability on tablets used at the front desk.
- **Components:** rounded-xl cards, soft elevation shadows, pill-shaped status badges (color-coded: Pending = amber, Active = teal, Disabled = grey, Confirmed = green, Unpaid = coral).
- **Iconography:** consistent line-icon set (rooms, activities, payments, users) for instant scannability on dashboards.

### 11.2 Role-based Dashboard Tone
- **Customer:** warm, visual, photo-driven (they're "shopping" for a stay/activity).
- **Staff:** dense, task-oriented, table/queue-driven (they're processing transactions quickly at a counter).
- **Admin:** analytical, chart-forward, with clear data tables for user & financial oversight.

### 11.3 Key UI Patterns
- **Status badges everywhere** (account status, booking status, bill status) for at-a-glance clarity.
- **Two-step billing UI**: a visibly separate "Bill" tab and "Payment" tab in Staff's view, with the Payment tab disabled/greyed for any transaction lacking a bill yet — reinforcing the business rule visually.
- **Password strength meter** with live checklist (see §7.2).
- **Unique ID chip** shown prominently on every Profile page and as a column in Admin's User Management table, copyable with one click.

---

## 12. Suggested Technology Stack

| Layer | Recommendation | Why |
|---|---|---|
| Frontend | React (or Next.js) + Tailwind CSS | Fast to build a polished, responsive UI; component reuse across 3 role-based dashboards |
| Backend | Node.js (Express/NestJS) or Laravel (PHP) | Clean REST/GraphQL API layer, strong auth middleware support |
| Database | PostgreSQL | Relational integrity for bookings/bills/payments; strong constraint support |
| Auth | JWT sessions + bcrypt/argon2 password hashing | Stateless, scalable, secure |
| File storage | S3-compatible bucket | Room/activity images, valid ID uploads |
| Notifications | Email (SES/SendGrid) + optional SMS (Twilio/Semaphore for PH numbers) | Approval/booking notifications |
| Hosting | Vercel/Netlify (frontend) + Render/Railway/AWS (backend+DB) | Fast to ship, scales with the business |

*(This is a recommendation, not a hard requirement — swap for the stack your dev team is strongest in; the workflows and data model above are stack-agnostic.)*

---

## 13. Validation & Edge Cases Checklist

- [ ] Prevent double-booking: two bookings cannot overlap on the same room/date range.
- [ ] Prevent double-renting: activity resource (e.g., a specific motorcycle unit, a pickleball court slot) can't be double-booked in the same time window.
- [ ] Reject payment creation with no matching `bill_id`.
- [ ] Reject payment amount that exceeds the remaining balance on a bill (unless overpayment/change-due handling is explicitly designed).
- [ ] Block login for `PENDING`, `DISABLED`, `REJECTED` accounts with clear, distinct messaging per state.
- [ ] Enforce `must_change_password` redirect until the new password passes validation.
- [ ] Ensure unique ID collision-retry logic on account creation.
- [ ] Admin cannot disable their own only remaining Admin account (avoid total lockout).
- [ ] Staff cannot approve/reject accounts (UI + API-level permission check, not just UI hiding).
- [ ] Audit log every approval/rejection and every enable/disable action with actor + timestamp.

---

## 14. Build Roadmap (Suggested Phasing)

1. **Phase 1 — Foundations:** Auth system, roles/permissions, unique ID generation, password policy, account lifecycle states.
2. **Phase 2 — Catalog & Landing Page:** Rooms, Services, Activities CRUD (Admin) + public Landing Page.
3. **Phase 3 — Customer Booking Flow:** Room browsing, booking requests, activity rentals, customer dashboard (bookings/history).
4. **Phase 4 — Staff Operations:** Walk-in profiling, booking acceptance, billing module, payment module (with the bill-first guardrail).
5. **Phase 5 — Admin Oversight:** User management, approvals queue, enable/disable, monthly/yearly reports with export.
6. **Phase 6 — Polish:** Notifications, design system pass, mobile responsiveness audit, QA against the Edge Cases Checklist (§13).

---

## 15. Summary

This spec gives Batuan Hammock Hostel a single coherent system where:
- **Every account** — however it originates — passes through the same `PENDING → Admin-approved → ACTIVE` gate, with a traceable **unique alphanumeric ID**.
- **Security is enforced, not optional** — default passwords are hashed and forcibly retired via a real strength validator.
- **Money only moves in the right order** — bill first, payment second, with the system itself refusing to allow otherwise.
- **The front door (Landing Page)** does real marketing work, showcasing rooms, services, and activities to both walk-ins and online visitors.

Hand this document to your dev/design team as the single source of truth for scope, flows, and visual direction.
