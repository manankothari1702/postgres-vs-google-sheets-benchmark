/**
 * Google Apps Script for PostgreSQL Benchmark
 * Sheet name: customers
 */

/* ---------- GET ---------- */

function doGet(e) {
  try {
    const action = e.parameter.action || "";

    if (action === "verify") {
      return verifySheet();
    }

    return json({
      success: true,
      message: "Google Apps Script is running.",
      endpoints: {
        import: "POST ?action=import",
        search: "POST ?action=search",
        filter: "POST ?action=filter",
        sort: "POST ?action=sort",
        analytics: "POST ?action=analytics",
        verify: "GET ?action=verify"
      }
    });

  } catch (err) {
    return json({
      success: false,
      error: err.toString()
    });
  }
}

/* ---------- POST ---------- */

function doPost(e) {
  try {
    const action = e.parameter.action || "";

    if (action === "import") {
      return importCsv(e);
    }

    if (action === "search") {
      return searchData(e);
    }

    if (action === "filter") {
      return filterData(e);
    }

    if (action === "sort") {
      return sortData(e);
    }

    if (action === "analytics") {
      return analyticsData(e);
    }

    return json({
      success: false,
      error: "Unknown action: " + action
    });

  } catch (err) {
    return json({
      success: false,
      error: err.toString()
    });
  }
}

/* ---------- IMPORT CSV ---------- */

function importCsv(e) {

  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName("customers");

  if (!sheet) {
    throw new Error("Sheet 'customers' not found.");
  }

  if (!e.postData || !e.postData.contents) {
    throw new Error("No CSV received.");
  }

  const csv = e.postData.contents;

  const rows = Utilities.parseCsv(csv);

  if (rows.length === 0) {
    throw new Error("CSV is empty.");
  }

  // Clear existing data
  sheet.clearContents();

  // Expand rows if necessary
  if (sheet.getMaxRows() < rows.length) {
    sheet.insertRowsAfter(
      sheet.getMaxRows(),
      rows.length - sheet.getMaxRows()
    );
  }

  // Expand columns if necessary
  if (sheet.getMaxColumns() < rows[0].length) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      rows[0].length - sheet.getMaxColumns()
    );
  }

  // Write all rows
  sheet
    .getRange(1, 1, rows.length, rows[0].length)
    .setValues(rows);

  SpreadsheetApp.flush();

  return json({
    success: true,
    rows: rows.length - 1
  });
}

/* ---------- SEARCH ---------- */

/**
 * Straightforward linear scan, deliberately unoptimised.
 * Sheet columns: name, email, phone, city, status, purchase, created_at
 */
function searchData(e) {

  const start = Date.now();

  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName("customers");

  if (!sheet) {
    throw new Error("Sheet 'customers' not found.");
  }

  const body = e.postData && e.postData.contents
    ? JSON.parse(e.postData.contents)
    : {};

  const query = String(body.query || "").toLowerCase();

  const values = sheet.getDataRange().getValues();

  let totalMatches = 0;
  const data = [];

  // Row 1 is the header, so start at index 1.
  for (let i = 1; i < values.length; i++) {

    const row = values[i];

    const name = String(row[0]).toLowerCase();
    const email = String(row[1]).toLowerCase();
    const phone = String(row[2]).toLowerCase();
    const city = String(row[3]).toLowerCase();

    const matched =
      name.indexOf(query) !== -1 ||
      email.indexOf(query) !== -1 ||
      phone.indexOf(query) !== -1 ||
      city.indexOf(query) !== -1;

    if (!matched) {
      continue;
    }

    totalMatches++;

    if (data.length < 100) {
      data.push({
        // The sheet has no id column. Rows keep CSV order, and PostgreSQL
        // assigns its SERIAL id in that same order, so the data row index
        // is the matching id.
        id: i,
        name: row[0],
        city: row[3],
        status: row[4],
        purchase: row[5]
      });
    }
  }

  const durationMs = Date.now() - start;

  return json({
    source: "Google Sheets",
    operation: "search",
    durationMs: durationMs,
    totalMatches: totalMatches,
    displayedRows: data.length,
    data: data
  });
}

/* ---------- FILTER ---------- */

/**
 * Straightforward linear scan, deliberately unoptimised.
 * Sheet columns: name, email, phone, city, status, purchase, created_at
 */
function filterData(e) {

  const start = Date.now();

  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName("customers");

  if (!sheet) {
    throw new Error("Sheet 'customers' not found.");
  }

  const body = e.postData && e.postData.contents
    ? JSON.parse(e.postData.contents)
    : {};

  const city = String(body.city || "").toLowerCase();
  const status = String(body.status || "").toLowerCase();

  const values = sheet.getDataRange().getValues();

  let totalMatches = 0;
  const data = [];

  // Row 1 is the header, so start at index 1.
  for (let i = 1; i < values.length; i++) {

    const row = values[i];

    const rowCity = String(row[3]).toLowerCase();
    const rowStatus = String(row[4]).toLowerCase();

    // city is a substring match, status is an exact match. An empty status
    // matches every row, the way the '%' PostgreSQL falls back to does.
    const matched =
      rowCity.indexOf(city) !== -1 &&
      (status === "" || rowStatus === status);

    if (!matched) {
      continue;
    }

    totalMatches++;

    if (data.length < 100) {
      data.push({
        // The sheet has no id column. Rows keep CSV order, and PostgreSQL
        // assigns its SERIAL id in that same order, so the data row index
        // is the matching id.
        id: i,
        name: row[0],
        city: row[3],
        status: row[4],
        purchase: row[5]
      });
    }
  }

  const durationMs = Date.now() - start;

  return json({
    source: "Google Sheets",
    operation: "filter",
    durationMs: durationMs,
    totalMatches: totalMatches,
    displayedRows: data.length,
    data: data
  });
}

/* ---------- SORT ---------- */

/**
 * Straightforward full sort, deliberately unoptimised.
 * Sheet columns: name, email, phone, city, status, purchase, created_at
 */
function sortData() {

  const start = Date.now();

  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName("customers");

  if (!sheet) {
    throw new Error("Sheet 'customers' not found.");
  }

  const values = sheet.getDataRange().getValues();

  const rows = [];

  // Row 1 is the header, so start at index 1.
  for (let i = 1; i < values.length; i++) {

    const row = values[i];

    rows.push({
      // The sheet has no id column. Rows keep CSV order, and PostgreSQL
      // assigns its SERIAL id in that same order, so the data row index
      // is the matching id.
      id: i,
      name: row[0],
      city: row[3],
      status: row[4],
      purchase: row[5]
    });
  }

  // Same field and direction as PostgreSQL: ORDER BY purchase DESC.
  // Array.prototype.sort is stable, so tied purchases keep sheet order.
  rows.sort(function (a, b) {
    return Number(b.purchase) - Number(a.purchase);
  });

  const data = rows.slice(0, 20);

  const durationMs = Date.now() - start;

  return json({
    source: "Google Sheets",
    operation: "sort",
    durationMs: durationMs,
    totalRows: rows.length,
    displayedRows: data.length,
    data: data
  });
}

/* ---------- ANALYTICS ---------- */

/**
 * Straightforward single pass plus a group-by, deliberately unoptimised.
 * Sheet columns: name, email, phone, city, status, purchase, created_at
 */
function analyticsData() {

  const start = Date.now();

  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName("customers");

  if (!sheet) {
    throw new Error("Sheet 'customers' not found.");
  }

  const values = sheet.getDataRange().getValues();

  const totalRows = values.length - 1;

  const counts = new Map();

  let sum = 0;

  // Row 1 is the header, so start at index 1.
  for (let i = 1; i < values.length; i++) {

    const row = values[i];

    const city = row[3];

    sum += Number(row[5]);

    counts.set(city, (counts.get(city) || 0) + 1);
  }

  const cities = [];

  counts.forEach(function (customers, city) {
    cities.push({
      city: city,
      customers: customers
    });
  });

  // ORDER BY COUNT(*) DESC, city
  cities.sort(function (a, b) {
    if (b.customers !== a.customers) {
      return b.customers - a.customers;
    }
    return a.city < b.city ? -1 : (a.city > b.city ? 1 : 0);
  });

  // PostgreSQL sums NUMERIC(10, 2) exactly, so the true total always lands on
  // two decimals. Rounding undoes the float64 drift of 100k additions, which
  // otherwise reports 549626340.3800013 where PostgreSQL reports 549626340.38.
  const totalPurchase = Math.round(sum * 100) / 100;
  const averagePurchase = Math.round((sum / totalRows) * 100) / 100;

  const data = [
    {
      totalCustomers: totalRows,
      averagePurchase: averagePurchase,
      totalPurchase: totalPurchase,
      byCity: cities.slice(0, 20)
    }
  ];

  const durationMs = Date.now() - start;

  return json({
    source: "Google Sheets",
    operation: "analytics",
    durationMs: durationMs,
    totalRows: totalRows,
    data: data
  });
}

/* ---------- VERIFY ---------- */

function verifySheet() {

  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName("customers");

  if (!sheet) {
    throw new Error("Sheet 'customers' not found.");
  }

  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  let headers = [];

  if (lastRow > 0 && lastColumn > 0) {
    headers = sheet
      .getRange(1, 1, 1, lastColumn)
      .getValues()[0];
  }

  return json({
    success: true,
    rows: Math.max(lastRow - 1, 0),
    columns: headers
  });
}

/* ---------- JSON RESPONSE ---------- */

function json(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
