import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../api/auth'
import { friendlyError, getResult, useRuns } from '../api/runs'
import type { RunResult } from '../api/types'
import { ChartFrame } from '../charts/ChartFrame'
import { IntervalBars, type IntervalRow } from '../charts/IntervalBars'
import { whatChanged } from '../lib/changes'
import { fmtDate, fmtPct, fmtRange, fmtRoi, palette, title } from '../lib/format'

export default function Compare() {
  const { session } = useAuth()
  const { runs } = useRuns(session?.user.id)
  const [params, setParams] = useSearchParams()
  const finished = runs?.filter((r) => r.status === 'finished') ?? []
  const a = params.get('a') ?? finished[0]?.id ?? ''
  const b = params.get('b') ?? finished[1]?.id ?? ''
  const [results, setResults] = useState<Record<string, RunResult>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    for (const id of [a, b]) {
      if (!id || results[id]) continue
      getResult(id)
        .then((r) => r && setResults((prev) => ({ ...prev, [id]: r })))
        .catch((e) => setError(friendlyError(e)))
    }
  }, [a, b, results])

  if (!runs) return <p className="muted" role="status">Loading…</p>
  if (finished.length < 2)
    return (
      <div className="card">
        <h1>Compare runs</h1>
        <p className="mt-1 muted">You need two finished runs to compare. You have {finished.length}.</p>
        <Link to="/new" className="btn btn-primary mt-3">New run</Link>
      </div>
    )

  const ra = results[a]
  const rb = results[b]
  const nameOf = (id: string) => finished.find((r) => r.id === id)?.name ?? '?'
  const pick = (key: 'a' | 'b', value: string) => setParams({ a: key === 'a' ? value : a, b: key === 'b' ? value : b }, { replace: true })
  const select = (key: 'a' | 'b', value: string, label: string) => (
    <div>
      <label className="field" htmlFor={`sel-${key}`}>{label}</label>
      <select id={`sel-${key}`} className="input" value={value} onChange={(e) => pick(key, e.target.value)}>
        {finished.map((r) => <option key={r.id} value={r.id}>{r.name} ({fmtDate(r.created_at)})</option>)}
      </select>
    </div>
  )

  const names = ra && rb ? [...new Set([...ra.channels.map((c) => c.name), ...rb.channels.map((c) => c.name)])] : []
  const rows: IntervalRow[] = []
  names.forEach((n, i) => {
    const ca = ra?.channels.find((c) => c.name === n)
    const cb = rb?.channels.find((c) => c.name === n)
    if (ca) rows.push({ label: `${title(n)} · A`, ...ca.roi, color: palette(i) })
    if (cb) rows.push({ label: `${title(n)} · B`, ...cb.roi, color: palette(i), hollow: true })
  })
  const fitRows: [string, (r: RunResult) => string][] = [
    ['Convergence', (r) => title(r.diagnostics.verdict)],
    ['Worst R-hat', (r) => r.diagnostics.max_rhat.toFixed(3)],
    ['R²', (r) => fmtPct(r.fit.r2, 1)],
    ['Error in sample (MAPE)', (r) => `${r.fit.mape.toFixed(1)}%`],
    ['Error on unseen weeks', (r) => (r.fit.holdout_mape === null ? 'n/a' : `${r.fit.holdout_mape.toFixed(1)}%`)],
    ['Revenue driven by media', (r) => `${fmtPct(r.fit.media_share.median)} (${fmtPct(r.fit.media_share.low)} to ${fmtPct(r.fit.media_share.high)})`],
    ['Weeks', (r) => String(r.fit.weeks)],
  ]

  return (
    <div className="grid gap-4">
      <div>
        <p className="text-sm"><Link to="/runs">← My runs</Link></p>
        <h1>Compare two runs</h1>
      </div>
      <div className="card grid gap-3 sm:grid-cols-2">
        {select('a', a, 'Run A (solid)')}
        {select('b', b, 'Run B (dashed, hollow)')}
      </div>
      {error && <div className="notice notice-bad" role="alert">{error}</div>}
      {a === b && <div className="notice notice-warn">Both sides show the same run. Pick a different run for B.</div>}
      {ra && rb ? (
        <>
          <ChartFrame
            title="ROI ranges side by side"
            note={`A: ${nameOf(a)} (solid). B: ${nameOf(b)} (dashed, hollow). Dot = median, bar = 90% range.`}
            table={{
              caption: 'ROI per channel for both runs',
              header: ['Channel', 'A median', 'A 90% range', 'B median', 'B 90% range'],
              rows: names.map((n) => {
                const ca = ra.channels.find((c) => c.name === n)
                const cb = rb.channels.find((c) => c.name === n)
                return [title(n), ca ? fmtRoi(ca.roi.median) : '–', ca ? fmtRange(ca.roi.low, ca.roi.high) : '–', cb ? fmtRoi(cb.roi.median) : '–', cb ? fmtRange(cb.roi.low, cb.roi.high) : '–']
              }),
            }}
          >
            <IntervalBars ariaLabel="ROI per channel for run A and run B with 90% ranges" rows={rows} fmt={fmtRoi} reference={{ value: 1, label: 'break-even (1.0)' }} xLabel="ROI" />
          </ChartFrame>
          <section className="card" aria-labelledby="chg-h">
            <h2 id="chg-h" className="mb-2">What changed</h2>
            {a === b ? <p className="muted">Pick two different runs to see what changed.</p> : (
              <ul className="grid gap-1" style={{ listStyle: 'disc', paddingLeft: '1.2rem' }}>
                {whatChanged(ra.channels, rb.channels).map((t) => <li key={t}>{t}</li>)}
              </ul>
            )}
            <p className="text-sm muted mt-2">“Overlap” means the 90% ranges share some values, so the two runs do not clearly disagree.</p>
          </section>
          <section className="card" aria-labelledby="fit-h">
            <h2 id="fit-h" className="mb-2">Fit</h2>
            <div className="overflow-x-auto">
              <table className="data num">
                <caption className="sr-only">Fit quality for both runs</caption>
                <thead><tr><th scope="col">Measure</th><th scope="col">A: {nameOf(a)}</th><th scope="col">B: {nameOf(b)}</th></tr></thead>
                <tbody>{fitRows.map(([label, f]) => <tr key={label}><th scope="row" style={{ fontWeight: 500 }}>{label}</th><td>{f(ra)}</td><td>{f(rb)}</td></tr>)}</tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        !error && <p className="muted" role="status">Loading results…</p>
      )}
    </div>
  )
}
