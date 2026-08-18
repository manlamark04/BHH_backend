const db = require('../db/procedures');

/** GET /api/services */
async function getServices(req, res) {
  try {
    const activeOnly = req.query.active === 'true';
    const services = await db.services.getAll(activeOnly);
    res.json(services);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/** POST /api/services — Admin */
async function createService(req, res) {
  try {
    const { name, description, price, icon_url, is_active } = req.body;
    const service = await db.services.upsert(null, name, description, price, icon_url, is_active !== undefined ? is_active : true);
    res.status(201).json(service);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/** PUT /api/services/:id — Admin */
async function updateService(req, res) {
  try {
    const { name, description, price, icon_url, is_active } = req.body;
    const service = await db.services.upsert(parseInt(req.params.id), name, description, price, icon_url, is_active);
    if (!service) return res.status(404).json({ message: 'Service not found.' });
    res.json(service);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

const pool = require('../config/db');

/** GET /api/activities */
async function getActivities(req, res) {
  try {
    const [activities] = await pool.query(
      `SELECT * FROM activities 
       WHERE LOWER(name) LIKE '%pickleball%' 
          OR LOWER(name) LIKE '%court%'
       ORDER BY id ASC`
    );
    res.json(activities);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/** POST /api/activities — Admin */
async function createActivity(req, res) {
  try {
    const { name, activity_type, price_per_unit, unit, inventory_count, description, image_url, is_active } = req.body;
    const activity = await db.activities.upsert(null, name, activity_type, price_per_unit, unit, inventory_count, description, image_url, is_active);
    res.status(201).json(activity);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/** PUT /api/activities/:id — Admin */
async function updateActivity(req, res) {
  try {
    const { name, activity_type, price_per_unit, unit, inventory_count, description, image_url, is_active } = req.body;
    const activity = await db.activities.upsert(parseInt(req.params.id), name, activity_type, price_per_unit, unit, inventory_count, description, image_url, is_active);
    if (!activity) return res.status(404).json({ message: 'Activity not found.' });
    res.json(activity);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

module.exports = { getServices, createService, updateService, getActivities, createActivity, updateActivity };
