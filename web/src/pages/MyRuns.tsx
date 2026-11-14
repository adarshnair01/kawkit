import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../api/auth'
import { getVerdicts, MAX_FINISHED, useRuns } from '../api/runs'
import type { Run } from '../api/types'
import { VerdictBadge } from '../components/ResultsView'
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
  const active = runs?.filter((r) => r.status === 'queued' || r.status === 'running') ?? []
  const finished = runs?.filter((r) => r.status === 'finished') ?? []
  const other = runs?.filter((r) => r.status === 'failed' || r.status === 'cancelled') ?? []
  const oldest = finished[finished.length - 1]

  const table = (rows: Run[], caption: string) => (
    <div className="overflow-x-auto">
      <table className="data">
        <caption className="sr-only">{caption}</caption>
        <thead><tr><th scope="col">Name</th><th scope="col">Submitted</th><th scope="col">Status</th><th scope="col">Convergence</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row" style={{ fontWeight: 600, whiteSpace: 'normal' }}><Link to={`/runs/${r.id}`}>{r.name}</Link></th>
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
          {finished.length >= 2 && <Link to="/compare" className="btn">Compare two runs</Link>}
          <Link to="/new" className="btn btn-primary">New run</Link>
        </div>
      </div>
      <ServerNotice waiting={active.length > 0} />
      {error && <div className="notice notice-bad" role="alert">{error}</div>}
      {!runs && !error && <p className="muted" role="status">Loading your runs…</p>}
      {runs && runs.length === 0 && (
        <div className="card">
          <h2>No runs yet</h2>
          <p className="mt-1 muted">Upload your weekly spend and revenue, or start from the sample dataset.</p>
          <Link to="/new" className="btn btn-primary mt-3">Start your first run</Link>
        </div>
      )}
      {active.length > 0 && (
        <section className="card" aria-labelledby="active-h">
          <h2 id="active-h" className="mb-2">Waiting or running</h2>
          {table(active, 'Runs waiting or running')}
        </section>
      )}
      {finished.length > 0 && (
        <section className="card" aria-labelledby="finished-h">
          <h2 id="finished-h">Finished ({finished.length} of {MAX_FINISHED} kept)</h2>
          {finished.length >= MAX_FINISHED && oldest && (
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
