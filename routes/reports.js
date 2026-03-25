const express = require("express");

module.exports = (db) => {
  const router = express.Router(); 
  const puppeteer = require("puppeteer");

  // TEST route
  router.get("/test", (req, res) => {
    res.send("Reports working ✅");
  });

  // Allocation Report
  router.get("/allocations", (req, res) => {
  db.query(`
    SELECT 
      users.name AS user,
      users.employee_id,
      users.department,
      assets.asset_tag,
      assets.type,
      assets.brand,
      assets.model,
      allocations.allocation_date
    FROM allocation_items
    JOIN allocations ON allocations.id = allocation_items.allocation_id
    JOIN users ON users.id = allocations.user_id
    JOIN assets ON assets.id = allocation_items.asset_id
    WHERE assets.status = 'Allocated'
    ORDER BY allocations.id DESC
  `, (err, results) => {
    if (err) return res.send("DB Error");
    res.json(results);
  });
});
router.get("/allocations/pdf", async (req, res) => {
  db.query(`
    SELECT 
      users.name AS user,
      users.employee_id,
      users.department,
      assets.asset_tag,
      assets.type,
      allocations.allocation_date
    FROM allocation_items
    JOIN allocations ON allocations.id = allocation_items.allocation_id
    JOIN users ON users.id = allocations.user_id
    JOIN assets ON assets.id = allocation_items.asset_id
    WHERE assets.status = 'Allocated'
  `, async (err, results) => {

    if (err) return res.send("DB Error");

    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    const html = await new Promise((resolve, reject) => {
      req.app.render("pdf-template", { data: results }, (err, html) => {
        if (err) reject(err);
        else resolve(html);
      });
    });

    await page.setContent(html);
    const pdf = await page.pdf({ format: "A4" });

    await browser.close();

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": "attachment; filename=report.pdf"
    });

    res.send(pdf);
  });
});
router.get("/returns", (req, res) => {
  db.query(`
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
    ORDER BY returns.id DESC
  `, (err, results) => {
    if (err) return res.send("DB Error");
    res.json(results);
  });
});
router.get("/returns/pdf", async (req, res) => {
  db.query(`
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
  `, async (err, results) => {

    if (err) return res.send("DB Error");

    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox"]
    });

    const page = await browser.newPage();

    const html = await new Promise((resolve, reject) => {
      req.app.render("pdf-template", { data: results }, (err, html) => {
        if (err) reject(err);
        else resolve(html);
      });
    });

    await page.setContent(html);
    const pdf = await page.pdf({ format: "A4" });

    await browser.close();

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": "attachment; filename=returns.pdf"
    });

    res.send(pdf);
  });
});
  return router; // ✅ IMPORTANT
};