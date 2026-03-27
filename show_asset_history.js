require('dotenv').config();
const mysql = require('mysql2');

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

const assetIdArg = process.argv[2];

db.connect(err => {
  if (err) {
    console.error('DB connect error', err);
    process.exit(1);
  }

  const pickAssetAndShow = () => {
    if (assetIdArg) return showHistory(assetIdArg);
    db.query('SELECT id, asset_tag FROM assets ORDER BY id LIMIT 1', (err, rows) => {
      if (err) { console.error('Error selecting asset', err); process.exit(1); }
      if (!rows || rows.length === 0) { console.log('No assets found'); process.exit(0); }
      const id = rows[0].id;
      console.log('Using asset:', rows[0].asset_tag, '(id=' + id + ')');
      showHistory(id);
    });
  };

  const showHistory = (assetId) => {
    const sql = `SELECT ah.action_type, DATE_FORMAT(ah.action_date, '%Y-%m-%d %H:%i:%s') AS action_date, u.name AS user, u.employee_id FROM asset_history ah LEFT JOIN users u ON u.id = ah.user_id WHERE ah.asset_id = ? ORDER BY ah.action_date DESC LIMIT 50`;
    db.query(sql, [assetId], (err, results) => {
      if (err) { console.error('Query error', err); process.exit(1); }
      if (!results || results.length === 0) {
        console.log('No history rows for asset id', assetId);
        process.exit(0);
      }
      console.table(results);
      process.exit(0);
    });
  };

  pickAssetAndShow();
});
