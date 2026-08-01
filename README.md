# PostgreSQL vs Google Sheets — Interactive Database Benchmark

**v1.1.1**

Runs the same four operations — Search, Filter, Sort, Analytics — against the same
100,000-row dataset held in **PostgreSQL** and in **Google Sheets**, then reports
execution time side by side.

The point is a fair comparison. Both engines are loaded from one CSV, both run
semantically identical operations, and results are validated for exact parity
before timings are compared.

## Project highlights

- **One dataset, two engines.** A single generated CSV is imported into both
  PostgreSQL and Google Sheets, so the workloads are genuinely identical.
- **A readiness gate.** Benchmarks stay disabled until both engines report the
  same row count.
- **Executive dashboard.** Dataset size, per-engine averages, average speedup,
  and the overall winner, all recomputed as each operation finishes.
- **Performance charts.** Execution time and speedup rendered as animated bars
  with no charting library — CSS transitions only.
- **Benchmark history.** Every completed session is saved to LocalStorage and
  can be reopened for a per-operation breakdown.
- **Maintenance panel.** Clear PostgreSQL, clear the sheet, or reset the whole
  demo without touching the database by hand.
- **Honest methodology.** Timing boundaries and known asymmetries are documented
  in the app itself, not just here.

## Features

| Area | What it does |
|---|---|
| Dataset setup | Generates `customers.csv` with Faker, imports it into PostgreSQL via `COPY` and into the sheet via Apps Script |
| Readiness gate | Compares row counts across engines; blocks benchmarking on mismatch |
| Benchmarks | Search, Filter, Sort, Analytics — one card per engine, run independently |
| Executive dashboard | Dataset size, PostgreSQL average, Google average, average speedup, overall winner |
| Performance visualization | Execution-time bars (logarithmic width) and speedup bars (linear width) |
| Benchmark summary | Per-operation table with both timings and the speedup |
| Comparison cards | Side-by-side figures for each completed pair |
| Benchmark history | Newest-first sessions in LocalStorage, capped at 20, expandable |
| Maintenance | Reset results, clear PostgreSQL, clear Google Sheets, clear everything |
| Maintenance status | Per-engine Ready/Empty plus the last action, its time, and rows removed |
| Methodology & notes | In-app explanation of the dataset, timing boundaries, and fairness rules |
| Export | Downloads the current run as JSON |

## Architecture

The frontend never talks to Apps Script directly. Every Google Sheets call is
proxied through FastAPI.

```
┌─────────┐     HTTP      ┌─────────┐    psycopg    ┌──────────────┐
│  React  │ ────────────► │ FastAPI │ ────────────► │  PostgreSQL  │
│  (Vite) │               │         │               └──────────────┘
└─────────┘               │         │
                          │         │  HTTPS POST   ┌──────────────┐
                          │         │ ────────────► │  Apps Script │
                          └─────────┘  ?action=...  │      ▼       │
                                                    │ Google Sheet │
                                                    └──────────────┘
```

`backend/customers.csv` is the single source of truth. It is generated once, then
imported into both engines so they hold identical rows in identical order.

## Stack

- **Backend** — FastAPI + psycopg (raw SQL, no ORM) + Faker
- **Frontend** — React 19 + Vite + Tailwind CSS v4
- **Database** — PostgreSQL
- **Sheets** — Apps Script web app ([apps-script/Code.gs](apps-script/Code.gs))

## Screenshots

Drop the captures into `docs/` and the placeholders below resolve.

| Capture | Path | What to show |
|---|---|---|
| Executive dashboard | `docs/dashboard.png` | Header chips plus all five KPI cards after a full sweep |
| Performance visualization | `docs/charts.png` | Both charts with all four operations plotted |
| Benchmark history | `docs/history.png` | Several sessions, newest one expanded |
| Maintenance panel | `docs/maintenance.png` | The four buttons and the status card |
| Readiness states | `docs/readiness.png` | The 🟢 Benchmark Ready banner and the ⚠ mismatch warning |

<!-- ![Executive dashboard](docs/dashboard.png) -->
<!-- ![Performance visualization](docs/charts.png) -->
<!-- ![Benchmark history](docs/history.png) -->
<!-- ![Maintenance panel](docs/maintenance.png) -->
<!-- ![Readiness states](docs/readiness.png) -->

_Screenshots pending._

### Demo

A short capture of a full run — generate, import, verify, run all eight cards,
watch the charts and history populate.

<!-- ![Full benchmark run](docs/demo.gif) -->

_GIF pending (`docs/demo.gif`)._

## Setup

### 1. Database

```bash
docker run -d --name benchmark-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=benchmark \
  -p 5432:5432 \
  postgres:16
```

The backend creates the `customers` table on startup if it doesn't exist.
Connection defaults to `localhost:5432`, db `benchmark`, user/password
`postgres`. Override with `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`,
`DB_PASSWORD`.

> PostgreSQL must be reachable **before** the backend starts. The connection is
> opened at import time, so an unreachable database stops uvicorn from booting.

### 2. Google Sheets (Apps Script)

1. Create a Google Sheet.
2. **Rename the tab to exactly `customers`** (lowercase, no spaces). New
   spreadsheets call it `Sheet1`, so this rename is required.
3. **Extensions → Apps Script**.
4. Replace the editor contents with [apps-script/Code.gs](apps-script/Code.gs) and save.
5. **Deploy → New deployment → Web app**. *Execute as* **Me**, *Who has access*
   **Anyone**. Deploy and authorize.
6. Copy the `/exec` URL and set it as `APPS_SCRIPT_URL` for the backend.

#### The tab must be named `customers`

Every Apps Script action resolves the sheet by exact name:

```javascript
SpreadsheetApp.getActiveSpreadsheet().getSheetByName("customers")
```

`Sheet1`, `Customers`, or `customers ` (trailing space) will not match. When it
doesn't match, every action returns **HTTP 200** with:

```json
{ "success": false, "error": "Error: Sheet 'customers' not found." }
```

The dashboard detects this envelope and shows a card-level error. It does not
crash.

#### Redeploying after a code change

Saving the Apps Script editor does **not** update the live web app. The `/exec`
URL keeps serving the previously deployed version until you publish a new one:

**Deploy → Manage deployments → Edit (pencil) → Version: New Version → Deploy**

This preserves the `/exec` URL, so `APPS_SCRIPT_URL` keeps working.

Do **not** use *New deployment* for updates — that mints a different `/exec` URL
and leaves the old version live.

### 3. Backend

```bash
cd backend
python -m venv venv
venv\Scripts\Activate.ps1      # Windows PowerShell
# source venv/bin/activate     # macOS/Linux

pip install -r requirements.txt

# PowerShell: set before starting (omit to disable all Google endpoints)
$env:APPS_SCRIPT_URL = "https://script.google.com/macros/s/XXXX/exec"

uvicorn main:app --reload --port 8000
```

API runs at `http://localhost:8000`.

### 4. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## Usage

1. Set the row count (default 100000) and click **Generate CSV**.
2. Click **Import to PostgreSQL**, then **Import Google Sheets**.
3. Click **Verify Dataset**. Benchmark buttons stay disabled until both engines
   report the same row count.
4. Run each operation on both engines. The summary table, comparison cards, and
   both charts populate as pairs complete.
5. Once all four operations have finished on both engines, the session is saved
   to **Benchmark History** automatically.
6. **Export Results** downloads a JSON report.
7. **Maintenance** resets the demo: clear results only, clear either engine, or
   clear everything.

## How benchmarking works

1. **Generate.** `/generate` writes `backend/customers.csv` with Faker. This file
   is the single source of truth for both engines.
2. **Import.** `/import/postgres` truncates the table and bulk-loads the CSV with
   `COPY`. `/import/google` posts the same bytes to Apps Script, which writes
   every row into the sheet.
3. **Verify.** The dashboard calls both analytics endpoints and compares
   `totalRows`. Benchmark buttons unlock only when the counts match.
4. **Run.** Each card posts to its own endpoint. PostgreSQL times the SQL;
   Apps Script times its own scan. Neither timer includes the HTTP hop.
5. **Compare.** Speedup is `googleDurationMs ÷ postgresDurationMs`. Averages
   cover completed operations only, so figures are meaningful mid-sweep.
6. **Record.** When all eight cards have completed, one history entry is written
   to LocalStorage with both averages, the winner, and the four timings.

Details of what is and is not measured are in [Benchmark methodology](#benchmark-methodology)
and [Timing methodology](#timing-methodology).

## Endpoints

### Dataset

| Method | Path | Description |
|---|---|---|
| `POST` | `/generate` | Writes `backend/customers.csv`. Body `{"rows": 100000}` → `{"rows": …, "file": "customers.csv"}` |
| `POST` | `/import/postgres` | Truncates and bulk-loads the CSV via `COPY` → `{"rows": …, "insertTimeMs": …}` (timing covers only the `COPY`) |
| `POST` | `/import/google` | Posts the CSV as `text/csv` to `?action=import`, returns the Apps Script response unchanged |

### Maintenance

| Method | Path | Description |
|---|---|---|
| `POST` | `/maintenance/postgres/clear` | `TRUNCATE customers RESTART IDENTITY` → `{"rowsRemoved": …}` (counted before truncating) |
| `POST` | `/maintenance/google/clear` | Posts to `?action=clear`, returns the Apps Script response unchanged |

### Benchmarks

Each operation has a PostgreSQL endpoint and a Google Sheets proxy. The proxies
forward the request unchanged and return the Apps Script JSON unchanged.

| Operation | PostgreSQL | Google Sheets |
|---|---|---|
| Search | `POST /search` | `POST /benchmark/google/search` |
| Filter | `POST /filter` | `POST /benchmark/google/filter` |
| Sort | `POST /sort` | `POST /benchmark/google/sort` |
| Analytics | `POST /analytics` | `POST /benchmark/google/analytics` |

- **`/search`** — body `{"query": "Raj"}`. Case-insensitive *contains* match
  against `name`, `email`, `phone`, **and** `city`. Ordered by `id`, first 100 returned.
- **`/filter`** — body `{"city": "Port Michael", "status": "active"}`. `city` is a
  case-insensitive *contains* match; `status` is a case-insensitive *exact* match.
  An empty value means "any". Ordered by `id`, first 100 returned.
- **`/sort`** — top 20 customers by `purchase` descending. No body.
- **`/analytics`** — `totalCustomers`, `averagePurchase`, `totalPurchase`, and
  `byCity` (top 20 cities by customer count, `COUNT(*) DESC, city`). No body.

## Google Apps Script actions

| Action | Method | Purpose |
|---|---|---|
| `?action=import` | `POST` | Clears the sheet and writes the CSV |
| `?action=search` | `POST` | Linear scan, name/email/phone/city contains |
| `?action=filter` | `POST` | Linear scan, city contains + status exact |
| `?action=sort` | `POST` | Full sort by purchase descending, top 20 |
| `?action=analytics` | `POST` | Single pass: sum, average, and group-by-city |
| `?action=clear` | `POST` | Deletes every data row, keeps row 1 → `{"success": true, "rowsRemoved": …}` |
| `?action=verify` | `GET` | Manual diagnostic → `{"success": true, "rows": …, "columns": […]}` |

`?action=verify` is a manual check only — the dashboard's readiness gate uses the
analytics endpoints instead, because those report `totalRows` for both engines
through the same contract.

## Response contracts

`source` is `"PostgreSQL"` or `"Google Sheets"`. `durationMs` is a float from
PostgreSQL and an integer from Apps Script.

**Search and Filter** — separate database work from UI pagination. `totalMatches`
counts every matching row; `displayedRows` is what the table renders (max 100).

```json
{ "source": "PostgreSQL", "operation": "search", "durationMs": 0,
  "totalMatches": 0, "displayedRows": 0, "data": [] }
```

**Sort** — `totalRows` is the dataset size, `displayedRows` is the 20 returned.

```json
{ "source": "PostgreSQL", "operation": "sort", "durationMs": 0,
  "totalRows": 100000, "displayedRows": 20, "data": [] }
```

**Analytics** — `totalRows` is the dataset size. No `displayedRows`; the payload
is a single summary object.

```json
{ "source": "PostgreSQL", "operation": "analytics", "durationMs": 0,
  "totalRows": 100000,
  "data": [{ "totalCustomers": 100000, "averagePurchase": 5496.26,
             "totalPurchase": 549626340.38,
             "byCity": [{ "city": "Port Michael", "customers": 96 }] }] }
```

**Apps Script failures** are returned as HTTP 200 with
`{"success": false, "error": "..."}`. The frontend detects this on every response
and surfaces it as a card-level error without discarding other results.

## Benchmark methodology

Both engines are deliberately unoptimised and structurally comparable:

- Apps Script reads the sheet **once** per operation via
  `getDataRange().getValues()`, then scans in plain JavaScript. No `TextFinder`,
  no caching, no batching.
- PostgreSQL runs plain SQL with no added indexes beyond the `id` primary key.
- Row identity is shared: the sheet has no `id` column, so the data row index is
  used as the `id`. `TRUNCATE … RESTART IDENTITY` plus `COPY` in CSV order makes
  PostgreSQL's `SERIAL` match that index exactly.
- Search and Filter neutralise SQL `LIKE` wildcards so both engines match
  literally (see Known limitations).

Parity is validated before timings are compared: `totalMatches` / `totalRows`,
`displayedRows`, and the returned rows must match exactly between engines.

## Timing methodology

- **PostgreSQL** — `time.perf_counter()` around `execute` + `fetch` only. Excludes
  connection setup, JSON serialization, and network.
- **Google Sheets** — `Date.now()` inside the Apps Script function, covering the
  sheet read and the scan. **Excludes the HTTPS round trip to Google**, which in
  practice dominates wall-clock time.

Reported Google timings therefore measure engine work, not what the user waits
for. The dashboard states this beneath the summary table.

Two asymmetries are known and accepted:

- PostgreSQL's timer starts after `psycopg.connect()`; the Apps Script timer
  includes opening the spreadsheet.
- For Sort and Analytics, PostgreSQL makes two passes (one `COUNT(*)`, one for
  the result) where Apps Script makes one, because counting is free once every
  row is already in memory.

## Known limitations

**Search and Filter wildcard behaviour.** SQL `LIKE` treats `%` and `_` as
wildcards; JavaScript `indexOf` does not. Both are escaped before the query runs,
so `%`, `_`, and `\` are matched **literally** on both engines. Searching for `%`
returns rows containing a literal percent sign, not every row.

**Sort tie order is not guaranteed.** `ORDER BY purchase DESC` has no tiebreaker.
PostgreSQL's order among equal purchases is arbitrary; the Apps Script sort is
stable, so ties keep sheet order. In the current dataset the first tie falls at
rank 21 — one row past the `LIMIT 20` cut — so results match. **A regenerated
dataset can place a tie inside the top 20 and break parity.** Re-verify after any
`/generate`.

**Analytics city ordering depends on collation.** `ORDER BY COUNT(*) DESC, city`
resolves count ties by city name. JavaScript compares by UTF-16 code unit, which
matches PostgreSQL only under `C`/`POSIX` collation. Under `en_US.UTF-8`, glibc
ignores spaces at the primary level, so `New Zoe` and `Newmanberg` can swap.
Three such pairs exist in the current dataset; none currently fall in the top 20.
Check with `SHOW lc_collate;`.

**No automated tests.** Parity was validated with one-off harnesses against the
real dataset, not a committed suite.

**Local use only.** `API_URL` is hardcoded to `http://localhost:8000` and CORS
allows all origins.

**Dataset drift is not detected automatically.** The readiness gate compares row
counts, not contents. Importing different CSVs into each engine with the same row
count would pass verification.

**History is per-browser.** Benchmark history lives in LocalStorage, capped at 20
sessions. Clearing site data loses it; it does not sync between machines.

**Single run per measurement.** Each timing is one execution, not a median of
several. Apps Script timings in particular vary between runs.

## Roadmap

Not implemented, listed so the boundaries of v1.1.1 are clear:

- PDF export of a benchmark session
- Repeat runs with median and standard deviation
- Dark mode
- Docker Compose for the whole stack
- Additional engines (SQLite, MySQL, Airtable)
- Automated test suite covering parity between engines

## Contributing

Issues and pull requests are welcome.

- Keep the benchmark fair: any change to one engine's operation needs the
  matching change on the other, and parity must still hold.
- Match the existing style — no new dependencies, no abstractions for one-time
  logic, comments only where the reasoning is not obvious from the code.
- Run `npm run lint` and `npm run build` in `frontend/` before opening a PR.
- Describe how you verified the change. Timings are environment-specific, so
  include your dataset size and machine when reporting performance numbers.

## License

Released under the MIT License. A `LICENSE` file is not yet committed — add one
before publishing if you intend the MIT terms to be binding. Until then the code
is provided as-is for educational use.

## Version history

### v1.1.1 — current release

**Release highlights**

- One-click dataset preparation
- One-click benchmark reset
- Guided workflow progress
- Simplified demo experience
- Executive dashboard
- Performance charts
- Benchmark history
- Improved accessibility
- Better error handling
- Better maintenance tools

**Changes**

- `🚀 Prepare Benchmark Dataset` replaces the three separate setup buttons and
  runs generate → import PostgreSQL → import Google Sheets in order, stopping at
  the first failure
- `🧹 Reset Benchmark Environment` replaces the four separate maintenance
  buttons and runs reset results → clear PostgreSQL → clear Google Sheets
- Live workflow checklists that advance only when a real step completes
- Both panels keep every original button under a collapsed **Advanced** section
- Concurrency lock: neither workflow can start while the other is running, and
  Verify Dataset and the benchmark buttons are disabled throughout
- Benchmark version shown in the Executive Dashboard header

### v1.1.0

- Executive dashboard with dataset size, per-engine averages, average speedup,
  and overall winner
- Performance visualization: execution-time bars on a logarithmic scale and
  speedup bars on a linear scale, animated with CSS transitions
- Maintenance panel — reset results, clear PostgreSQL, clear Google Sheets,
  clear everything — plus `/maintenance/*` endpoints and the `?action=clear`
  Apps Script action
- Maintenance status card reporting each engine as Ready or Empty, with the last
  action, its timestamp, and rows removed
- Benchmark history in LocalStorage: automatic saving after a full sweep,
  newest-first cards capped at 20, expandable per-operation detail
- In-app benchmark methodology and benchmark notes
- Release polish: About section, footer, improved empty states, consistent
  section styling, accessibility pass, page metadata

### v1.0.0

- Dataset generation, import into PostgreSQL and Google Sheets, readiness gate
- Search, Filter, Sort, and Analytics benchmarks on both engines
- Benchmark summary table, comparison cards, and JSON export
