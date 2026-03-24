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

// ================= CONFIG =================
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ================= AUTH MIDDLEWARE =================
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

  db.query("SELECT * FROM admin_users WHERE username=?", [username], async (err, result) => {

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
  });
});

// ================= LOGOUT =================
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// ================= DASHBOARD =================
app.get('/', isAuthenticated, (req, res) => {
  db.query("SELECT COUNT(*) AS total FROM assets", (err, result) => {
    if (err) return res.send("DB Error");
    res.render('dashboard', { total: result[0].total });
  });
});

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

  const sql = `
    INSERT INTO assets 
    (asset_tag, type, brand, model, serial_number, vendor,
     processor, ram_gb, storage_type, storage_gb, gpu, status)
    VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'In Stock')
  `;

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
    `SELECT * FROM assets 
     WHERE type LIKE ? OR brand LIKE ? OR model LIKE ? OR serial_number LIKE ?`,
    [searchValue, searchValue, searchValue, searchValue],
    (err, assets) => {
      if (err) return res.send("DB Error");
      res.render('assets', { assets, search });
    }
  );
});

// ================= ALLOCATE =================
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

app.post('/allocate', isAuthenticated, (req, res) => {

  const { asset_ids, user_name, employee_id, department, designation } = req.body;
  const assetsArray = Array.isArray(asset_ids) ? asset_ids : [asset_ids];

  db.query("SELECT id FROM users WHERE employee_id=?", [employee_id], (err, userResult) => {

    if (err) return res.send("DB Error");

    const proceed = (userId) => {

      db.query(
        "INSERT INTO allocations (user_id, allocation_date) VALUES (?, CURDATE())",
        [userId],
        (err, allocationResult) => {

          if (err) return res.send("Allocation Error");

          const allocationId = allocationResult.insertId;

          assetsArray.forEach(assetId => {
            db.query("INSERT INTO allocation_items (allocation_id, asset_id) VALUES (?, ?)", [allocationId, assetId]);
            db.query("UPDATE assets SET status='Allocated' WHERE id=?", [assetId]);
          });

          res.redirect('/allocations');
        }
      );
    };

    if (userResult.length > 0) {
      db.query(
        "UPDATE users SET name=?, department=?, designation=? WHERE id=?",
        [user_name, department, designation, userResult[0].id],
        () => proceed(userResult[0].id)
      );
    } else {
      db.query(
        "INSERT INTO users (name, employee_id, department, designation) VALUES (?, ?, ?, ?)",
        [user_name, employee_id, department, designation],
        (err, newUser) => {
          if (err) return res.send("User Insert Error");
          proceed(newUser.insertId);
        }
      );
    }
  });
});

// ================= ALLOCATIONS =================
app.get('/allocations', isAuthenticated, (req, res) => {

  const sql = `
    SELECT allocations.id,
           users.name,
           users.employee_id,
           users.department,
           users.designation,
           assets.type,
           assets.brand,
           assets.model,
           assets.serial_number,
           allocations.allocation_date
    FROM allocations
    JOIN users ON allocations.user_id = users.id
    JOIN allocation_items ON allocation_items.allocation_id = allocations.id
    JOIN assets ON allocation_items.asset_id = assets.id
    ORDER BY allocations.id DESC
  `;

  db.query(sql, (err, results) => {
    if (err) return res.send("DB Error");
    res.render('allocations', { allocations: results });
  });
});

// ================= EMPLOYEE ASSETS =================
app.get('/employee-assets', isAuthenticated, (req, res) => {

  const search = req.query.search || '';
  if (!search) return res.render('employee-assets', { results: [], search });

  const searchValue = `%${search}%`;

  const sql = `
    SELECT allocation_items.id AS allocation_item_id,
           users.name,
           users.employee_id,
           users.department,
           users.designation,
           assets.id AS asset_id,
           assets.type,
           assets.brand,
           assets.model,
           assets.serial_number,
           allocations.allocation_date
    FROM users
    JOIN allocations ON allocations.user_id = users.id
    JOIN allocation_items ON allocation_items.allocation_id = allocations.id
    JOIN assets ON assets.id = allocation_items.asset_id
    WHERE assets.status = 'Allocated'
      AND (users.name LIKE ? OR users.employee_id LIKE ?)
  `;

  db.query(sql, [searchValue, searchValue], (err, results) => {
    if (err) return res.send("DB Error");
    res.render('employee-assets', { results, search });
  });
});

// ================= RETURN ASSET =================
app.post('/return-asset', isAuthenticated, (req, res) => {

  const { allocation_item_id, asset_id } = req.body;

  db.query("UPDATE assets SET status='In Stock' WHERE id=?", [asset_id], (err) => {
    if (err) return res.send("Return Error");

    db.query("DELETE FROM allocation_items WHERE id=?", [allocation_item_id], () => {
      res.redirect('/employee-assets');
    });
  });
});

// ================= ASSET HISTORY =================
app.get('/asset-history/:id', isAuthenticated, (req, res) => {

  const assetId = req.params.id;

  const sql = `
    SELECT users.name,
           users.employee_id,
           allocations.allocation_date
    FROM allocation_items
    JOIN allocations ON allocations.id = allocation_items.allocation_id
    JOIN users ON users.id = allocations.user_id
    WHERE allocation_items.asset_id = ?
    ORDER BY allocations.allocation_date DESC
  `;

  db.query(sql, [assetId], (err, results) => {
    if (err) return res.send("DB Error");
    res.render('asset-history', { history: results });
  });
});

// ================= MODEL SUMMARY =================
app.get('/model-summary', isAuthenticated, (req, res) => {

  const sql = `
    SELECT 
      type,
      brand,
      model,
      COUNT(*) AS total,
      SUM(CASE WHEN status='In Stock' THEN 1 ELSE 0 END) AS in_stock,
      SUM(CASE WHEN status='Allocated' THEN 1 ELSE 0 END) AS allocated
    FROM assets
    GROUP BY type, brand, model
    ORDER BY type
  `;

  db.query(sql, (err, results) => {
    if (err) return res.send("DB Error");
    res.render('model-summary', { summary: results });
  });
});

// ================= START SERVER =================
app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});