require('dotenv').config();
const mysql = require('mysql2');

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

db.connect(err => {
  if (err) { console.error('DB connect error', err); process.exit(1); }
});

const sql = `
  SELECT
    u.name AS user,
    u.employee_id,
    u.department,
    a.asset_tag,
    a.type,
    DATE_FORMAT(ah.action_date, '%Y-%m-%d') AS return_date,
    ah.user_id
  FROM asset_history ah
  LEFT JOIN users u ON u.id = ah.user_id
  LEFT JOIN assets a ON a.id = ah.asset_id
  WHERE ah.action_type = 'returned'
  ORDER BY ah.action_date DESC
  LIMIT 50
`;

db.query(sql, (err, results) => {
  if (err) { console.error('Query error', err); process.exit(1); }
  console.log('rows:', results.length);
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
});
