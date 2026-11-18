import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../api/auth'
import { getVerdicts, MAX_FINISHED, useRuns } from '../api/runs'
import type { Run } from '../api/types'
import { VerdictBadge } from '../components/ResultsView'
import { Skeleton } from '../components/Skeleton'
import { NotifyMe } from '../components/NotifyMe'
import { ServerNotice } from '../components/ServerNotice'
import { fmtDate, fmtPct } from '../lib/format'

export function StatusBadge({ run }: { run: Run }) {
  const map = {
    queued: ['badge-info', '◷ Queued'],
    running: ['badge-info', `▶ Running ${fmtPct(run.progress)}`],
    finished: ['badge-ok', '✓ Finished'],
    failed: ['badge-bad', '✕ Failed'],
    cancelled: ['', '– Cancelled'],
  } as const
  const [cls, label] = map[run.status]
  return <span className={`badge ${cls}`}>{run.status === 'running' && run.cancel_requested ? 'Cancelling…' : label}</span>
}

export default function MyRuns() {
  const { session } = useAuth()
  const { runs, error } = useRuns(session?.user.id)
  const [verdicts, setVerdicts] = useState<Record<string, string>>({})
  const finishedCount = runs?.filter((r) => r.status === 'finished').length ?? 0
  useEffect(() => {
    getVerdicts().then(setVerdicts).catch(() => undefined)
  }, [finishedCount])
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const shown = runs?.filter((r) => !needle || `${r.name} ${r.notes ?? ''} ${(r.tags ?? []).join(' ')}`.toLowerCase().includes(needle))
  const active = shown?.filter((r) => r.status === 'queued' || r.status === 'running') ?? []
  const finished = shown?.filter((r) => r.status === 'finished') ?? []
  const other = shown?.filter((r) => r.status === 'failed' || r.status === 'cancelled') ?? []
  const allFinished = runs?.filter((r) => r.status === 'finished') ?? []
  const oldest = allFinished[allFinished.length - 1]

  const table = (rows: Run[], caption: string) => (
    <div className="overflow-x-auto">
      <table className="data">
        <caption className="sr-only">{caption}</caption>
        <thead><tr><th scope="col">Name</th><th scope="col">Submitted</th><th scope="col">Status</th><th scope="col">Convergence</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row" style={{ fontWeight: 600, whiteSpace: 'normal' }}><Link to={`/runs/${r.id}`}>{r.name}</Link>{r.tags?.map((t) => <span key={t} className="badge ml-1">{t}</span>)}{r.notes && <div className="text-sm muted" style={{ fontWeight: 400 }}>{r.notes.length > 90 ? `${r.notes.slice(0, 90)}…` : r.notes}</div>}</th>
              <td className="num">{fmtDate(r.created_at)}</td>
              <td><StatusBadge run={r} /></td>
              <td>{r.status === 'finished' ? <VerdictBadge verdict={verdicts[r.id]} /> : <span className="muted">–</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1>My runs</h1>
        <div className="flex flex-wrap gap-2">
          {allFinished.length >= 2 && <Link to="/compare" className="btn">Compare two runs</Link>}
          <Link to="/new" className="btn btn-primary">New run</Link>
        </div>
      </div>
      <ServerNotice waiting={active.length > 0} />
      {error && <div className="notice notice-bad" role="alert">{error}</div>}
      {!runs && !error && <Skeleton rows={3} label="Loading your runs…" />}
      {runs && runs.length > 2 && (
        <div>
          <label className="field" htmlFor="runs-search">Search your runs <span className="muted">(press / to jump here)</span></label>
          <input id="runs-search" className="input" type="search" style={{ maxWidth: '24rem' }} placeholder="Name, note or tag" value={query} onChange={(e) => setQuery(e.target.value)} />
          {needle && shown && shown.length === 0 && <p className="text-sm muted mt-2" role="status">No runs match “{query}”.</p>}
        </div>
      )}
      {runs && runs.length === 0 && (
        <section className="card grid gap-3" aria-labelledby="welcome-h">
          <div>
            <h2 id="welcome-h">Let’s get your first model cooking</h2>
            <p className="mt-1 muted">Three steps, about ten minutes of your time. The model does the heavy lifting.</p>
          </div>
          <ol className="steps3">
            <li>
              <span className="step-num" aria-hidden="true">1</span>
              <div>
                <strong>Pick some data</strong>
                <p className="text-sm muted">Weekly spend per channel and revenue, one row per week. No data yet? Borrow a real brand.</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Link to="/new" className="btn btn-small btn-primary">Use my own file</Link>
                  <Link to="/new?brand=home" className="btn btn-small">Try a real brand</Link>
                </div>
              </div>
            </li>
            <li>
              <span className="step-num" aria-hidden="true">2</span>
              <div><strong>We check it</strong><p className="text-sm muted">Problems get explained in plain words, and the common ones can be fixed with one click.</p></div>
            </li>
            <li>
              <span className="step-num" aria-hidden="true">3</span>
              <div><strong>Run it and read the “In short” box</strong><p className="text-sm muted">A few minutes later you get a recommended split, with every number shown as a range.</p></div>
            </li>
          </ol>
          <p className="text-sm muted">Want to look around first? <Link to="/sample">Open the sample result</Link> or take its 1-minute tour.</p>
        </section>
      )}
      {active.length > 0 && (
        <section className="card" aria-labelledby="active-h">
          <h2 id="active-h" className="mb-2">Waiting or running</h2>
          {table(active, 'Runs waiting or running')}
          <div className="mt-2"><NotifyMe /></div>
        </section>
      )}
      {finished.length > 0 && (
        <section className="card" aria-labelledby="finished-h">
          <h2 id="finished-h">Finished ({allFinished.length} of {MAX_FINISHED} kept)</h2>
          {allFinished.length >= MAX_FINISHED && oldest && (
            <p className="notice notice-warn my-2">You have {MAX_FINISHED} finished runs. When your next run finishes, the oldest, “{oldest.name}”, will be deleted. Download anything you need from it first.</p>
          )}
          <div className="mt-2">{table(finished, 'Finished runs')}</div>
        </section>
      )}
      {other.length > 0 && (
        <section className="card" aria-labelledby="other-h">
          <h2 id="other-h">Failed or cancelled</h2>
          <p className="text-sm muted mb-2">These don’t count toward your {MAX_FINISHED} and are deleted after 7 days.</p>
          {table(other, 'Failed or cancelled runs')}
        </section>
      )}
    </div>
  )
}
