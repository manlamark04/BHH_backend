# Batuan Hammock Hostel (BHH) — Full Stack Application Setup Guide

This project consists of a **Node.js/Express Backend** connected to a **MySQL 8.0+ Database** (via stored procedures) and a **React (Vite) Frontend**.

---

## 📋 Prerequisites

- **Node.js** (v18.x or v20.x recommended)
- **MySQL 8.0+** (or MariaDB 10.5+) / **SQLyog**
- **npm** (v9+ or v10+)

---

## 🗄️ Database Setup (MySQL / SQLyog)

1. Open **SQLyog** (or any MySQL GUI / CLI client) and connect to your local MySQL instance.
2. Open the schema script: [`c:\BHH_backend\BHH_schema_mysql.sql`](file:///c:/BHH_backend/BHH_schema_mysql.sql).
3. Execute the entire script (`F5` in SQLyog).
   - This creates the `bhh` database, all 10 tables, and 38 stored procedures/functions.
4. Ensure the MySQL user credentials match your backend `.env` configuration.

---

## ⚙️ Backend Setup (`BHH_backend`)

### 1. Configure Environment Variables
Verify or edit `c:\BHH_backend\.env`:

```env
DB_HOST=localhost
DB_PORT=3306
DB_NAME=bhh
DB_USER=bhh
DB_PASSWORD=bhh

JWT_SECRET=your_super_secret_jwt_key_change_this
JWT_EXPIRES_IN=7d
PORT=5000
NODE_ENV=development
UPLOADS_DIR=uploads
FRONTEND_URL=http://localhost:5173
```

### 2. Install Dependencies
Open a terminal in `c:\BHH_backend`:

```bash
cd c:\BHH_backend
npm install
```

### 3. Run the Backend Server

- **Development Mode** (with auto-reload):
  ```bash
  npm run dev
  ```
- **Production Mode**:
  ```bash
  npm start
  ```

The server will start running on **`http://localhost:5000`**.

---

## 💻 Frontend Setup (`BHH_frontend`)

### 1. Install Dependencies
Open a terminal in `c:\BHH_frontend`:

```bash
cd c:\BHH_frontend
npm install
```

### 2. Run the Frontend Development Server

```bash
npm run dev
```

The frontend application will start on **`http://localhost:5173`**.

---

## 🚀 Running Both Concurrently

You can run both terminals side-by-side:

| Terminal 1 (Backend) | Terminal 2 (Frontend) |
|---|---|
| `cd c:\BHH_backend` | `cd c:\BHH_frontend` |
| `npm install` | `npm install` |
| `npm run dev` | `npm run dev` |

---

## 🔐 Initial Admin Account

Upon starting the backend for the first time, an initial admin user will automatically be seeded if one does not exist. You can log in via the frontend with:
- **Username / Email**: Admin credentials generated during backend initialization
- **Default Password**: `user123` (You will be prompted to change it upon first login)
