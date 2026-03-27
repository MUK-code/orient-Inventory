require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');

const app = express();

// ================= SESSION =================
app.use(session({
secret: 'inventory-secret',
resave: false,
saveUninitialized: false
}));

// ================= DATABASE =================
const db = mysql.createConnection({
host: process.env.DB_HOST,
port: process.env.DB_PORT,
user: process.env.DB_USER,
password: process.env.DB_PASSWORD,
database: process.env.DB_NAME
});

db.connect(err => {
if (err) console.error(err);
else console.log("Connected to MySQL");
});

// Promise-based DB helper for async/await usage
const dbp = db.promise();

// prevent unexpected 'error' events from crashing the process
db.on('error', (err) => {
  console.error('MySQL connection error event:', err);
});

// ================= CONFIG =================
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// Mount reports API routes (uses the DB connection)
app.use('/api/reports', require('./routes/reports')(db));

// ================= AUTH =================
function isAuthenticated(req, res, next) {
if (req.session.user) return next();
res.redirect('/login');
}

// ================= LOGIN =================
app.get('/login', (req, res) => {
res.render('login', { error: null });
});

app.post('/login', (req, res) => {
const { username, password } = req.body;

db.query(
"SELECT * FROM admin_users WHERE username=?",
[username],
async (err, result) => {

  if (err) return res.send("DB Error");

  if (result.length === 0) {
    return res.render('login', { error: "User not found" });
  }

  const user = result[0];
  const match = await bcrypt.compare(password, user.password);

  if (match) {
    req.session.user = user;
    res.redirect('/');
  } else {
    return res.render('login', { error: "Wrong password" });
  }
}

);
});

// ================= LOGOUT =================
app.get('/logout', (req, res) => {
req.session.destroy(() => res.redirect('/login'));
});

// ================= DASHBOARD =================
app.get('/', isAuthenticated, (req, res) => {
db.query("SELECT COUNT(*) AS total FROM assets", (err, result) => {
if (err) return res.send("DB Error");
res.render('dashboard', { total: result[0].total });
});
});

// (Quick Return UI removed) - no public quick-return route

// ================= ADD ASSET =================
app.get('/add-asset', isAuthenticated, (req, res) => {
res.render('add-asset', { error: null, formData: {} });
});

app.post('/add-asset', isAuthenticated, (req, res) => {

const {
type, brand, model, serial_number, vendor,
processor, ram_gb, storage_type, storage_gb, gpu
} = req.body;

if ((type === 'Laptop' || type === 'Desktop' || type === 'Monitor') && !serial_number) {
return res.render('add-asset', {
error: "❌ Serial number required",
formData: req.body
});
}

const sql = "INSERT INTO assets (asset_tag, type, brand, model, serial_number, vendor, processor, ram_gb, storage_type, storage_gb, gpu, status) VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'In Stock')";

db.query(sql, [
type, brand, model,
serial_number || null,
vendor,
processor || null,
ram_gb || null,
storage_type || null,
storage_gb || null,
gpu || null
], (err) => {

if (err) {
  if (err.code === 'ER_DUP_ENTRY') {
    return res.render('add-asset', {
      error: "❌ Serial already exists",
      formData: req.body
    });
  }
  return res.send("Insert Error");
}

res.redirect('/assets');

});
});

// ================= VIEW ASSETS =================
app.get('/assets', isAuthenticated, (req, res) => {
const search = req.query.search || '';
const searchValue = `%${search}%`;

db.query(
  "SELECT * FROM assets WHERE type LIKE ? OR brand LIKE ? OR model LIKE ? OR serial_number LIKE ?",
  [searchValue, searchValue, searchValue, searchValue],
  (err, assets) => {
if (err) return res.send("DB Error");
res.render('assets', { assets, search });
}
);
});

// ================= ALLOCATE (form) =================
app.get('/allocate', isAuthenticated, (req, res) => {

const type = req.query.type || 'All';
let sql = "SELECT * FROM assets WHERE status='In Stock'";
let params = [];

if (type !== 'All') {
  sql += " AND type=?";
  params.push(type);
}

db.query(sql, params, (err, assets) => {
  if (err) return res.send("DB Error");
  res.render('allocate', { assets, selectedType: type });
});
});

app.post('/allocate', isAuthenticated, async (req, res) => {
  try {
    // support both `asset_ids` and `asset_ids[]` form names and normalize
    let rawAssetIds = req.body.asset_ids;
    if (!rawAssetIds) rawAssetIds = req.body['asset_ids[]'];
    const { user_name, employee_id, department, designation } = req.body;
    if (!rawAssetIds) rawAssetIds = [];
    if (!Array.isArray(rawAssetIds)) rawAssetIds = [rawAssetIds];
    console.log('POST /allocate body:', req.body);

    // normalize values and remove empties
    let assetsArray = rawAssetIds
      .map(a => (typeof a === 'string' ? a.trim() : a))
      .filter(a => a !== undefined && a !== null && a !== '' && a !== 'undefined');

    // keep only integer ids (positive)
    assetsArray = assetsArray.filter(a => /^\\d+$/.test(String(a)));
    console.log('Normalized asset_ids array:', assetsArray);

    const [userRows] = await dbp.query("SELECT id FROM users WHERE employee_id=?", [employee_id]);

    if (!assetsArray || assetsArray.length === 0) {
      console.warn('Allocate aborted: no assets selected', { rawAssetIds, assetsArray });
      return res.status(400).send('No assets selected');
    }

    const proceed = async (userId) => {
      const [allocationResult] = await dbp.query("INSERT INTO allocations (user_id, allocation_date) VALUES (?, CURDATE())", [userId]);
      const allocationId = allocationResult.insertId;

      const promises = assetsArray.map(async (assetId) => {
        const id = Number(assetId);
        if (!Number.isInteger(id) || id <= 0) {
          console.warn('Skipping invalid assetId during allocation:', assetId);
          return;
        }
        try {
          console.log('Allocating asset for allocationId=', allocationId, 'assetId=', id);
          // insert ignoring duplicates (requires unique constraint on allocation_id, asset_id)
          await dbp.query('INSERT IGNORE INTO allocation_items (allocation_id, asset_id) VALUES (?, ?)', [allocationId, id]);
          await dbp.query("UPDATE assets SET status='Allocated' WHERE id=?", [id]);
          await dbp.query("INSERT INTO asset_history (asset_id, user_id, action_type) VALUES (?, ?, 'allocated')", [id, userId]);
        } catch (e) {
          console.error('Error allocating asset', id, e && e.message);
        }
      });

      await Promise.all(promises);
      return res.redirect('/allocations');
    };

    if (userRows.length > 0) {
      await dbp.query("UPDATE users SET name=?, department=?, designation=? WHERE id=?", [user_name, department, designation, userRows[0].id]);
      await proceed(userRows[0].id);
    } else {
      const [newUserResult] = await dbp.query("INSERT INTO users (name, employee_id, department, designation) VALUES (?, ?, ?, ?)", [user_name, employee_id, department, designation]);
      await proceed(newUserResult.insertId);
    }
  } catch (e) {
    console.error('Allocate error', e);
    res.status(500).send('Allocation Error');
  }
});

// ================= RETURN =================
app.post('/return-asset', isAuthenticated, (req, res) => {

const { allocation_item_id, asset_id } = req.body;

db.query("SELECT allocations.user_id, allocation_items.allocation_id FROM allocation_items JOIN allocations ON allocations.id = allocation_items.allocation_id WHERE allocation_items.id=?", [allocation_item_id], (err, result) => {

if (err || result.length === 0) return res.send("Error fetching user");

const userId = result[0].user_id;
const allocationId = result[0].allocation_id;

db.query("UPDATE assets SET status='In Stock' WHERE id=?", [asset_id], (err) => {
  if (err) return res.send("Return Error");

  // insert a returns record linked to the allocation
  db.query("INSERT INTO returns (allocation_id, return_date) VALUES (?, CURDATE())", [allocationId], (err) => {
    if (err) {
      // log but continue with deleting allocation item and history
      console.error('Failed to insert into returns', err);
    }

    db.query("DELETE FROM allocation_items WHERE id=?", [allocation_item_id], () => {

      db.query(`
        INSERT INTO asset_history (asset_id, user_id, action_type)
        VALUES (?, ?, 'returned')
      `, [asset_id, userId]);

      res.redirect('/employee-assets');
    });
  });
});

});
});

// ================= EMPLOYEE ASSETS =================
app.get('/employee-assets', isAuthenticated, (req, res) => {

const search = req.query.search || '';
if (!search) return res.render('employee-assets', { results: [], search });

const searchValue = `%${search}%`;

const sql = `SELECT allocation_items.id AS allocation_item_id, users.name, users.employee_id, users.department, users.designation, assets.id AS asset_id, assets.type, assets.brand, assets.model, assets.serial_number, DATE_FORMAT(allocations.allocation_date, '%Y-%m-%d') AS allocation_date FROM users JOIN allocations ON allocations.user_id = users.id JOIN allocation_items ON allocation_items.allocation_id = allocations.id JOIN assets ON assets.id = allocation_items.asset_id WHERE assets.status = 'Allocated' AND (users.name LIKE ? OR users.employee_id LIKE ?)`;

db.query(sql, [searchValue, searchValue], (err, results) => {
if (err) return res.send("DB Error");
res.render('employee-assets', { results, search });
});
});

// ================= HISTORY =================
app.get('/asset-history/:id', isAuthenticated, (req, res) => {

  const assetId = req.params.id;

  db.query("SELECT ah.action_type, DATE_FORMAT(ah.action_date, '%Y-%m-%d') AS action_date, u.name, u.employee_id FROM asset_history ah LEFT JOIN users u ON u.id = ah.user_id WHERE ah.asset_id = ? ORDER BY ah.action_date DESC", [assetId], (err, results) => {

    if (err) return res.send("DB Error");
    res.render('asset-history', { history: results });

  });
});

// ================= MODEL SUMMARY =================
app.get('/model-summary', isAuthenticated, (req, res) => {

db.query("SELECT type, brand, model, COUNT(*) AS total, SUM(CASE WHEN status='In Stock' THEN 1 ELSE 0 END) AS in_stock, SUM(CASE WHEN status='Allocated' THEN 1 ELSE 0 END) AS allocated FROM assets GROUP BY type, brand, model ORDER BY type", (err, results) => {

  if (err) return res.send("DB Error");
  res.render('model-summary', { summary: results });

});
});

// ================= ALLOCATIONS PAGE =================
app.get('/allocations', isAuthenticated, (req, res) => {
  db.query(`
    SELECT
      users.name,
      users.employee_id,
      users.department,
      users.designation,
      assets.type,
      assets.brand,
      assets.model,
      assets.serial_number,
      DATE_FORMAT(allocations.allocation_date, '%Y-%m-%d') AS allocation_date
    FROM allocation_items
    JOIN allocations ON allocations.id = allocation_items.allocation_id
    JOIN users ON users.id = allocations.user_id
    JOIN assets ON assets.id = allocation_items.asset_id
    WHERE assets.status = 'Allocated'
    ORDER BY allocations.id DESC
  `, (err, results) => {
    if (err) return res.send('DB Error');
    res.render('allocations', { allocations: results });
  });
});

// ================= START =================
app.listen(3000, () => {
console.log("Server running on http://localhost:3000");
});