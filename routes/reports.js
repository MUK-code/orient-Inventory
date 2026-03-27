// Debug endpoint: show counts for returns sources
// (must be inside module.exports)

const express = require("express");
const fs = require('fs');
const path = require('path');

module.exports = (db) => {
  const router = express.Router();
  const puppeteer = require("puppeteer");

  // Debug endpoint: show counts for returns sources
  router.get('/returns-debug-counts', (req, res) => {
    const db1 = `SELECT COUNT(*) AS cnt FROM asset_history WHERE action_type='returned'`;
    const db2 = `SELECT COUNT(*) AS cnt FROM returns`;
    db.query(db1, (err1, r1) => {
      if (err1) return res.status(500).send('DB Error 1');
      db.query(db2, (err2, r2) => {
        if (err2) return res.status(500).send('DB Error 2');
        res.json({ asset_history_returned: r1[0].cnt, returns_table: r2[0].cnt });
      });
    });
  });
const express = require("express");
const fs = require('fs');
const path = require('path');

module.exports = (db) => {
  const router = express.Router(); 
  const puppeteer = require("puppeteer");

  // TEST route
  router.get("/test", (req, res) => {
    res.send("Reports working ✅");
  });

  // Allocation Report
  router.get("/allocations", (req, res) => {
    const search = req.query.search || '';
    let params = [];
    let where = "WHERE assets.status = 'Allocated'";

    if (search) {
      where += " AND (users.name LIKE ? OR users.employee_id LIKE ? OR assets.asset_tag LIKE ? OR assets.type LIKE ? OR assets.brand LIKE ? OR assets.model LIKE ?)";
      const v = `%${search}%`;
      params = [v, v, v, v, v, v];
    }

    const sql = `
      SELECT 
        users.name AS user,
        users.employee_id,
        users.department,
        assets.asset_tag,
        assets.type,
        assets.brand,
        assets.model,
        DATE_FORMAT(allocations.allocation_date, '%Y-%m-%d') AS allocation_date
      FROM allocation_items
      JOIN allocations ON allocations.id = allocation_items.allocation_id
      JOIN users ON users.id = allocations.user_id
      JOIN assets ON assets.id = allocation_items.asset_id
      ${where}
      ORDER BY allocations.id DESC
    `;

    db.query(sql, params, (err, results) => {
      if (err) return res.status(500).send("DB Error");
      res.json(results);
    });
});
router.get("/allocations/pdf", async (req, res) => {
  const search = req.query.search || '';
  let params = [];
  let where = "WHERE assets.status = 'Allocated'";

  if (search) {
    where += " AND (users.name LIKE ? OR users.employee_id LIKE ? OR assets.asset_tag LIKE ? OR assets.type LIKE ? OR assets.brand LIKE ? OR assets.model LIKE ?)";
    const v = `%${search}%`;
    params = [v, v, v, v, v, v];
  }

  const sql = `
    SELECT 
      users.name AS user,
      users.employee_id,
      users.department,
      assets.asset_tag,
      assets.type,
      assets.brand,
      assets.model,
      DATE_FORMAT(allocations.allocation_date, '%Y-%m-%d') AS allocation_date
    FROM allocation_items
    JOIN allocations ON allocations.id = allocation_items.allocation_id
    JOIN users ON users.id = allocations.user_id
    JOIN assets ON assets.id = allocation_items.asset_id
    ${where}
    ORDER BY allocations.id DESC
  `;

  db.query(sql, params, async (err, results) => {

    if (err) return res.status(500).send("DB Error");

    const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();

    const html = await new Promise((resolve, reject) => {
      req.app.render("pdf-template", { data: results }, (err, html) => {
        if (err) reject(err);
        else resolve(html);
      });
    });

    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: "A4", printBackground: true });

    await browser.close();

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": "attachment; filename=allocations-report.pdf"
    });

    res.send(pdf);
  });
});
// CSV export for allocations
router.get('/allocations/csv', (req, res) => {
  const search = req.query.search || '';
  let params = [];
  let where = "WHERE ah.action_type = 'returned'";

  if (search) {
    where += " AND (u.name LIKE ? OR u.employee_id LIKE ? OR a.asset_tag LIKE ? OR a.type LIKE ? OR a.brand LIKE ? OR a.model LIKE ?)";
    const v = `%${search}%`;
    params = [v, v, v, v, v, v];
  }

  const sql = `
    SELECT
      u.name AS user,
      u.employee_id,
      u.department,
      a.asset_tag,
      a.type,
      DATE_FORMAT(ah.action_date, '%Y-%m-%d') AS return_date,
      '' AS condition_on_return
    FROM asset_history ah
    LEFT JOIN users u ON u.id = ah.user_id
    LEFT JOIN assets a ON a.id = ah.asset_id
    ${where}
    ORDER BY ah.action_date DESC
  `;

  db.query(sql, params, (err, results) => {
    if (err) return res.send('DB Error');

    const csv = [
      ['User','Employee ID','Department','Asset Tag','Type','Return Date','Condition']
    ];

    results.forEach(r => {
      csv.push([r.user, r.employee_id, r.department, r.asset_tag, r.type, r.return_date, r.condition_on_return]);
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="returns.csv"');
    res.send(csv.map(r => r.join(',')).join('\n'));
  });
});
router.get("/returns", (req, res) => {
  const search = req.query.search || '';
  let params = [];
  let where1 = '', where2 = '';
  if (search) {
    const v = `%${search}%`;
    where1 = "AND (u.name LIKE ? OR u.employee_id LIKE ? OR a.asset_tag LIKE ? OR a.type LIKE ? OR a.brand LIKE ? OR a.model LIKE ?)";
    where2 = "AND (users.name LIKE ? OR users.employee_id LIKE ? OR assets.asset_tag LIKE ? OR assets.type LIKE ? OR assets.brand LIKE ? OR assets.model LIKE ? OR returns.condition_on_return LIKE ?)";
    params = [v, v, v, v, v, v, v, v, v, v, v, v, v];
  }

  const sql = `
    SELECT
      u.name AS user,
      u.employee_id,
      u.department,
      a.asset_tag,
      a.type,
      DATE_FORMAT(ah.action_date, '%Y-%m-%d') AS return_date,
      '' AS condition_on_return
    FROM asset_history ah
    LEFT JOIN users u ON u.id = ah.user_id
    LEFT JOIN assets a ON a.id = ah.asset_id
    WHERE ah.action_type = 'returned' ${where1}
    UNION ALL
    SELECT
      users.name AS user,
      users.employee_id,
      users.department,
      assets.asset_tag,
      assets.type,
      returns.return_date,
      returns.condition_on_return
    FROM returns
    JOIN allocations ON allocations.id = returns.allocation_id
    JOIN users ON users.id = allocations.user_id
    JOIN allocation_items ON allocation_items.allocation_id = allocations.id
    JOIN assets ON assets.id = allocation_items.asset_id
    WHERE 1=1 ${where2}
    ORDER BY return_date DESC
  `;

  db.query(sql, params, (err, results) => {
    if (err) return res.status(500).send('DB Error');
    console.log('[reports] /returns -> rows=', Array.isArray(results) ? results.length : 0);
    res.json(results);
  });
});
router.get('/returns/pdf', async (req, res) => {
  const search = req.query.search || '';
  let params = [];
  let where = '';
  if (search) {
    where = "AND (u.name LIKE ? OR u.employee_id LIKE ? OR a.asset_tag LIKE ? OR a.type LIKE ? OR a.brand LIKE ? OR a.model LIKE ? )";
    const v = `%${search}%`;
    params = [v, v, v, v, v, v];
  }

  const sql = `
    SELECT
      u.name AS user,
      u.employee_id,
      u.department,
      a.asset_tag,
      a.type,
      DATE_FORMAT(ah.action_date, '%Y-%m-%d') AS return_date,
      '' AS condition_on_return
    FROM asset_history ah
    LEFT JOIN users u ON u.id = ah.user_id
    LEFT JOIN assets a ON a.id = ah.asset_id
    WHERE ah.action_type = 'returned'
    ${search ? where : ''}
    ORDER BY ah.action_date DESC
  `;

  db.query(sql, params, async (err, results) => {

    if (err) return res.status(500).send('DB Error');

    const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();

    const html = await new Promise((resolve, reject) => {
      req.app.render('pdf-template', { data: results }, (err, html) => {
        if (err) reject(err);
        else resolve(html);
      });
    });

    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });

    await browser.close();

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename=returns.pdf'
    });

    res.send(pdf);
  });
});
// CSV export for returns
router.get('/returns/csv', (req, res) => {
  const search = req.query.search || '';
  let params = [];
  let where = '';

  if (search) {
    where = "AND (u.name LIKE ? OR u.employee_id LIKE ? OR a.asset_tag LIKE ? OR a.type LIKE ? OR a.brand LIKE ? OR a.model LIKE ? )";
    const v = `%${search}%`;
    params = [v, v, v, v, v, v];
  }

  const sql = `
    SELECT
      u.name AS user,
      u.employee_id,
      u.department,
      a.asset_tag,
      a.type,
      DATE_FORMAT(ah.action_date, '%Y-%m-%d') AS return_date,
      '' AS condition_on_return
    FROM asset_history ah
    LEFT JOIN users u ON u.id = ah.user_id
    LEFT JOIN assets a ON a.id = ah.asset_id
    WHERE ah.action_type = 'returned'
    ${where}
    ORDER BY ah.action_date DESC
  `;

  db.query(sql, params, (err, results) => {
    if (err) return res.status(500).send('DB Error');

    if (!results || results.length === 0) {
      res.set({ 'Content-Type': 'text/csv' });
      return res.send('');
    }

    const keys = Object.keys(results[0]);
    const escape = (val) => {
      if (val === null || val === undefined) return '';
      const s = String(val).replace(/"/g, '""');
      return `"${s}"`;
    };

    const header = keys.join(',') + '\n';
    const rows = results.map(r => keys.map(k => escape(r[k])).join(',')).join('\n');

    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="returns.csv"'
    });

    res.send(header + rows);
  });
});

// In-Stock JSON
router.get('/in-stock', (req, res) => {
  const search = req.query.search || '';
  let params = [];
  let where = "WHERE status = 'In Stock'";

  if (search) {
    where += " AND (type LIKE ? OR brand LIKE ? OR model LIKE ? OR serial_number LIKE ? OR asset_tag LIKE ?)";
    const v = `%${search}%`;
    params = [v, v, v, v, v];
  }

  const sql = `SELECT asset_tag, type, brand, model, serial_number, vendor FROM assets ${where} ORDER BY id DESC`;

  db.query(sql, params, (err, results) => {
    if (err) return res.status(500).send('DB Error');
    res.json(results);
  });
});

// In-Stock CSV
router.get('/in-stock/csv', (req, res) => {
  const search = req.query.search || '';
  let params = [];
  let where = "WHERE status = 'In Stock'";

  if (search) {
    where += " AND (type LIKE ? OR brand LIKE ? OR model LIKE ? OR serial_number LIKE ? OR asset_tag LIKE ?)";
    const v = `%${search}%`;
    params = [v, v, v, v, v];
  }

  const sql = `SELECT asset_tag, type, brand, model, serial_number, vendor FROM assets ${where} ORDER BY id DESC`;

  db.query(sql, params, (err, results) => {
    if (err) return res.status(500).send('DB Error');

    if (!results || results.length === 0) {
      res.set({ 'Content-Type': 'text/csv' });
      return res.send('');
    }

    const keys = Object.keys(results[0]);
    const escape = (val) => {
      if (val === null || val === undefined) return '';
      const s = String(val).replace(/"/g, '""');
      return `"${s}"`;
    };

    const header = keys.join(',') + '\n';
    const rows = results.map(r => keys.map(k => escape(r[k])).join(',')).join('\n');

    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="in-stock.csv"'
    });

    res.send(header + rows);
  });
});

// In-Stock PDF
router.get('/in-stock/pdf', async (req, res) => {
  const search = req.query.search || '';
  let params = [];
  let where = "WHERE status = 'In Stock'";

  if (search) {
    where += " AND (type LIKE ? OR brand LIKE ? OR model LIKE ? OR serial_number LIKE ? OR asset_tag LIKE ?)";
    const v = `%${search}%`;
    params = [v, v, v, v, v];
  }

  const sql = `SELECT asset_tag, type, brand, model, serial_number, vendor FROM assets ${where} ORDER BY id DESC`;

  db.query(sql, params, async (err, results) => {
    if (err) return res.status(500).send('DB Error');

    try {
      const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
      const page = await browser.newPage();

      const html = await new Promise((resolve, reject) => {
        req.app.render('pdf-template', { data: results }, (err, html) => {
          if (err) reject(err);
          else resolve(html);
        });
      });

      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({ format: 'A4', printBackground: true });
      await browser.close();

      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="in-stock.pdf"'
      });

      res.send(pdf);
    } catch (e) {
      return res.status(500).send('PDF generation error');
    }
  });
});

// small metrics: in-stock count
router.get('/in-stock-count', (req, res) => {
  db.query("SELECT COUNT(*) AS count FROM assets WHERE status = 'In Stock'", (err, results) => {
    if (err) return res.status(500).send('DB Error');
    res.json({ count: results[0].count });
  });
});

// small metrics: allocated count
router.get('/allocated-count', (req, res) => {
  db.query("SELECT COUNT(*) AS count FROM assets WHERE status = 'Allocated'", (err, results) => {
    if (err) return res.status(500).send('DB Error');
    res.json({ count: results[0].count });
  });
});

// (employee-allocations endpoint removed)
  return router; // ✅ IMPORTANT
};