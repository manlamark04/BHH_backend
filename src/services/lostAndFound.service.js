const { lostAndFound } = require('../db/procedures');

async function getItems(req, res) {
  try {
    const { status } = req.query;
    const items = await lostAndFound.getAll(status);
    res.json(items);
  } catch (err) {
    console.error('getLostAndFound error:', err);
    res.status(500).json({ message: 'Failed to retrieve lost and found items.' });
  }
}

async function reportItem(req, res) {
  try {
    const { item_name, description, found_location, found_date, image_url } = req.body;
    const staffId = req.user.id;

    const result = await lostAndFound.upsert(
      null, 
      item_name, 
      description, 
      found_location, 
      found_date, 
      image_url, 
      staffId
    );

    res.status(201).json({ success: true, id: result.id, message: 'Lost item reported successfully.' });
  } catch (err) {
    console.error('reportLostItem error:', err);
    res.status(500).json({ message: 'Failed to report lost item.' });
  }
}

async function updateItem(req, res) {
  try {
    const { id } = req.params;
    const { item_name, description, found_location, found_date, image_url } = req.body;
    
    // Using upsert with an ID to update
    const result = await lostAndFound.upsert(
      id, 
      item_name, 
      description, 
      found_location, 
      found_date, 
      image_url, 
      null // loggedBy is not updated
    );

    res.json({ success: true, id: result.id, message: 'Lost item updated successfully.' });
  } catch (err) {
    console.error('updateLostItem error:', err);
    res.status(500).json({ message: 'Failed to update lost item.' });
  }
}

async function updateStatus(req, res) {
  try {
    const { id } = req.params;
    const { status, claimed_by_name } = req.body;

    await lostAndFound.updateStatus(id, status, claimed_by_name);
    res.json({ success: true, message: `Lost item marked as ${status}.` });
  } catch (err) {
    console.error('updateLostItemStatus error:', err);
    res.status(500).json({ message: 'Failed to update lost item status.' });
  }
}

module.exports = {
  getItems,
  reportItem,
  updateItem,
  updateStatus
};
