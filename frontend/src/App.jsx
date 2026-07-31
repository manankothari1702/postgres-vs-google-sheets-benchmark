import { useState } from 'react'

const API_URL = 'http://localhost:8000'

const GOOGLE_SEARCH = 'benchmark/google/search'
const GOOGLE_FILTER = 'benchmark/google/filter'
const GOOGLE_SORT = 'benchmark/google/sort'
const GOOGLE_ANALYTICS = 'benchmark/google/analytics'

// Each benchmark pairs one PostgreSQL endpoint with its Google Sheets twin.
const OPERATIONS = [
  { label: 'Search', postgres: 'search', google: GOOGLE_SEARCH },
  { label: 'Filter', postgres: 'filter', google: GOOGLE_FILTER },
  { label: 'Sort', postgres: 'sort', google: GOOGLE_SORT },
  { label: 'Analytics', postgres: 'analytics', google: GOOGLE_ANALYTICS },
]

const STATUS_STYLES = {
  Waiting: 'bg-gray-100 text-gray-600',
  Running: 'bg-blue-100 text-blue-700',
  Completed: 'bg-green-100 text-green-700',
  Failed: 'bg-red-100 text-red-700',
}

const formatMs = (ms) => `${Math.round(ms).toLocaleString()} ms`

// Speedup = Google Sheets / PostgreSQL. Guarded so a zero or missing
// PostgreSQL timing never renders as Infinity or NaN.
const speedupOf = (postgres, google) => {
  if (!postgres || !google || !(postgres.durationMs > 0)) {
    return null
  }
  return google.durationMs / postgres.durationMs
}

function Spinner({ className = 'h-3 w-3' }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
      />
    </svg>
  )
}

function StatusBadge({ status }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {status === 'Running' && <Spinner />}
      {status}
    </span>
  )
}

function SectionHeading({ children }) {
  return (
    <h2 className="mb-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
      {children}
    </h2>
  )
}

function Card({ title, status, disabled, running, result, error, onRun, children }) {
  const columns = result && result.data.length ? Object.keys(result.data[0]) : []

  return (
    <div className="rounded-lg bg-white p-5 shadow-md">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        <StatusBadge status={status} />
      </div>

      {children}

      <button
        type="button"
        onClick={onRun}
        disabled={running || disabled}
        aria-busy={running}
        className="flex w-full items-center justify-center gap-2 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {running && <Spinner className="h-4 w-4" />}
        {running ? 'Running...' : `Run ${title}`}
      </button>

      {error && (
        <div className="mt-3 rounded border border-red-200 bg-red-50 p-3">
          <p className="text-sm font-medium text-red-800">❌ {title} failed</p>
          <p className="mt-1 text-sm text-red-700">{error}</p>
        </div>
      )}

      {result && (
        <div className="mt-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-700">
            <span>
              Execution time:{' '}
              <span className="font-medium">
                {result.durationMs.toFixed(2)} ms
              </span>
            </span>
            <span>
              {result.totalMatches === undefined ? 'Total rows' : 'Total matches'}
              :{' '}
              <span className="font-medium">
                {(result.totalMatches ?? result.totalRows).toLocaleString()}
              </span>
            </span>
            {result.displayedRows !== undefined && (
              <span>
                Showing:{' '}
                <span className="font-medium">
                  {result.displayedRows.toLocaleString()} rows
                </span>
              </span>
            )}
          </div>

          {result.operation === 'analytics' ? (
            <div className="mt-3 text-sm text-gray-700">
              <p>
                Total customers:{' '}
                <span className="font-medium">
                  {result.data[0].totalCustomers.toLocaleString()}
                </span>
              </p>
              <p>
                Average purchase:{' '}
                <span className="font-medium">
                  {result.data[0].averagePurchase}
                </span>
              </p>
              <p>
                Total purchase:{' '}
                <span className="font-medium">
                  {result.data[0].totalPurchase}
                </span>
              </p>
              <p className="mt-2 mb-1 font-medium">Top cities</p>
              <div className="max-h-64 overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-gray-100">
                    <tr>
                      <th className="px-2 py-1">city</th>
                      <th className="px-2 py-1">customers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.data[0].byCity.map((row) => (
                      <tr key={row.city} className="border-t border-gray-200">
                        <td className="px-2 py-1">{row.city}</td>
                        <td className="px-2 py-1">{row.customers}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="mt-3 max-h-64 overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-gray-100">
                  <tr>
                    {columns.map((col) => (
                      <th key={col} className="px-2 py-1">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((row) => (
                    <tr key={row.id} className="border-t border-gray-200">
                      {columns.map((col) => (
                        <td key={col} className="px-2 py-1">
                          {String(row[col])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.data.length === 0 && (
                <p className="text-sm text-gray-500">No rows matched.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ComparisonCard({ label, postgres, google }) {
  const speedup = speedupOf(postgres, google)

  return (
    <div className="rounded-lg bg-white p-5 shadow-md">
      <h3 className="mb-3 text-base font-semibold text-gray-900">{label}</h3>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-xs text-gray-500">PostgreSQL</p>
          <p className="text-lg font-semibold text-gray-900">
            {formatMs(postgres.durationMs)}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Google Sheets</p>
          <p className="text-lg font-semibold text-gray-900">
            {formatMs(google.durationMs)}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Speedup</p>
          <p className="text-lg font-semibold text-green-700">
            {speedup === null ? '—' : `${speedup.toFixed(1)}×`}
          </p>
        </div>
      </div>
    </div>
  )
}

function ReadinessBanner({ readiness, onVerify }) {
  const { state, postgresRows, googleRows, message } = readiness

  const shell = {
    idle: 'border-gray-300 bg-white',
    checking: 'border-blue-300 bg-blue-50',
    ready: 'border-green-300 bg-green-50',
    mismatch: 'border-amber-300 bg-amber-50',
    error: 'border-red-300 bg-red-50',
  }[state]

  return (
    <div className={`mb-6 rounded-lg border p-5 shadow-sm ${shell}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="text-sm">
          {state === 'idle' && (
            <>
              <p className="font-semibold text-gray-900">Dataset not verified</p>
              <p className="mt-1 text-gray-600">
                Verify that both engines hold the same number of rows before
                benchmarking.
              </p>
            </>
          )}

          {state === 'checking' && (
            <p className="flex items-center gap-2 font-semibold text-blue-800">
              <Spinner className="h-4 w-4" />
              Verifying dataset...
            </p>
          )}

          {state === 'ready' && (
            <>
              <p className="font-semibold text-green-800">🟢 Benchmark Ready</p>
              <p className="mt-1 text-gray-700">
                Dataset verified. PostgreSQL{' '}
                <span className="font-medium">
                  {postgresRows.toLocaleString()}
                </span>{' '}
                rows · Google Sheets{' '}
                <span className="font-medium">
                  {googleRows.toLocaleString()}
                </span>{' '}
                rows.
              </p>
            </>
          )}

          {state === 'mismatch' && (
            <>
              <p className="text-amber-900">
                ⚠ PostgreSQL: {postgresRows.toLocaleString()}
              </p>
              <p className="text-amber-900">
                ⚠ Google Sheets: {googleRows.toLocaleString()}
              </p>
              <p className="mt-1 font-semibold text-amber-900">
                Dataset mismatch. Import again before benchmarking.
              </p>
            </>
          )}

          {state === 'error' && (
            <>
              <p className="font-semibold text-red-800">
                ⚠ Verification failed
              </p>
              <p className="mt-1 text-red-700">{message}</p>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={onVerify}
          disabled={state === 'checking'}
          className="rounded bg-gray-800 px-3 py-2 text-sm font-medium text-white hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state === 'ready' ? 'Re-verify Dataset' : 'Verify Dataset'}
        </button>
      </div>
    </div>
  )
}

function App() {
  const [rows, setRows] = useState(100000)
  const [generating, setGenerating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importingGoogle, setImportingGoogle] = useState(false)
  const [csvResult, setCsvResult] = useState(null)
  const [importResult, setImportResult] = useState(null)
  const [googleResult, setGoogleResult] = useState(null)
  const [error, setError] = useState(null)

  const [query, setQuery] = useState('Raj')
  const [city, setCity] = useState('Port Michael')
  const [status, setStatus] = useState('active')
  const [results, setResults] = useState({})
  const [running, setRunning] = useState({})
  const [errors, setErrors] = useState({})

  const [readiness, setReadiness] = useState({ state: 'idle' })

  const ready = readiness.state === 'ready'

  // Single entry point for every backend call. `body` is omitted for the
  // import endpoints, which take no payload.
  const postJson = async (operation, body) => {
    const res = await fetch(
      `${API_URL}/${operation}`,
      body === undefined
        ? { method: 'POST' }
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
    )

    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.detail || `Request failed with status ${res.status}`)
    }

    const data = await res.json()

    // Apps Script reports its own failures as HTTP 200 with
    // {success: false, error: "..."}, which FastAPI forwards unchanged.
    // Without this check the error object would be stored as a result and
    // crash the card that renders it.
    if (data && data.success === false) {
      throw new Error(
        String(data.error || 'Google Apps Script reported an error.').replace(
          /^Error:\s*/,
          '',
        ),
      )
    }

    return data
  }

  // Changing the data invalidates both the verification and any timings
  // collected against the previous dataset.
  const resetBenchmarks = () => {
    setReadiness({ state: 'idle' })
    setResults({})
    setErrors({})
  }

  const handleGenerate = async () => {
    setGenerating(true)
    setError(null)
    setCsvResult(null)
    setImportResult(null)
    resetBenchmarks()

    try {
      setCsvResult(await postJson('generate', { rows: Number(rows) }))
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  const handleImport = async () => {
    setImporting(true)
    setError(null)
    setImportResult(null)
    resetBenchmarks()

    try {
      setImportResult(await postJson('import/postgres'))
    } catch (err) {
      setError(err.message)
    } finally {
      setImporting(false)
    }
  }

  const handleImportGoogle = async () => {
    setImportingGoogle(true)
    setError(null)
    setGoogleResult(null)
    resetBenchmarks()

    try {
      setGoogleResult(await postJson('import/google'))
    } catch (err) {
      setError(err.message)
    } finally {
      setImportingGoogle(false)
    }
  }

  // Both analytics endpoints report totalRows as the dataset row count, so
  // they double as the row-count probe for each engine.
  const handleVerify = async () => {
    setReadiness({ state: 'checking' })

    try {
      const [postgres, google] = await Promise.all([
        postJson('analytics', {}),
        postJson(GOOGLE_ANALYTICS, {}),
      ])

      setReadiness({
        state: postgres.totalRows === google.totalRows ? 'ready' : 'mismatch',
        postgresRows: postgres.totalRows,
        googleRows: google.totalRows,
      })
    } catch (err) {
      setReadiness({ state: 'error', message: err.message })
    }
  }

  const run = async (operation, body) => {
    setRunning((prev) => ({ ...prev, [operation]: true }))
    setErrors((prev) => ({ ...prev, [operation]: null }))

    try {
      const data = await postJson(operation, body)
      setResults((prev) => ({ ...prev, [operation]: data }))
    } catch (err) {
      setErrors((prev) => ({ ...prev, [operation]: err.message }))
      // Drop only this operation's own result, so its comparison cannot keep
      // showing a speedup for a run that just failed. Every other operation's
      // result is left untouched.
      setResults((prev) => {
        if (!(operation in prev)) {
          return prev
        }
        const next = { ...prev }
        delete next[operation]
        return next
      })
    } finally {
      setRunning((prev) => ({ ...prev, [operation]: false }))
    }
  }

  // A Search or Filter parameter change makes both engines' results for that
  // operation stale, so they are dropped together with their comparison.
  const invalidatePair = (postgres, google) => {
    const drop = (prev) => {
      if (!(postgres in prev) && !(google in prev)) {
        return prev
      }
      const next = { ...prev }
      delete next[postgres]
      delete next[google]
      return next
    }
    setResults(drop)
    setErrors(drop)
  }

  const changeQuery = (value) => {
    setQuery(value)
    invalidatePair('search', GOOGLE_SEARCH)
  }

  const changeCity = (value) => {
    setCity(value)
    invalidatePair('filter', GOOGLE_FILTER)
  }

  const changeStatus = (value) => {
    setStatus(value)
    invalidatePair('filter', GOOGLE_FILTER)
  }

  const statusOf = (operation) => {
    if (running[operation]) return 'Running'
    if (errors[operation]) return 'Failed'
    if (results[operation]) return 'Completed'
    return 'Waiting'
  }

  const completedPairs = OPERATIONS.filter(
    (op) => results[op.postgres] && results[op.google],
  )

  const handleExport = () => {
    const payload = {
      benchmarkDate: new Date().toISOString(),
      datasetSize: readiness.postgresRows ?? null,
      results: OPERATIONS.map((op) => {
        const postgres = results[op.postgres]
        const google = results[op.google]
        const speedup = speedupOf(postgres, google)

        return {
          operation: op.label,
          postgresMs: postgres ? postgres.durationMs : null,
          googleSheetsMs: google ? google.durationMs : null,
          speedup: speedup === null ? null : Number(speedup.toFixed(1)),
        }
      }),
    }

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `benchmark-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-1 text-xl font-semibold text-gray-900">
          PostgreSQL vs Google Sheets Benchmark
        </h1>
        <p className="mb-6 text-sm text-gray-600">
          Identical data, identical operations, executed against both engines.
        </p>

        <div className="mb-6 rounded-lg bg-white p-5 shadow-md">
          <label
            htmlFor="rows"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            Number of rows
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="rows"
              type="number"
              min="1"
              value={rows}
              onChange={(e) => setRows(e.target.value)}
              className="w-40 rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating || importing || importingGoogle}
              className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generating ? 'Generating CSV...' : 'Generate CSV'}
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={generating || importing || importingGoogle}
              className="rounded bg-gray-800 px-3 py-2 text-sm font-medium text-white hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {importing ? 'Importing...' : 'Import to PostgreSQL'}
            </button>
            <button
              type="button"
              onClick={handleImportGoogle}
              disabled={generating || importing || importingGoogle}
              className="rounded bg-green-700 px-3 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {importingGoogle ? 'Importing...' : 'Import Google Sheets'}
            </button>
          </div>

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

          {csvResult && (
            <p className="mt-3 text-sm text-green-700">
              CSV generated successfully ({csvResult.rows.toLocaleString()} rows)
            </p>
          )}

          {importResult && (
            <p className="mt-1 text-sm text-gray-700">
              Rows imported:{' '}
              <span className="font-medium">
                {importResult.rows.toLocaleString()}
              </span>{' '}
              · Insert time:{' '}
              <span className="font-medium">
                {importResult.insertTimeMs.toFixed(2)} ms
              </span>
            </p>
          )}

          {importingGoogle && (
            <p className="mt-1 text-sm text-gray-500">
              Importing customers.csv into Google Sheets...
            </p>
          )}

          {googleResult && (
            <p className="mt-1 text-sm text-gray-700">
              Google Sheets rows imported:{' '}
              <span className="font-medium">
                {googleResult.rows.toLocaleString()}
              </span>{' '}
              · Status: <span className="font-medium">Imported</span>
            </p>
          )}
        </div>

        <ReadinessBanner readiness={readiness} onVerify={handleVerify} />

        <div className="mb-6 rounded-lg bg-white p-5 shadow-md">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <SectionHeading>Benchmark summary</SectionHeading>
            <button
              type="button"
              onClick={handleExport}
              disabled={completedPairs.length === 0}
              className="rounded bg-gray-800 px-3 py-2 text-sm font-medium text-white hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Export Results
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-100 text-gray-700">
                <tr>
                  <th className="px-3 py-2 font-medium">Operation</th>
                  <th className="px-3 py-2 font-medium">PostgreSQL</th>
                  <th className="px-3 py-2 font-medium">Google Sheets</th>
                  <th className="px-3 py-2 font-medium">Speedup</th>
                </tr>
              </thead>
              <tbody>
                {OPERATIONS.map((op) => {
                  const postgres = results[op.postgres]
                  const google = results[op.google]
                  const speedup = speedupOf(postgres, google)

                  return (
                    <tr key={op.label} className="border-t border-gray-200">
                      <td className="px-3 py-2 font-medium text-gray-900">
                        {op.label}
                      </td>
                      <td
                        className={`px-3 py-2 ${postgres ? 'text-gray-700' : 'text-gray-400'}`}
                      >
                        {postgres ? formatMs(postgres.durationMs) : '—'}
                      </td>
                      <td
                        className={`px-3 py-2 ${google ? 'text-gray-700' : 'text-gray-400'}`}
                      >
                        {google ? formatMs(google.durationMs) : '—'}
                      </td>
                      <td
                        className={`px-3 py-2 font-medium ${
                          speedup === null ? 'text-gray-400' : 'text-green-700'
                        }`}
                      >
                        {speedup === null ? '—' : `${speedup.toFixed(1)}×`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs text-gray-500">
            Google Sheets timings are the Apps Script execution time and exclude
            the HTTP round trip to Google.
          </p>
        </div>

        {completedPairs.length > 0 && (
          <div className="mb-6">
            <SectionHeading>Comparison</SectionHeading>
            <div className="grid gap-5 md:grid-cols-2">
              {completedPairs.map((op) => (
                <ComparisonCard
                  key={op.label}
                  label={op.label}
                  postgres={results[op.postgres]}
                  google={results[op.google]}
                />
              ))}
            </div>
          </div>
        )}

        <SectionHeading>Operations</SectionHeading>
        <div className="grid gap-5 md:grid-cols-2">
          <Card
            title="Search"
            status={statusOf('search')}
            disabled={!ready}
            running={running.search}
            result={results.search}
            error={errors.search}
            onRun={() => run('search', { query })}
          >
            <input
              type="text"
              value={query}
              onChange={(e) => changeQuery(e.target.value)}
              placeholder="name contains"
              className="mb-3 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </Card>

          <Card
            title="Google Sheets Search"
            status={statusOf(GOOGLE_SEARCH)}
            disabled={!ready}
            running={running[GOOGLE_SEARCH]}
            result={results[GOOGLE_SEARCH]}
            error={errors[GOOGLE_SEARCH]}
            onRun={() => run(GOOGLE_SEARCH, { query })}
          >
            <input
              type="text"
              value={query}
              onChange={(e) => changeQuery(e.target.value)}
              placeholder="name, email, phone, or city contains"
              className="mb-3 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </Card>

          <Card
            title="Filter"
            status={statusOf('filter')}
            disabled={!ready}
            running={running.filter}
            result={results.filter}
            error={errors.filter}
            onRun={() => run('filter', { city, status })}
          >
            <div className="mb-3 flex gap-2">
              <input
                type="text"
                value={city}
                onChange={(e) => changeCity(e.target.value)}
                placeholder="city"
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
              <input
                type="text"
                value={status}
                onChange={(e) => changeStatus(e.target.value)}
                placeholder="status"
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
          </Card>

          <Card
            title="Google Sheets Filter"
            status={statusOf(GOOGLE_FILTER)}
            disabled={!ready}
            running={running[GOOGLE_FILTER]}
            result={results[GOOGLE_FILTER]}
            error={errors[GOOGLE_FILTER]}
            onRun={() => run(GOOGLE_FILTER, { city, status })}
          >
            <div className="mb-3 flex gap-2">
              <input
                type="text"
                value={city}
                onChange={(e) => changeCity(e.target.value)}
                placeholder="city"
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
              <input
                type="text"
                value={status}
                onChange={(e) => changeStatus(e.target.value)}
                placeholder="status"
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
          </Card>

          <Card
            title="Sort"
            status={statusOf('sort')}
            disabled={!ready}
            running={running.sort}
            result={results.sort}
            error={errors.sort}
            onRun={() => run('sort', {})}
          >
            <p className="mb-3 text-sm text-gray-500">
              Top 20 customers by purchase (descending).
            </p>
          </Card>

          <Card
            title="Google Sheets Sort"
            status={statusOf(GOOGLE_SORT)}
            disabled={!ready}
            running={running[GOOGLE_SORT]}
            result={results[GOOGLE_SORT]}
            error={errors[GOOGLE_SORT]}
            onRun={() => run(GOOGLE_SORT, {})}
          >
            <p className="mb-3 text-sm text-gray-500">
              Top 20 customers by purchase (descending).
            </p>
          </Card>

          <Card
            title="Analytics"
            status={statusOf('analytics')}
            disabled={!ready}
            running={running.analytics}
            result={results.analytics}
            error={errors.analytics}
            onRun={() => run('analytics', {})}
          >
            <p className="mb-3 text-sm text-gray-500">
              Totals, average purchase, and customers grouped by city.
            </p>
          </Card>

          <Card
            title="Google Sheets Analytics"
            status={statusOf(GOOGLE_ANALYTICS)}
            disabled={!ready}
            running={running[GOOGLE_ANALYTICS]}
            result={results[GOOGLE_ANALYTICS]}
            error={errors[GOOGLE_ANALYTICS]}
            onRun={() => run(GOOGLE_ANALYTICS, {})}
          >
            <p className="mb-3 text-sm text-gray-500">
              Totals, average purchase, and customers grouped by city.
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}

export default App
