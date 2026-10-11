const pool = require('../config/db');

async function cleanWalkinNames() {
  try {
    const [users] = await pool.query(
      "SELECT id, first_name, middle_name, last_name, full_name FROM users WHERE last_name LIKE '%(Walk-in)%' OR full_name LIKE '%(Walk-in)%'"
    );
    console.log(`Found ${users.length} users with '(Walk-in)' in their name.`);

    for (const u of users) {
      const cleanLastName = (u.last_name || '').replace(/\s*\(\s*walk-in\s*\)/gi, '').trim();
      let cleanFullName = (u.full_name || '').replace(/\s*\(\s*walk-in\s*\)/gi, '').trim();

      if (!cleanFullName) {
        cleanFullName = u.middle_name
          ? `${u.first_name} ${u.middle_name} ${cleanLastName}`
          : `${u.first_name} ${cleanLastName}`;
      }

      await pool.query(
        "UPDATE users SET last_name = ?, full_name = ? WHERE id = ?",
        [cleanLastName, cleanFullName, u.id]
      );
      console.log(`Updated user #${u.id}: "${cleanFullName}" (last_name: "${cleanLastName}")`);
    }

    console.log('Successfully cleaned all user names!');
    process.exit(0);
  } catch (err) {
    console.error('Error cleaning walk-in names:', err);
    process.exit(1);
  }
}

cleanWalkinNames();
