import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../api/auth'
import { cancelRun, createShare, friendlyError, getDraws, getResult, getShare, queuePosition, renameRun, revokeShare, setRunNotes, SECONDS_PER_RUN, shareUrl, useRuns, useServerStatus, type Share } from '../api/runs'
import type { Draws, RunResult } from '../api/types'
import { ResultsView } from '../components/ResultsView'
import { Confetti } from '../components/Confetti'
import { Skeleton } from '../components/Skeleton'
import { useToast } from '../components/Toast'
import { RunProgress } from '../components/RunProgress'
import { NotifyMe } from '../components/NotifyMe'
import { ServerNotice } from '../components/ServerNotice'
import { fmtDate, fmtDuration, title } from '../lib/format'
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
  const toast = useToast()
  const lastStatus = useRef<string | undefined>(undefined)
  const [party, setParty] = useState(false)
  // celebrate when a run we were watching finishes (not when opening one that is already done)
  useEffect(() => {
    const before = lastStatus.current
    lastStatus.current = status
    if (status === 'finished' && (before === 'queued' || before === 'running')) {
      setParty(true)
      toast('Your model is done. Start with the “In short” box.')
      const t = setTimeout(() => setParty(false), 4000)
      return () => clearTimeout(t)
    }
  }, [status, toast])
  const [share, setShare] = useState<Share | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareBusy, setShareBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [tagText, setTagText] = useState('')
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
  if (!runs) return <Skeleton rows={3} />
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
      toast('Link copied')
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
  const saveNotes = async () => {
    try {
      await setRunNotes(run.id, noteText.trim(), tagText.split(',').map((t) => t.trim()).filter(Boolean))
      await refresh()
      setNoteOpen(false)
      toast('Notes saved')
    } catch (e) {
      setActionError(friendlyError(e))
    }
  }
  const slots = Math.max(beat?.max_concurrency ?? 1, 1)
  const wait = position === null ? null : Math.ceil((position + 1) / slots) * SECONDS_PER_RUN
  const breakdownSpec = (run.settings as { breakdown?: Record<string, { dims: string[] }> } | undefined)?.breakdown
  const priorChannels = Object.entries(run.priors ?? {}).filter(([, p]) => p.roi_low !== undefined || p.carryover_weeks !== undefined)

  return (
    <div className="grid gap-4">
      {party && <Confetti />}
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
            {breakdownSpec && ` · broken down: ${Object.entries(breakdownSpec).map(([c, v]) => `${title(c)} by ${v.dims.join(' and ')}`).join('; ')}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!editing && <button type="button" className="btn btn-small" onClick={() => { setNewName(run.name); setEditing(true) }}>Rename</button>}
          <Link to={`/new?from=${run.id}`} className="btn btn-small">Re-run with different priors</Link>
          <button type="button" className="btn btn-small" aria-expanded={noteOpen} onClick={() => { setNoteText(run.notes ?? ''); setTagText((run.tags ?? []).join(', ')); setNoteOpen((o) => !o) }}>{run.notes || run.tags?.length ? 'Edit notes' : 'Add notes'}</button>
          {run.status === 'finished' && <button type="button" className="btn btn-small" aria-expanded={shareOpen} onClick={() => (shareOpen ? setShareOpen(false) : startShare())}>{share ? 'Sharing: on' : 'Share'}</button>}
        </div>
      </div>
      {(run.notes || run.tags?.length > 0) && !noteOpen && (
        <section className="card grid gap-1" aria-label="Notes on this run">
          {run.tags?.length > 0 && <p className="flex flex-wrap gap-1">{run.tags.map((t) => <span key={t} className="badge">{t}</span>)}</p>}
          {run.notes && <p style={{ whiteSpace: 'pre-wrap' }}>{run.notes}</p>}
        </section>
      )}
      {noteOpen && (
        <form className="card grid gap-2" aria-labelledby="notes-h" onSubmit={(e) => { e.preventDefault(); saveNotes() }}>
          <h2 id="notes-h" className="text-base">Notes on this run</h2>
          <div>
            <label className="field" htmlFor="run-notes">Note (up to 500 characters)</label>
            <textarea id="run-notes" className="input" rows={3} maxLength={500} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="e.g. With the Black Friday dummy, client A, Q3 review" />
          </div>
          <div>
            <label className="field" htmlFor="run-tags">Tags, separated by commas (up to 5)</label>
            <input id="run-tags" className="input" value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="client-a, q3" />
          </div>
          <div className="flex gap-2"><button type="submit" className="btn btn-primary">Save notes</button><button type="button" className="btn" onClick={() => setNoteOpen(false)}>Cancel</button></div>
        </form>
      )}
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
      {run.status === 'finished' && breakdownSpec && result && !result.breakdown && (
        <div className="notice notice-warn" role="alert">
          <strong>This run was fitted without its breakdown.</strong> The model server that ran it is an older version and ignored the breakdown file, so these are channel-level results. Update the worker on the server, then <Link to={`/new?from=${run.id}`}>run it again</Link>.
        </div>
      )}

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
                <RunProgress progress={run.progress} startedAt={run.started_at} attempt={run.attempts} />
              </>
            )}
            <p className="text-sm muted">You can close this tab; the run continues and will be in My runs when you come back.</p>
            <NotifyMe />
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
      {run.status === 'finished' && (result ? <ResultsView name={run.name} result={result} draws={draws} drawsError={drawsError} runId={run.id} /> : drawsError ? <p className="notice notice-bad" role="status">{drawsError}</p> : <Skeleton rows={4} label="Loading results…" />)}
    </div>
  )
}
