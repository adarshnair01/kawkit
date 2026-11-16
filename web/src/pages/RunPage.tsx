import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../api/auth'
import { cancelRun, createShare, friendlyError, getDraws, getResult, getShare, queuePosition, renameRun, revokeShare, SECONDS_PER_RUN, shareUrl, useRuns, useServerStatus, type Share } from '../api/runs'
import type { Draws, RunResult } from '../api/types'
import { ResultsView } from '../components/ResultsView'
import { ServerNotice } from '../components/ServerNotice'
import { fmtDate, fmtDuration, fmtPct, title } from '../lib/format'
import { StatusBadge } from './MyRuns'

export default function RunPage() {
  const { id } = useParams()
  const { session } = useAuth()
  const { runs, error, refresh } = useRuns(session?.user.id)
  const { beat } = useServerStatus()
  const run = runs?.find((r) => r.id === id)
  const [result, setResult] = useState<RunResult | null>(null)
  const [draws, setDraws] = useState<Draws | null>(null)
  const [drawsError, setDrawsError] = useState<string | null>(null)
  const [position, setPosition] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [editing, setEditing] = useState(false)
  const [newName, setNewName] = useState('')
  const status = run?.status
  const [share, setShare] = useState<Share | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareBusy, setShareBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (status !== 'finished' || !id) return
    let off = false
    getShare(id).then((s) => !off && setShare(s)).catch(() => undefined)
    return () => {
      off = true
    }
  }, [status, id])

  useEffect(() => {
    if (status !== 'finished' || !id) return
    let off = false
    getResult(id)
      .then((r) => {
        if (off || !r) return
        setResult(r)
        return getDraws(r.draws_path).then((d) => !off && setDraws(d))
      })
      .catch((e) => !off && setDrawsError(`Could not load the results: ${friendlyError(e)}`))
    return () => {
      off = true
    }
  }, [status, id])

  useEffect(() => {
    if (status !== 'queued' || !id) return
    let off = false
    const load = () => queuePosition(id).then((p) => !off && setPosition(p)).catch(() => undefined)
    load()
    const t = setInterval(load, 5000)
    return () => {
      off = true
      clearInterval(t)
    }
  }, [status, id])

  if (error) return <div className="notice notice-bad" role="alert">{error}</div>
  if (!runs) return <p className="muted" role="status">Loading…</p>
  if (!run)
    return (
      <div className="card">
        <h1>Run not found</h1>
        <p className="mt-1 muted">It may have been deleted to make room for newer runs.</p>
        <Link to="/runs" className="btn mt-3">Back to my runs</Link>
      </div>
    )

  const cancel = async () => {
    setCancelling(true)
    setActionError(null)
    try {
      await cancelRun(run.id)
      await refresh()
    } catch (e) {
      setActionError(friendlyError(e))
    } finally {
      setCancelling(false)
    }
  }
  const startShare = async () => {
    setShareOpen(true)
    if (share) return
    setShareBusy(true)
    setActionError(null)
    try {
      setShare(await createShare(run.id))
    } catch (e) {
      setActionError(friendlyError(e))
      setShareOpen(false)
    } finally {
      setShareBusy(false)
    }
  }
  const stopShare = async () => {
    setShareBusy(true)
    try {
      await revokeShare(run.id)
      setShare(null)
      setShareOpen(false)
    } catch (e) {
      setActionError(friendlyError(e))
    } finally {
      setShareBusy(false)
    }
  }
  const copyShare = async () => {
    if (!share) return
    try {
      await navigator.clipboard.writeText(shareUrl(share.token))
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      document.getElementById('share-url')?.focus()
    }
  }
  const rename = async () => {
    try {
      await renameRun(run.id, newName.trim())
      await refresh()
      setEditing(false)
    } catch (e) {
      setActionError(friendlyError(e))
    }
  }
  const slots = Math.max(beat?.max_concurrency ?? 1, 1)
  const wait = position === null ? null : Math.ceil((position + 1) / slots) * SECONDS_PER_RUN
  const priorChannels = Object.entries(run.priors ?? {}).filter(([, p]) => p.roi_low !== undefined || p.carryover_weeks !== undefined)

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm"><Link to="/runs">← My runs</Link></p>
          {editing ? (
            <form className="flex flex-wrap gap-2 mt-1" onSubmit={(e) => { e.preventDefault(); rename() }}>
              <label className="sr-only" htmlFor="rename">Run name</label>
              <input id="rename" className="input" style={{ width: '20rem', maxWidth: '100%' }} maxLength={80} value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
              <button type="submit" className="btn btn-primary" disabled={!newName.trim()}>Save</button>
              <button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button>
            </form>
          ) : (
            <h1 className="flex flex-wrap items-center gap-2">{run.name} <StatusBadge run={run} /></h1>
          )}
          <p className="text-sm muted mt-1">
            Submitted {fmtDate(run.created_at)} · {run.data_summary?.weeks ?? '?'} weeks, {run.data_summary?.channels?.length ?? '?'} channels
            {priorChannels.length > 0 ? ` · your priors on ${priorChannels.map(([c]) => title(c)).join(', ')}` : ' · default priors'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!editing && <button type="button" className="btn btn-small" onClick={() => { setNewName(run.name); setEditing(true) }}>Rename</button>}
          <Link to={`/new?from=${run.id}`} className="btn btn-small">Re-run with different priors</Link>
          {run.status === 'finished' && <button type="button" className="btn btn-small" aria-expanded={shareOpen} onClick={() => (shareOpen ? setShareOpen(false) : startShare())}>{share ? 'Sharing: on' : 'Share'}</button>}
        </div>
      </div>
      {shareOpen && run.status === 'finished' && (
        <section className="card grid gap-2" aria-labelledby="share-h">
          <h2 id="share-h" className="text-base">Share a read-only link</h2>
          {shareBusy && !share ? (
            <p className="muted" role="status">Creating the link…</p>
          ) : share ? (
            <>
              <p className="text-sm muted">Anyone with this link can see this run’s results without signing in, until {fmtDate(share.expires_at)}. They cannot see your uploaded file, your other runs or your account, and they cannot change anything.</p>
              <div className="flex flex-wrap gap-2">
                <label className="sr-only" htmlFor="share-url">Share link</label>
                <input id="share-url" className="input num" style={{ flex: '1 1 20rem' }} readOnly value={shareUrl(share.token)} onFocus={(e) => e.target.select()} />
                <button type="button" className="btn btn-primary" onClick={copyShare}>{copied ? 'Copied' : 'Copy link'}</button>
                <button type="button" className="btn btn-danger" disabled={shareBusy} onClick={stopShare}>Stop sharing</button>
              </div>
              <p className="text-sm muted" role="status">{copied ? 'Link copied to the clipboard.' : 'The link also stops working if this run is deleted to make room for newer ones.'}</p>
            </>
          ) : null}
        </section>
      )}
      {actionError && <div className="notice notice-bad" role="alert">{actionError}</div>}

      {(run.status === 'queued' || run.status === 'running') && (
        <>
          <ServerNotice waiting />
          <section className="card grid gap-3" aria-live="polite" aria-labelledby="status-h">
            {run.status === 'queued' ? (
              <>
                <h2 id="status-h">Waiting in the queue</h2>
                <p>
                  {position === null ? 'Checking your place in the queue…' : position === 0 ? 'You are next.' : `${position} ${position === 1 ? 'run is' : 'runs are'} ahead of yours.`}
                  {wait !== null && <> Estimated wait before it starts: <strong>{fmtDuration(wait)}</strong>.</>}
                </p>
              </>
            ) : (
              <>
                <h2 id="status-h">{run.cancel_requested ? 'Cancelling…' : 'Fitting the model'}</h2>
                <div className="progress" role="progressbar" aria-label="Model fitting progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(run.progress * 100)}>
                  <div style={{ width: `${Math.max(2, run.progress * 100)}%` }} />
                </div>
                <p className="num">{fmtPct(run.progress)} · {run.progress < 0.75 ? 'sampling the main model' : run.progress < 0.94 ? 'checking error on held-out weeks' : 'summarising results'}{run.attempts > 1 ? ` · attempt ${run.attempts} (the server was interrupted and retried)` : ''}</p>
              </>
            )}
            <p className="text-sm muted">You can close this tab; the run continues and will be in My runs when you come back.</p>
            <div><button type="button" className="btn btn-danger" disabled={cancelling || run.cancel_requested} onClick={cancel}>{run.cancel_requested ? 'Cancelling…' : 'Cancel this run'}</button></div>
          </section>
        </>
      )}

      {run.status === 'failed' && (
        <section className="notice notice-bad" role="alert">
          <h2 className="text-base">This run failed</h2>
          <p className="mt-1">{run.error ?? 'No reason was recorded.'}</p>
          <p className="mt-2"><Link to={`/new?from=${run.id}`}>Change the priors and run it again</Link>, or <Link to="/new">upload a corrected file</Link>.</p>
        </section>
      )}
      {run.status === 'cancelled' && (
        <section className="notice">
          <h2 className="text-base">This run was cancelled</h2>
          <p className="mt-1">It will be deleted after 7 days. <Link to={`/new?from=${run.id}`}>Run it again</Link>.</p>
        </section>
      )}
      {run.status === 'finished' && (result ? <ResultsView name={run.name} result={result} draws={draws} drawsError={drawsError} /> : <p className={drawsError ? 'notice notice-bad' : 'muted'} role="status">{drawsError ?? 'Loading results…'}</p>)}
    </div>
  )
}
