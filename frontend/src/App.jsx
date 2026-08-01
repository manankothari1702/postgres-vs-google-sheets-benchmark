import { useEffect, useRef, useState } from 'react'

const API_URL = 'http://localhost:8000'

const BENCHMARK_VERSION = 'v1.1.1'

// History lives in this browser only. Older sessions fall off the end.
const HISTORY_KEY = 'benchmark-history'
const HISTORY_LIMIT = 20

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

// Dataset verification state, restated for the executive dashboard header.
const DATASET_STATUS = {
  idle: { label: 'Not verified', tone: 'neutral' },
  checking: { label: 'Verifying...', tone: 'info' },
  ready: { label: '✓ Verified', tone: 'positive' },
  mismatch: { label: '⚠ Mismatch', tone: 'warning' },
  error: { label: '⚠ Failed', tone: 'danger' },
}

const CHIP_TONES = {
  neutral: 'border-white/15 bg-white/5 text-slate-200',
  info: 'border-blue-400/30 bg-blue-400/10 text-blue-200',
  positive: 'border-green-400/30 bg-green-400/10 text-green-200',
  warning: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  danger: 'border-red-400/30 bg-red-400/10 text-red-200',
}

// The one-click workflows, in order. Each entry is only the wording for a step;
// the work itself stays in the handlers the Advanced buttons already call.
const PREPARE_STEPS = [
  {
    running: 'Generating CSV',
    done: 'CSV Generated',
    waiting: 'CSV',
    failed: 'CSV generation failed.',
    hint: 'Workflow stopped.',
  },
  {
    running: 'Loading PostgreSQL',
    done: 'PostgreSQL Loaded',
    waiting: 'PostgreSQL',
    failed: 'PostgreSQL import failed.',
    hint: 'Google Sheets was not started.',
  },
  {
    running: 'Loading Google Sheets',
    done: 'Google Sheets Loaded',
    waiting: 'Google Sheets',
    failed: 'Google Sheets import failed.',
    hint: 'CSV and PostgreSQL remain intact.',
  },
]

const RESET_STEPS = [
  {
    running: 'Resetting benchmark results',
    done: 'Benchmark Results Reset',
    waiting: 'Benchmark results',
    failed: 'Resetting benchmark results failed.',
    hint: 'Workflow stopped.',
  },
  {
    running: 'Clearing PostgreSQL',
    done: 'PostgreSQL Cleared',
    waiting: 'PostgreSQL',
    failed: 'Clearing PostgreSQL failed.',
    hint: 'Google Sheets was not started.',
  },
  {
    running: 'Clearing Google Sheets',
    done: 'Google Sheets Cleared',
    waiting: 'Google Sheets',
    failed: 'Clearing Google Sheets failed.',
    hint: 'PostgreSQL is already cleared.',
  },
]

const PRIMARY_BUTTON =
  'flex items-center gap-2 rounded px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50'

const MAINTENANCE_BUTTON =
  'flex items-center gap-2 rounded px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50'

const formatMs = (ms) => `${Math.round(ms).toLocaleString()} ms`

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

const formatTime = (iso) =>
  new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })

// Speedup = Google Sheets / PostgreSQL. Guarded so a zero or missing
// PostgreSQL timing never renders as Infinity or NaN.
const speedupOf = (postgres, google) => {
  if (!postgres || !google || !(postgres.durationMs > 0)) {
    return null
  }
  return google.durationMs / postgres.durationMs
}

// Null for an empty list, so a dashboard figure with nothing behind it yet
// renders an em dash instead of NaN.
const meanOf = (values) =>
  values.length === 0
    ? null
    : values.reduce((total, value) => total + value, 0) / values.length

// The engine with the lower average duration wins. Both engines need at
// least one completed benchmark before there is anything to compare. The hint
// restates the win as how much execution time the winner removed.
const winnerOf = (postgresAvg, googleAvg) => {
  if (postgresAvg === null || googleAvg === null) {
    return { value: 'Pending Benchmark', hint: 'Run both engines to compare' }
  }
  if (postgresAvg === googleAvg) {
    return { value: 'Tie', hint: 'Both engines averaged the same' }
  }
  const postgresWon = postgresAvg < googleAvg
  const [winnerAvg, loserAvg] = postgresWon
    ? [postgresAvg, googleAvg]
    : [googleAvg, postgresAvg]

  return {
    value: postgresWon ? 'PostgreSQL' : 'Google Sheets',
    hint: `${((1 - winnerAvg / loserAvg) * 100).toFixed(1)}% Lower Execution Time`,
    won: true,
  }
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
        <div
          aria-live="polite"
          className="mt-3 rounded border border-red-200 bg-red-50 p-3"
        >
          <p className="text-sm font-medium text-red-800">
            <span aria-hidden="true">❌</span> {title} failed
          </p>
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

function ReadinessBanner({ readiness, onVerify, busy }) {
  const { state, postgresRows, googleRows, message } = readiness

  const shell = {
    idle: 'border-gray-300 bg-white',
    checking: 'border-blue-300 bg-blue-50',
    ready: 'border-green-300 bg-green-50',
    mismatch: 'border-amber-300 bg-amber-50',
    error: 'border-red-300 bg-red-50',
  }[state]

  return (
    <div className={`mb-6 rounded-xl border p-6 shadow-md ${shell}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div aria-live="polite" className="text-sm">
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
              <p className="font-semibold text-green-800">
                <span aria-hidden="true">🟢</span> Benchmark Ready
              </p>
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
                <span aria-hidden="true">⚠</span> PostgreSQL:{' '}
                {postgresRows.toLocaleString()}
              </p>
              <p className="text-amber-900">
                <span aria-hidden="true">⚠</span> Google Sheets:{' '}
                {googleRows.toLocaleString()}
              </p>
              <p className="mt-1 font-semibold text-amber-900">
                Dataset mismatch. Import again before benchmarking.
              </p>
            </>
          )}

          {state === 'error' && (
            <>
              <p className="font-semibold text-red-800">
                <span aria-hidden="true">⚠</span> Verification failed
              </p>
              <p className="mt-1 text-red-700">{message}</p>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={onVerify}
          disabled={state === 'checking' || busy}
          className="rounded bg-gray-800 px-3 py-2 text-sm font-medium text-white hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state === 'ready' ? 'Re-verify Dataset' : 'Verify Dataset'}
        </button>
      </div>
    </div>
  )
}

function HeaderChip({ tone, label, children }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${CHIP_TONES[tone]}`}
    >
      <span className="opacity-60">{label}</span>
      {children}
    </span>
  )
}

function KpiCard({ label, value, hint, highlight, valueSize = 'text-2xl' }) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        highlight ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-gray-50'
      }`}
    >
      <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
        {label}
      </p>
      <p
        className={`mt-2 font-semibold tabular-nums ${valueSize} ${
          highlight ? 'text-green-700' : 'text-gray-900'
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-gray-500">{hint}</p>
    </div>
  )
}

function ExecutiveDashboard({ readiness, datasetSize, results }) {
  // Every figure is derived from what has finished so far: one completed
  // operation averages that operation alone, four average all four.
  const durationsOf = (engine) =>
    OPERATIONS.map((op) => results[op[engine]])
      .filter(Boolean)
      .map((result) => result.durationMs)

  const postgresDurations = durationsOf('postgres')
  const googleDurations = durationsOf('google')

  // A speedup needs both engines, so it only counts operations where the
  // PostgreSQL and Google Sheets runs have both completed.
  const speedups = OPERATIONS.map((op) =>
    speedupOf(results[op.postgres], results[op.google]),
  ).filter((speedup) => speedup !== null)

  const postgresAvg = meanOf(postgresDurations)
  const googleAvg = meanOf(googleDurations)
  const speedupAvg = meanOf(speedups)
  const winner = winnerOf(postgresAvg, googleAvg)

  const status = DATASET_STATUS[readiness.state]
  const coverage = (count) => `${count} of ${OPERATIONS.length} operations`

  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-md">
      <div className="bg-slate-900 px-6 py-5">
        <p className="text-[11px] font-semibold tracking-[0.2em] text-slate-400 uppercase">
          Executive Dashboard
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-white">
          PostgreSQL vs Google Sheets Benchmark
        </h1>
        <p className="mt-1 text-sm text-slate-300">
          Identical data, identical operations, executed against both engines.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <HeaderChip tone={status.tone} label="Dataset Status">
            {status.label}
          </HeaderChip>
          <HeaderChip tone="neutral" label="Operations">
            {OPERATIONS.length}
          </HeaderChip>
          <HeaderChip tone="neutral" label="Benchmarked">
            {coverage(speedups.length)}
          </HeaderChip>
          <HeaderChip tone="neutral" label="Version">
            {BENCHMARK_VERSION}
          </HeaderChip>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          label="Dataset Size"
          value={datasetSize === null ? '—' : datasetSize.toLocaleString()}
          hint="Customers"
        />
        <KpiCard
          label="PostgreSQL Avg"
          value={postgresAvg === null ? '—' : formatMs(postgresAvg)}
          hint={coverage(postgresDurations.length)}
        />
        <KpiCard
          label="Google Avg"
          value={googleAvg === null ? '—' : formatMs(googleAvg)}
          hint={coverage(googleDurations.length)}
        />
        <KpiCard
          label={
            <>
              <span aria-hidden="true">🚀</span> Average Speedup
            </>
          }
          value={speedupAvg === null ? '—' : `${speedupAvg.toFixed(1)}× Faster`}
          hint={coverage(speedups.length)}
          valueSize="text-xl"
        />
        <KpiCard
          label={
            <>
              <span aria-hidden="true">🏆</span> Overall Winner
            </>
          }
          value={winner.value}
          hint={winner.hint}
          highlight={winner.won}
          valueSize="text-xl"
        />
      </div>

      <p className="border-t border-gray-100 px-6 py-3 text-xs text-gray-500">
        Averages cover completed benchmarks only and update as each operation
        finishes. Speedup is Google Sheets duration ÷ PostgreSQL duration.
      </p>
    </section>
  )
}

// The live checklist shared by the dataset and maintenance workflows. `state`
// is { index, failed }, where index is the step in progress or steps.length
// once every step has finished. Nothing here is timed: the parent advances the
// index only when a real step resolves.
function WorkflowProgress({ steps, state, running, done, children }) {
  const finished = !state.failed && state.index === steps.length

  return (
    <div
      aria-live="polite"
      className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4"
    >
      <p className="text-sm font-semibold text-gray-900">
        {state.failed && (
          <>
            <span aria-hidden="true">❌</span> {steps[state.index].failed}
          </>
        )}
        {!state.failed &&
          (finished ? (
            <>
              <span aria-hidden="true">✅</span> {done}
            </>
          ) : (
            running
          ))}
      </p>

      <ul className="mt-2 space-y-1 text-sm">
        {steps.map((step, index) => {
          if (index < state.index) {
            return (
              <li key={step.done} className="text-green-700">
                <span aria-hidden="true">✓</span> {step.done}
              </li>
            )
          }

          if (index > state.index) {
            return (
              <li key={step.done} className="text-gray-400">
                Waiting... {step.waiting}
              </li>
            )
          }

          return state.failed ? (
            <li key={step.done} className="text-red-700">
              <span aria-hidden="true">❌</span> {step.waiting} — {step.hint}
            </li>
          ) : (
            <li key={step.done} className="flex items-center gap-2 text-blue-700">
              <Spinner />
              {step.running}
            </li>
          )
        })}
      </ul>

      {finished && children}
    </div>
  )
}

function MaintenanceStatus({ status }) {
  // Null until an import, a verification, or a maintenance action has said
  // something about the engine, so an unknown state is never shown as Empty.
  const engineLabel = (state) => {
    if (state === null) return { label: 'Not checked', tone: 'text-gray-400' }
    return state
      ? { label: 'Ready', tone: 'text-green-700' }
      : { label: 'Empty', tone: 'text-gray-500' }
  }

  const postgres = engineLabel(status.postgres)
  const google = engineLabel(status.google)
  const last = status.last

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-md">
      <h2 className="text-lg font-semibold text-gray-900">Maintenance Status</h2>

      <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
            PostgreSQL
          </p>
          <p className={`mt-1 text-sm font-medium ${postgres.tone}`}>
            {postgres.label}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
            Google Sheets
          </p>
          <p className={`mt-1 text-sm font-medium ${google.tone}`}>
            {google.label}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
            Last Action
          </p>
          <p className="mt-1 text-sm font-medium text-gray-900">
            {last ? last.action : '—'}
          </p>
          {last && (
            <p className="text-xs text-gray-500">
              {new Date(last.at).toDateString() === new Date().toDateString()
                ? 'Today'
                : formatDate(last.at)}{' '}
              · {formatTime(last.at)}
            </p>
          )}
        </div>
        <div>
          <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
            Rows Removed
          </p>
          <p className="mt-1 text-sm font-medium text-gray-900">
            {last && last.rowsRemoved !== null
              ? last.rowsRemoved.toLocaleString()
              : '—'}
          </p>
        </div>
      </div>
    </div>
  )
}

function BenchmarkHistory({ history }) {
  return (
    <section className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-md">
      <h2 className="text-lg font-semibold text-gray-900">Benchmark History</h2>
      <p className="mt-1 mb-5 text-sm text-gray-500">
        Automatically saves completed benchmark sessions.
      </p>

      {history.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center">
          <p className="text-sm font-medium text-gray-700">
            Run your first benchmark.
          </p>
          <p className="mt-1 text-sm text-gray-500">
            Completed benchmark sessions will automatically appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {history.map((entry, index) => (
            <details
              key={entry.id}
              className={`rounded-lg border p-4 ${
                index === 0
                  ? 'border-green-300 bg-green-50'
                  : 'border-gray-200 bg-gray-50'
              }`}
            >
              <summary
                className="cursor-pointer list-none"
                aria-label={`View details for run ${entry.run}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">
                      Run #{entry.run}
                    </span>
                    {index === 0 && (
                      <span className="rounded-full bg-green-600 px-2 py-0.5 text-[11px] font-medium text-white">
                        Current Session
                      </span>
                    )}
                    <span className="rounded-full border border-gray-300 px-2 py-0.5 text-[11px] text-gray-600">
                      {entry.version}
                    </span>
                  </div>
                  <span className="rounded-full border border-green-300 bg-white px-2 py-0.5 text-xs font-medium text-green-700">
                    {entry.winner === 'Tie' ? (
                      'Tie'
                    ) : (
                      <>
                        <span aria-hidden="true">🏆</span> Winner:{' '}
                        {entry.winner}
                      </>
                    )}
                  </span>
                </div>

                <p className="mt-1 text-xs text-gray-500">
                  {formatDate(entry.timestamp)} · {formatTime(entry.timestamp)} ·{' '}
                  {entry.datasetSize === null
                    ? 'Dataset size unknown'
                    : `${entry.datasetSize.toLocaleString()} rows`}
                </p>

                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <p className="text-sm text-gray-700">
                    Average speedup{' '}
                    <span className="font-semibold text-green-700">
                      {entry.averageSpeedup === null
                        ? '—'
                        : `${entry.averageSpeedup.toFixed(1)}×`}
                    </span>
                  </p>
                  <p className="text-sm text-gray-700">
                    PostgreSQL avg{' '}
                    <span className="font-semibold text-gray-900">
                      {formatMs(entry.postgresAverage)}
                    </span>
                  </p>
                  <p className="text-sm text-gray-700">
                    Google avg{' '}
                    <span className="font-semibold text-gray-900">
                      {formatMs(entry.googleAverage)}
                    </span>
                  </p>
                </div>

                <span className="mt-3 inline-block text-xs font-medium text-blue-700">
                  View Details
                </span>
              </summary>

              <div className="mt-3 overflow-x-auto border-t border-gray-200 pt-3">
                <table className="w-full text-left text-xs">
                  <thead className="text-gray-500">
                    <tr>
                      <th className="px-2 py-1 font-medium">Operation</th>
                      <th className="px-2 py-1 font-medium">PostgreSQL</th>
                      <th className="px-2 py-1 font-medium">Google Sheets</th>
                      <th className="px-2 py-1 font-medium">Speedup</th>
                    </tr>
                  </thead>
                  <tbody>
                    {OPERATIONS.map((op) => {
                      // Keyed by the PostgreSQL operation name: search,
                      // filter, sort, analytics.
                      const timing = entry.operations?.[op.postgres]

                      return (
                        <tr
                          key={op.label}
                          className="border-t border-gray-200 text-gray-700"
                        >
                          <td className="px-2 py-1 font-medium text-gray-900">
                            {op.label}
                          </td>
                          <td className="px-2 py-1">
                            {timing ? formatMs(timing.postgresMs) : '—'}
                          </td>
                          <td className="px-2 py-1">
                            {timing ? formatMs(timing.googleMs) : '—'}
                          </td>
                          <td className="px-2 py-1 font-medium text-green-700">
                            {timing && timing.speedup !== null
                              ? `${timing.speedup.toFixed(1)}×`
                              : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-gray-400">
        Sessions are stored in this browser only. The latest {HISTORY_LIMIT} are
        kept.
      </p>
    </section>
  )
}

function BenchmarkMethodology() {
  return (
    <details className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-md">
      <summary className="cursor-pointer list-none text-lg font-semibold text-gray-900">
        Benchmark Methodology
      </summary>

      <div className="mt-4 space-y-4 text-sm text-gray-700">
        <div>
          <SectionHeading>Dataset</SectionHeading>
          <p>
            100,000 identical customer records by default, generated once and
            imported into both engines.
          </p>
        </div>

        <div>
          <SectionHeading>Operations</SectionHeading>
          <ul className="list-inside list-disc space-y-1">
            <li>Search — substring match across name, email, phone, and city.</li>
            <li>Filter — city substring combined with an exact status.</li>
            <li>Sort — top 20 customers by purchase, descending.</li>
            <li>
              Analytics — totals, average purchase, and customers grouped by
              city.
            </li>
          </ul>
        </div>

        <div>
          <SectionHeading>Timing</SectionHeading>
          <ul className="list-inside list-disc space-y-1">
            <li>PostgreSQL measures SQL execution only.</li>
            <li>Google Sheets measures Apps Script execution only.</li>
            <li>Network latency is excluded.</li>
          </ul>
        </div>

        <div>
          <SectionHeading>Fairness</SectionHeading>
          <p>
            Both engines operate on identical datasets. The dataset check
            compares the row count held by each engine before benchmarking is
            allowed.
          </p>
        </div>

        <div>
          <SectionHeading>Benchmark Version</SectionHeading>
          <p>{BENCHMARK_VERSION}</p>
        </div>

        <div>
          <SectionHeading>Purpose</SectionHeading>
          <p>
            Demonstrate database performance differences on identical workloads.
          </p>
        </div>
      </div>
    </details>
  )
}

function AboutProject() {
  return (
    <section className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-md">
      <h2 className="text-lg font-semibold text-gray-900">
        About This Project
      </h2>
      <div className="mt-3 space-y-3 text-sm text-gray-700">
        <p>
          This benchmark compares PostgreSQL and Google Sheets using identical
          datasets and identical operations.
        </p>
        <p>
          The goal is to demonstrate the scalability difference between a
          relational database and a spreadsheet-based solution.
        </p>
        <p>Both systems execute the same workload.</p>
      </div>
    </section>
  )
}

function BenchmarkNotes() {
  const notes = [
    'Same dataset',
    'Same operations',
    'Same search logic',
    'Same filtering logic',
    'Same sorting logic',
    'Same analytics',
    'Google timings measure Apps Script execution only',
    'PostgreSQL timings measure SQL execution only',
    'Network latency excluded',
    `Benchmark version ${BENCHMARK_VERSION}`,
  ]

  return (
    <section className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-md">
      <h2 className="text-lg font-semibold text-gray-900">Benchmark Notes</h2>
      <p className="mt-1 text-sm text-gray-500">
        What both engines share, and what each timing does and does not include.
      </p>

      <ul className="mt-4 grid gap-x-6 gap-y-2 text-sm text-gray-700 sm:grid-cols-2">
        {notes.map((note) => (
          <li key={note} className="flex items-start gap-2">
            <span aria-hidden="true" className="font-semibold text-green-600">
              ✓
            </span>
            {note}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Footer() {
  return (
    <footer className="mt-8 border-t border-gray-200 pt-6 pb-2">
      <p className="text-sm font-semibold text-gray-900">
        PostgreSQL vs Google Sheets Benchmark
      </p>

      <dl className="mt-4 grid gap-4 text-sm text-gray-600 sm:grid-cols-3">
        <div>
          <dt className="text-[11px] font-semibold tracking-wide text-gray-400 uppercase">
            Version
          </dt>
          <dd className="mt-1">{BENCHMARK_VERSION}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold tracking-wide text-gray-400 uppercase">
            Built With
          </dt>
          <dd className="mt-1">
            React · FastAPI · PostgreSQL · Google Apps Script · Tailwind CSS
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold tracking-wide text-gray-400 uppercase">
            Purpose
          </dt>
          <dd className="mt-1">Educational Benchmark</dd>
        </div>
      </dl>
    </footer>
  )
}

// One horizontal bar. Mounts at 0% and transitions to its real width, so a
// bar animates both on its first paint and whenever the scale shifts under it.
function Bar({ label, percent, tone, value }) {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setWidth(percent))
    return () => cancelAnimationFrame(frame)
  }, [percent])

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 shrink-0 text-gray-500">{label}</span>
      {/* The label and the value beside it carry the reading; the bar is
          decoration on top of them. */}
      <div
        aria-hidden="true"
        className="h-3 min-w-0 flex-1 rounded-full bg-gray-100"
      >
        <div
          className={`h-3 rounded-full transition-[width] duration-700 ease-out ${tone}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="w-20 shrink-0 text-right font-medium text-gray-700 tabular-nums">
        {value}
      </span>
    </div>
  )
}

function PerformanceVisualization({ results }) {
  // Only operations where both engines finished can be drawn: a bar pair with
  // one side missing has nothing to compare, and no speedup to scale.
  const pairs = OPERATIONS.filter(
    (op) => results[op.postgres] && results[op.google],
  ).map((op) => ({
    label: op.label,
    postgresMs: results[op.postgres].durationMs,
    googleMs: results[op.google].durationMs,
    speedup: speedupOf(results[op.postgres], results[op.google]),
  }))

  // Both charts scale against the largest value currently on screen, so widths
  // rescale as later operations finish.
  const maxDuration = Math.max(
    ...pairs.flatMap((pair) => [pair.postgresMs, pair.googleMs]),
    0,
  )
  const maxSpeedup = Math.max(...pairs.map((pair) => pair.speedup ?? 0), 0)

  // Durations span three orders of magnitude, so a linear bar leaves the
  // PostgreSQL side under a pixel wide. Only the drawn width is logarithmic:
  // the label beside every bar still reports the exact measured duration.
  const durationWidth = (ms) =>
    maxDuration > 0 ? (Math.log(ms + 1) / Math.log(maxDuration + 1)) * 100 : 0

  return (
    <section className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-md">
      <h2 className="text-lg font-semibold text-gray-900">
        Performance Visualization
      </h2>
      <p className="mt-1 mb-5 text-sm text-gray-500">
        Visual comparison of PostgreSQL and Google Sheets execution times across
        all benchmark operations.
      </p>

      {pairs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center">
          <p className="text-sm font-medium text-gray-700">
            Complete benchmark operations to generate performance
            visualizations.
          </p>
          <p className="mt-1 text-sm text-gray-500">
            Each operation is charted once both engines have finished it.
          </p>
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <SectionHeading>Execution Time Comparison</SectionHeading>
            <div className="space-y-4">
              {pairs.map((pair) => (
                <div key={pair.label}>
                  <p className="mb-1.5 text-sm font-medium text-gray-900">
                    {pair.label}
                  </p>
                  <div className="space-y-1.5">
                    <Bar
                      label="PostgreSQL"
                      percent={durationWidth(pair.postgresMs)}
                      tone="bg-green-600"
                      value={formatMs(pair.postgresMs)}
                    />
                    <Bar
                      label="Google Sheets"
                      percent={durationWidth(pair.googleMs)}
                      tone="bg-gray-400"
                      value={formatMs(pair.googleMs)}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-gray-400">
              Bar lengths use logarithmic scaling for readability. Exact
              execution times are shown beside each bar.
            </p>
          </div>

          <div>
            <SectionHeading>Speedup Comparison</SectionHeading>
            <div className="space-y-3">
              {pairs.map((pair) => (
                <Bar
                  key={pair.label}
                  label={pair.label}
                  percent={
                    maxSpeedup > 0 ? ((pair.speedup ?? 0) / maxSpeedup) * 100 : 0
                  }
                  tone="bg-green-600"
                  value={
                    pair.speedup === null ? '—' : `${pair.speedup.toFixed(1)}×`
                  }
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
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

  // null until the matching one-click workflow runs. `index` is the step in
  // progress, or the step count once all three have finished.
  const [prepare, setPrepare] = useState(null)
  const [reset, setReset] = useState(null)

  const [maintenanceAction, setMaintenanceAction] = useState(null)
  const [maintenanceMessage, setMaintenanceMessage] = useState(null)
  const [maintenanceError, setMaintenanceError] = useState(null)

  // null means nothing has reported on that engine yet.
  const [maintenanceStatus, setMaintenanceStatus] = useState({
    postgres: null,
    google: null,
    last: null,
  })

  const [history, setHistory] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(HISTORY_KEY))
      return Array.isArray(stored) ? stored : []
    } catch {
      return []
    }
  })

  const ready = readiness.state === 'ready'

  // Each workflow labels its own button from its own state; `busy` is the
  // shared lock, so neither workflow can start while the other is in flight.
  const preparing = generating || importing || importingGoogle
  const resetting = maintenanceAction !== null
  const busy = preparing || resetting

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

  // Everything measured against the current dataset: timings, comparisons,
  // charts, dashboard averages, operation status, and failures.
  const resetResults = () => {
    setResults({})
    setErrors({})
  }

  // Changing the data invalidates both the verification and any timings
  // collected against the previous dataset.
  const resetBenchmarks = () => {
    setReadiness({ state: 'idle' })
    resetResults()
  }

  const handleGenerate = async () => {
    setGenerating(true)
    setError(null)
    setCsvResult(null)
    setImportResult(null)
    resetBenchmarks()

    try {
      setCsvResult(await postJson('generate', { rows: Number(rows) }))
      return true
    } catch (err) {
      setError(err.message)
      return false
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
      setMaintenanceStatus((prev) => ({ ...prev, postgres: true }))
      return true
    } catch (err) {
      setError(err.message)
      return false
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
      setMaintenanceStatus((prev) => ({ ...prev, google: true }))
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setImportingGoogle(false)
    }
  }

  // One click, the three handlers above, in order. Each reports whether it
  // succeeded, so a failure stops the workflow exactly where it broke and
  // leaves every completed step intact.
  const handlePrepare = async () => {
    const steps = [handleGenerate, handleImport, handleImportGoogle]

    for (let index = 0; index < steps.length; index += 1) {
      setPrepare({ index, failed: false })

      if (!(await steps[index]())) {
        setPrepare({ index, failed: true })
        return
      }
    }

    setPrepare({ index: steps.length, failed: false })
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
      setMaintenanceStatus((prev) => ({
        ...prev,
        postgres: postgres.totalRows > 0,
        google: google.totalRows > 0,
      }))
    } catch (err) {
      setReadiness({ state: 'error', message: err.message })
    }
  }

  // Stamps the status card: what ran, when, how much it removed, and which
  // engines the action emptied.
  const recordMaintenance = (action, rowsRemoved, engines) =>
    setMaintenanceStatus((prev) => ({
      ...prev,
      ...engines,
      last: { action, at: new Date().toISOString(), rowsRemoved },
    }))

  // Frontend state only: the CSV, both engines' data, and the dataset
  // verification all survive.
  const handleResetResults = () => {
    resetResults()
    setMaintenanceError(null)
    setMaintenanceMessage('✓ Benchmark results reset.')
    recordMaintenance('Reset Results', null, {})
  }

  // The three destructive actions share one shape: confirm, clear, then drop
  // the verification and the timings that the deleted data produced. A failure
  // leaves the existing benchmark results on screen.
  const runMaintenance = async (action, work) => {
    if (!window.confirm('This will permanently remove benchmark data. Continue?')) {
      return
    }

    setMaintenanceAction(action)
    setMaintenanceMessage(null)
    setMaintenanceError(null)

    try {
      const message = await work()
      setReadiness({ state: 'idle' })
      resetResults()
      setMaintenanceMessage(message)
    } catch (err) {
      setMaintenanceError(err.message)
    } finally {
      setMaintenanceAction(null)
    }
  }

  // The two clearing calls, shared by the individual buttons, Clear Everything,
  // and the one-click environment reset. Each returns how many rows it removed.
  const clearPostgres = async () => {
    const data = await postJson('maintenance/postgres/clear')
    // The import receipt describes rows that no longer exist.
    setImportResult(null)
    recordMaintenance('Clear PostgreSQL', data.rowsRemoved, { postgres: false })
    return data.rowsRemoved
  }

  const clearGoogle = async () => {
    const data = await postJson('maintenance/google/clear')
    setGoogleResult(null)
    recordMaintenance('Clear Google Sheets', data.rowsRemoved, { google: false })
    return data.rowsRemoved
  }

  const handleClearPostgres = () =>
    runMaintenance('postgres', async () => {
      const removed = await clearPostgres()
      return `✓ PostgreSQL cleared successfully. ${removed.toLocaleString()} rows removed.`
    })

  const handleClearGoogle = () =>
    runMaintenance('google', async () => {
      const removed = await clearGoogle()
      return `✓ Google Sheets cleared successfully. ${removed.toLocaleString()} rows removed.`
    })

  const handleClearEverything = () =>
    runMaintenance('everything', async () => {
      const postgres = await clearPostgres()
      const google = await clearGoogle()
      recordMaintenance('Clear Everything', postgres + google, {
        postgres: false,
        google: false,
      })
      return 'Application reset successfully.\n✓ PostgreSQL cleared\n✓ Google Sheets cleared\n✓ Benchmark results reset\nReady for a new benchmark.'
    })

  // One click: reset the results, then clear each engine, in order. Uses the
  // same primitives as the Advanced buttons and stops at the first failure,
  // leaving everything the earlier steps did in place.
  const handleResetEnvironment = async () => {
    if (!window.confirm('This will permanently remove benchmark data. Continue?')) {
      return
    }

    const steps = [async () => handleResetResults(), clearPostgres, clearGoogle]

    setMaintenanceAction('environment')
    setMaintenanceMessage(null)
    setMaintenanceError(null)

    let removed = 0

    try {
      for (let index = 0; index < steps.length; index += 1) {
        setReset({ index, failed: false })

        try {
          removed += (await steps[index]()) || 0
        } catch (err) {
          setReset({ index, failed: true })
          setMaintenanceError(err.message)
          return
        }
      }

      // Both engines are empty, so the verification and every timing measured
      // against them no longer hold.
      setReadiness({ state: 'idle' })
      resetResults()
      recordMaintenance('Reset Benchmark Environment', removed, {
        postgres: false,
        google: false,
      })
      setReset({ index: steps.length, failed: false })
    } finally {
      setMaintenanceAction(null)
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

  // Most trustworthy source first: the verified row count, then what actually
  // landed in PostgreSQL, then the generated CSV.
  const datasetSize =
    readiness.postgresRows ?? importResult?.rows ?? csvResult?.rows ?? null

  // A session is one full sweep: all four operations on both engines. The
  // signature of the eight timings keeps a finished sweep from being saved
  // twice, and is cleared as soon as the sweep is no longer complete.
  const savedSession = useRef(null)

  useEffect(() => {
    // Part way through a sweep the results map holds a mix of the previous
    // timings and the new ones. Waiting for every operation to settle keeps
    // those intermediate states out of the history.
    if (Object.values(running).some(Boolean)) {
      return
    }

    const timings = OPERATIONS.map((op) => ({
      key: op.postgres,
      postgres: results[op.postgres],
      google: results[op.google],
    }))

    if (!timings.every((timing) => timing.postgres && timing.google)) {
      savedSession.current = null
      return
    }

    const signature = timings
      .map((timing) => `${timing.postgres.durationMs}:${timing.google.durationMs}`)
      .join('|')

    if (signature === savedSession.current) {
      return
    }
    savedSession.current = signature

    // The same figures the dashboard shows, recorded as they stood when the
    // sweep finished.
    const postgresAverage = meanOf(
      timings.map((timing) => timing.postgres.durationMs),
    )
    const googleAverage = meanOf(
      timings.map((timing) => timing.google.durationMs),
    )
    const speedups = timings
      .map((timing) => speedupOf(timing.postgres, timing.google))
      .filter((speedup) => speedup !== null)

    const timestamp = new Date().toISOString()

    setHistory((previous) => {
      const run = (previous[0]?.run ?? 0) + 1
      const entry = {
        id: `${timestamp}-${run}`,
        run,
        timestamp,
        version: BENCHMARK_VERSION,
        datasetSize,
        winner: winnerOf(postgresAverage, googleAverage).value,
        averageSpeedup: meanOf(speedups),
        postgresAverage,
        googleAverage,
        operations: Object.fromEntries(
          timings.map((timing) => [
            timing.key,
            {
              postgresMs: timing.postgres.durationMs,
              googleMs: timing.google.durationMs,
              speedup: speedupOf(timing.postgres, timing.google),
            },
          ]),
        ),
      }

      return [entry, ...previous].slice(0, HISTORY_LIMIT)
    })
  }, [results, running, datasetSize])

  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
    } catch {
      // A full or unavailable LocalStorage costs the history, not the session.
    }
  }, [history])

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
        <ExecutiveDashboard
          readiness={readiness}
          datasetSize={datasetSize}
          results={results}
        />

        <PerformanceVisualization results={results} />

        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-md">
          <h2 className="text-lg font-semibold text-gray-900">Dataset Setup</h2>
          <p className="mt-1 mb-4 text-sm text-gray-500">
            Generate one CSV, then import it into both engines so they hold
            identical rows.
          </p>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label
                htmlFor="rows"
                className="mb-1 block text-sm font-medium text-gray-700"
              >
                Number of rows
              </label>
              <input
                id="rows"
                type="number"
                min="1"
                value={rows}
                onChange={(e) => setRows(e.target.value)}
                className="w-40 rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={handlePrepare}
              disabled={busy}
              aria-busy={preparing}
              className={`${PRIMARY_BUTTON} bg-blue-600 hover:bg-blue-700`}
            >
              {preparing ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <span aria-hidden="true">🚀</span>
              )}
              {preparing ? 'Preparing...' : 'Prepare Benchmark Dataset'}
            </button>
          </div>

          {prepare && (
            <WorkflowProgress
              steps={PREPARE_STEPS}
              state={prepare}
              running="Preparing Benchmark Dataset..."
              done="Benchmark Dataset Ready"
            >
              <p className="mt-2 text-sm text-gray-700">
                {(importResult?.rows ?? csvResult?.rows ?? 0).toLocaleString()}{' '}
                rows imported into both engines. Ready for verification.
              </p>
            </WorkflowProgress>
          )}

          <details className="mt-4">
            <summary className="cursor-pointer list-none text-sm font-medium text-gray-600">
              Advanced <span aria-hidden="true">▼</span>
            </summary>

            <p className="mt-2 text-xs text-gray-500">
              The individual steps, kept for debugging. Preparing the dataset
              runs all three in order.
            </p>

            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setPrepare(null)
                  handleGenerate()
                }}
                disabled={busy}
                className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {generating ? 'Generating CSV...' : 'Generate CSV'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPrepare(null)
                  handleImport()
                }}
                disabled={busy}
                className="rounded bg-gray-800 px-3 py-2 text-sm font-medium text-white hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {importing ? 'Importing...' : 'Load PostgreSQL'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPrepare(null)
                  handleImportGoogle()
                }}
                disabled={busy}
                className="rounded bg-green-700 px-3 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {importingGoogle ? 'Importing...' : 'Load Google Sheets'}
              </button>
            </div>
          </details>

          <div aria-live="polite">
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          </div>

          {/* Per-step receipts belong to the Advanced buttons. After a
              one-click run the progress block above reports all three. */}
          {prepare === null && (
            <>
              {csvResult && (
                <p className="mt-3 text-sm text-green-700">
                  CSV generated successfully (
                  {csvResult.rows.toLocaleString()} rows)
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
            </>
          )}
        </div>

        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-md">
          <h2 className="text-lg font-semibold text-gray-900">Maintenance</h2>
          <p className="mt-1 mb-4 text-sm text-gray-500">
            Reset benchmark results or clear benchmark data before starting a
            new demonstration.
          </p>

          <button
            type="button"
            onClick={handleResetEnvironment}
            disabled={busy}
            aria-busy={resetting}
            className={`${PRIMARY_BUTTON} bg-red-700 hover:bg-red-800`}
          >
            {resetting ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <span aria-hidden="true">🧹</span>
            )}
            {resetting ? 'Resetting...' : 'Reset Benchmark Environment'}
          </button>

          {reset && (
            <WorkflowProgress
              steps={RESET_STEPS}
              state={reset}
              running="Resetting Benchmark Environment..."
              done="Benchmark Environment Reset"
            >
              <p className="mt-2 text-sm text-gray-700">
                Ready for a new benchmark.
              </p>
            </WorkflowProgress>
          )}

          <details className="mt-4">
            <summary className="cursor-pointer list-none text-sm font-medium text-gray-600">
              Advanced <span aria-hidden="true">▼</span>
            </summary>

            <p className="mt-2 text-xs text-gray-500">
              The individual actions, kept for debugging. Resetting the
              environment runs the first three in order.
            </p>

            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setReset(null)
                  handleResetResults()
                }}
                disabled={busy}
                className={`${MAINTENANCE_BUTTON} bg-gray-800 hover:bg-gray-900`}
              >
                Reset Results
              </button>
              <button
                type="button"
                onClick={() => {
                  setReset(null)
                  handleClearPostgres()
                }}
                disabled={busy}
                aria-busy={maintenanceAction === 'postgres'}
                className={`${MAINTENANCE_BUTTON} bg-red-600 hover:bg-red-700`}
              >
                {maintenanceAction === 'postgres' && (
                  <Spinner className="h-4 w-4" />
                )}
                {maintenanceAction === 'postgres'
                  ? 'Clearing...'
                  : 'Clear PostgreSQL'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setReset(null)
                  handleClearGoogle()
                }}
                disabled={busy}
                aria-busy={maintenanceAction === 'google'}
                className={`${MAINTENANCE_BUTTON} bg-red-600 hover:bg-red-700`}
              >
                {maintenanceAction === 'google' && <Spinner className="h-4 w-4" />}
                {maintenanceAction === 'google'
                  ? 'Clearing...'
                  : 'Clear Google Sheets'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setReset(null)
                  handleClearEverything()
                }}
                disabled={busy}
                aria-busy={maintenanceAction === 'everything'}
                className={`${MAINTENANCE_BUTTON} bg-red-800 hover:bg-red-900`}
              >
                {maintenanceAction === 'everything' && (
                  <Spinner className="h-4 w-4" />
                )}
                {maintenanceAction === 'everything'
                  ? 'Clearing...'
                  : 'Clear Everything'}
              </button>
            </div>
          </details>

          <div aria-live="polite">
            {maintenanceError && (
              <p className="mt-3 text-sm text-red-600">
                <span aria-hidden="true">❌</span> {maintenanceError}
              </p>
            )}

            {/* The progress block reports a one-click run; these messages
                belong to the Advanced buttons. */}
            {reset === null && maintenanceMessage && (
              <p className="mt-3 text-sm whitespace-pre-line text-green-700">
                {maintenanceMessage}
              </p>
            )}
          </div>
        </div>

        <MaintenanceStatus status={maintenanceStatus} />

        <ReadinessBanner
          readiness={readiness}
          onVerify={handleVerify}
          busy={busy}
        />

        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-md">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-gray-900">
              Benchmark Summary
            </h2>
            <button
              type="button"
              onClick={handleExport}
              disabled={completedPairs.length === 0}
              aria-label="Export benchmark results as JSON"
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
            disabled={!ready || busy}
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
              className="mb-3 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </Card>

          <Card
            title="Google Sheets Search"
            status={statusOf(GOOGLE_SEARCH)}
            disabled={!ready || busy}
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
              className="mb-3 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </Card>

          <Card
            title="Filter"
            status={statusOf('filter')}
            disabled={!ready || busy}
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
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
              <input
                type="text"
                value={status}
                onChange={(e) => changeStatus(e.target.value)}
                placeholder="status"
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
          </Card>

          <Card
            title="Google Sheets Filter"
            status={statusOf(GOOGLE_FILTER)}
            disabled={!ready || busy}
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
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
              <input
                type="text"
                value={status}
                onChange={(e) => changeStatus(e.target.value)}
                placeholder="status"
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
          </Card>

          <Card
            title="Sort"
            status={statusOf('sort')}
            disabled={!ready || busy}
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
            disabled={!ready || busy}
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
            disabled={!ready || busy}
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
            disabled={!ready || busy}
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

        <div className="mt-6">
          <BenchmarkHistory history={history} />
          <BenchmarkMethodology />
          <AboutProject />
          <BenchmarkNotes />
          <Footer />
        </div>
      </div>
    </div>
  )
}

export default App
