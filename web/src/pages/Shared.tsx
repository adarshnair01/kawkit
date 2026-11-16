import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getSharedRun, type SharedRun } from '../api/runs'
import { ResultsView } from '../components/ResultsView'
import { fmtDate } from '../lib/format'

/** A finished run opened through a share link. Read-only; no account needed. */
export default function Shared() {
  const { token } = useParams()
  const [state, setState] = useState<{ run: SharedRun | null } | 'error' | null>(null)
  useEffect(() => {
    let off = false
    const valid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token ?? '')
    if (!valid) {
      setState({ run: null })
      return
    }
    getSharedRun(token!)
      .then((run) => !off && setState({ run }))
      .catch(() => !off && setState('error'))
    return () => {
      off = true
    }
  }, [token])

  if (state === null) return <p className="muted" role="status">Loading the shared result…</p>
  if (state === 'error') return <div className="notice notice-bad" role="alert">The shared result could not be loaded. Check your connection and try again.</div>
  if (!state.run)
    return (
      <div className="card">
        <h1>This link no longer works</h1>
        <p className="mt-1 muted">It may have expired, been switched off by its owner, or the run may have been deleted. Ask whoever sent it for a new one.</p>
        <Link to="/" className="btn mt-3">Go to Kawkit</Link>
      </div>
    )
  const run = state.run
  return (
    <div className="grid gap-4">
      <div>
        <p className="eyebrow">Shared result</p>
        <h1>{run.name}</h1>
        <p className="text-sm muted mt-1">
          {run.weeks ? `${run.weeks} weeks of data · ` : ''}fitted {fmtDate(run.finished_at)} · read-only link, works until {fmtDate(run.expires_at)}
        </p>
      </div>
      <ResultsView name={run.name} result={run.result} draws={null} shared />
      <p className="notice">Made with Kawkit. <Link to="/sample">See a sample result</Link> or <Link to="/sign-in">run your own data</Link>.</p>
    </div>
  )
}
