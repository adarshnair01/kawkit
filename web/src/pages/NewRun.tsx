import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../api/auth'
import { downloadUpload, friendlyError, getRun, MAX_FINISHED, submitRun, useRuns } from '../api/runs'
import type { ChannelPrior, Priors } from '../api/types'
import { ChartFrame } from '../charts/ChartFrame'
import { LineChart } from '../charts/LineChart'
import { ServerNotice } from '../components/ServerNotice'
import { fmtCompact, fmtNum, fmtPct, palette, title } from '../lib/format'
import { MAX_BYTES, validateCsv, type Validation } from '../validation/validate'

interface PriorForm {
  low: string
  high: string
  weeks: string
  note: string
}
const EMPTY: PriorForm = { low: '', high: '', weeks: '', note: '' }

function parsePriors(forms: Record<string, PriorForm>, channels: string[]): { priors: Priors; problems: string[] } {
  const priors: Priors = {}
  const problems: string[] = []
  for (const ch of channels) {
    const f = forms[ch] ?? EMPTY
    const p: ChannelPrior = {}
    const lo = f.low.trim() === '' ? null : Number(f.low)
    const hi = f.high.trim() === '' ? null : Number(f.high)
    if ((lo === null) !== (hi === null)) problems.push(`${title(ch)}: give both ends of the ROI range, or leave both blank.`)
    else if (lo !== null && hi !== null) {
      if (!(lo > 0) || !(hi > lo)) problems.push(`${title(ch)}: the ROI range needs 0 < low < high.`)
      else {
        p.roi_low = lo
        p.roi_high = hi
      }
    }
    if (f.weeks.trim() !== '') {
      const w = Number(f.weeks)
      if (!(w >= 0.5 && w <= 26)) problems.push(`${title(ch)}: carry-over must be between 0.5 and 26 weeks.`)
      else p.carryover_weeks = w
    }
    if (f.note.trim()) p.note = f.note.trim().slice(0, 200)
    if (Object.keys(p).length) priors[ch] = p
  }
  return { priors, problems }
}

export default function NewRun() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const from = params.get('from')
  const { runs } = useRuns(session?.user.id)
  const [csv, setCsv] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [validation, setValidation] = useState<Validation | null>(null)
  const [step, setStep] = useState<'data' | 'priors'>('data')
  const [forms, setForms] = useState<Record<string, PriorForm>>({})
  const [name, setName] = useState('')
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const summaryRef = useRef<HTMLDivElement>(null)

  const load = (text: string, label: string, bytes?: number) => {
    const v = validateCsv(text, bytes)
    setCsv(text)
    setFileName(label)
    setValidation(v)
    setError(null)
    setLoadError(null)
    setName((n) => n || label.replace(/\.csv$/i, '').slice(0, 60))
    setTimeout(() => summaryRef.current?.focus(), 50)
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > MAX_BYTES) {
      setCsv(null)
      setFileName(file.name)
      setValidation({ errors: [{ code: 'file_too_large', message: 'The file is larger than 10 MB.', rows: [] }], warnings: [], summary: null, dataset: null })
      return
    }
    load(await file.text(), file.name, file.size)
  }

  const loadSample = async () => {
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}sample/sample.csv`)
      load(await r.text(), 'Sample dataset.csv')
    } catch {
      setLoadError('The sample could not be loaded. Try again.')
    }
  }

  // re-run an earlier run with changed priors
  useEffect(() => {
    if (!from) return
    let cancelled = false
    ;(async () => {
      try {
        const run = await getRun(from)
        if (!run) throw new Error('That run no longer exists.')
        const text = await downloadUpload(run.upload_path)
        if (cancelled) return
        load(text, `${run.name}.csv`)
        setName(`${run.name} (re-run)`.slice(0, 80))
        setForms(Object.fromEntries(Object.entries(run.priors ?? {}).map(([ch, p]) => [ch, { low: p.roi_low?.toString() ?? '', high: p.roi_high?.toString() ?? '', weeks: p.carryover_weeks?.toString() ?? '', note: p.note ?? '' }])))
        setStep('priors')
      } catch (e) {
        if (!cancelled) setLoadError(`Could not load that run’s data: ${friendlyError(e)}`)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [from])

  const channels = useMemo(() => validation?.summary?.channels ?? [], [validation])
  const parsed = useMemo(() => parsePriors(forms, channels.map((c) => c.name)), [forms, channels])
  const implied = useMemo(() => {
    const s = validation?.summary
    if (!s) return null
    let low = 0
    let high = 0
    let any = false
    for (const c of s.channels) {
      const p = parsed.priors[c.name]
      if (p?.roi_low !== undefined && p.roi_high !== undefined) {
        any = true
        low += p.roi_low * c.total
        high += p.roi_high * c.total
      }
    }
    return any ? { low: low / s.revenue_total, high: high / s.revenue_total } : null
  }, [validation, parsed])

  const activeCount = runs?.filter((r) => r.status === 'queued' || r.status === 'running').length ?? 0
  const finished = runs?.filter((r) => r.status === 'finished') ?? []
  const oldest = finished.length >= MAX_FINISHED ? finished[finished.length - 1] : null
  const impossible = !!implied && implied.low > 1
  const canSubmit = !!csv && !!validation?.summary && validation.errors.length === 0 && parsed.problems.length === 0 && !impossible && name.trim().length > 0 && activeCount < 3 && !busy

  const submit = async () => {
    if (!session || !csv || !validation?.summary) return
    setBusy(true)
    setError(null)
    try {
      const id = await submitRun(session.user.id, name.trim(), csv, validation.summary, parsed.priors)
      navigate(`/runs/${id}`)
    } catch (e) {
      setError(friendlyError(e))
      setBusy(false)
    }
  }

  const setForm = (ch: string, patch: Partial<PriorForm>) => setForms((f) => ({ ...f, [ch]: { ...(f[ch] ?? EMPTY), ...patch } }))
  const s = validation?.summary
  const ds = validation?.dataset

  return (
    <div className="grid gap-4">
      <div>
        <h1>New run</h1>
        <ol className="flex flex-wrap gap-2 mt-2 text-sm" style={{ listStyle: 'none', padding: 0 }}>
          <li><span className={`badge ${step === 'data' ? 'badge-info' : ''}`} aria-current={step === 'data' ? 'step' : undefined}>1. Data</span></li>
          <li><span className={`badge ${step === 'priors' ? 'badge-info' : ''}`} aria-current={step === 'priors' ? 'step' : undefined}>2. What you already know, and submit</span></li>
        </ol>
      </div>
      <ServerNotice />
      {loadError && <div className="notice notice-bad" role="alert">{loadError}</div>}

      {step === 'data' && (
        <>
          <section className="card grid gap-3" aria-labelledby="upload-h">
            <h2 id="upload-h">Upload your data</h2>
            <div
              className={`dropzone ${over ? 'over' : ''}`}
              onDragOver={(e: DragEvent) => { e.preventDefault(); setOver(true) }}
              onDragLeave={() => setOver(false)}
              onDrop={(e: DragEvent) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files[0]) }}
            >
              <p className="font-semibold">Drag a CSV file here</p>
              <p className="muted text-sm mb-3">or</p>
              <div className="flex flex-wrap justify-center gap-2">
                <button type="button" className="btn btn-primary" onClick={() => fileInput.current?.click()}>Choose a file</button>
                <button type="button" className="btn" onClick={loadSample}>Use the sample dataset</button>
                <a className="btn" href={`${import.meta.env.BASE_URL}sample/template.csv`} download="kawkit-template.csv">Download the template</a>
              </div>
              <input ref={fileInput} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Choose a CSV file" tabIndex={-1} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = '' }} />
            </div>
            <p className="notice text-sm">
              <strong>Privacy:</strong> when you submit, this file is sent to and stored on the service so the model server can fit it. Only you can read it. It is kept with your run (your 5 most recent finished runs are kept; older ones and their files are deleted automatically), and you can delete everything from the <Link to="/account">Account page</Link>. Until you submit, the file stays in your browser.
            </p>
            <details>
              <summary className="font-semibold cursor-pointer">Format rules</summary>
              <ul className="list-disc pl-5 mt-2 grid gap-1 text-sm">
                <li>One row per week (or per day; daily rows are summed to weeks starting Monday).</li>
                <li><code>date</code> as YYYY-MM-DD, each date once. <code>revenue</code>: your KPI per period.</li>
                <li><code>spend_&lt;channel&gt;</code>: 1 to 15 columns, 0 or more. <code>control_&lt;name&gt;</code>: optional other drivers such as promotions, price or holidays.</li>
                <li>At least 52 weeks (104 or more recommended), at most 5,000 rows and 10 MB. Other columns are ignored.</li>
                <li><strong>Tip:</strong> add a <code>control_</code> column for anything else that moves your sales, such as a 1 in Black Friday week and 0 otherwise, or your average discount. On the real example brands this cut the error on unseen weeks by up to a quarter, and it stops advertising taking the credit for those weeks.</li>
              </ul>
            </details>
          </section>

          {validation && (
            <div ref={summaryRef} tabIndex={-1} className="grid gap-4 outline-none" aria-live="polite">
              {validation.errors.length > 0 && (
                <section className="notice notice-bad" role="alert" aria-labelledby="err-h">
                  <h2 id="err-h" className="text-base">{fileName}: {validation.errors.length === 1 ? '1 problem' : `${validation.errors.length} problems`} to fix before this can run</h2>
                  <ul className="list-disc pl-5 mt-1 grid gap-1">{validation.errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
                  <p className="text-sm mt-2">Row numbers count the header as row 1. Fix the file and upload it again.</p>
                </section>
              )}
              {s && ds && (
                <>
                  <section className="card" aria-labelledby="sum-h">
                    <h2 id="sum-h">{fileName} looks good</h2>
                    <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
                      <div><dt className="text-sm muted">Weeks</dt><dd className="text-xl font-bold num">{s.weeks}{s.cadence === 'daily' && <span className="text-sm font-normal muted"> (from {fmtNum(s.input_rows)} daily rows)</span>}</dd></div>
                      <div><dt className="text-sm muted">Date range</dt><dd className="font-semibold num">{s.start} to {s.end}</dd></div>
                      <div><dt className="text-sm muted">Channels</dt><dd className="text-xl font-bold num">{s.channels.length}</dd></div>
                      <div><dt className="text-sm muted">Controls</dt><dd className="font-semibold">{s.controls.length ? s.controls.map(title).join(', ') : 'None'}</dd></div>
                    </dl>
                    <div className="overflow-x-auto mt-3">
                      <table className="data num">
                        <caption className="sr-only">Spend per channel</caption>
                        <thead><tr><th scope="col">Channel</th><th scope="col">Total spend</th><th scope="col">Weekly average</th><th scope="col">Weeks active</th><th scope="col">Share of spend</th></tr></thead>
                        <tbody>
                          {s.channels.map((c) => (
                            <tr key={c.name}><th scope="row" style={{ fontWeight: 500 }}>{title(c.name)}</th><td>{fmtNum(c.total)}</td><td>{fmtNum(c.mean)}</td><td>{fmtPct(c.active_share)}</td><td>{fmtPct(c.total / s.channels.reduce((a, b) => a + b.total, 0))}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  {s.warnings.length > 0 && (
                    <section className="notice notice-warn" aria-labelledby="warn-h">
                      <h2 id="warn-h" className="text-base">{s.warnings.length === 1 ? '1 thing' : `${s.warnings.length} things`} to know before running</h2>
                      <ul className="list-disc pl-5 mt-1 grid gap-1">{s.warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
                      <p className="text-sm mt-2">You can still run the model; these affect how much it can tell you.</p>
                    </section>
                  )}
                  <ChartFrame
                    title="Spend over time"
                    table={{ caption: 'Weekly spend per channel', header: ['Week', ...ds.channels.map(title)], rows: ds.dates.map((d, i) => [d, ...ds.spend[i].map((v) => fmtNum(v))]) }}
                  >
                    <LineChart ariaLabel={`Line chart of weekly spend for ${ds.channels.length} channels from ${s.start} to ${s.end}`} x={ds.dates} series={ds.channels.map((c, j) => ({ label: title(c), values: ds.spend.map((r) => r[j]), color: palette(j), width: 1.6 }))} />
                  </ChartFrame>
                  <div><button type="button" className="btn btn-primary" onClick={() => { setStep('priors'); window.scrollTo(0, 0) }}>Continue</button></div>
                </>
              )}
            </div>
          )}
        </>
      )}

      {step === 'priors' && s && (
        <>
          <section className="card grid gap-3" aria-labelledby="priors-h">
            <h2 id="priors-h">What you already know (optional)</h2>
            <p className="muted">Leave everything blank to use the defaults, which let the data lead: each channel’s effect is assumed to be in proportion to its share of spend, and about a quarter of a week’s effect is assumed to carry into the next week. The results always show how far the data moved these starting points.</p>
            <div className="grid gap-3">
              {s.channels.map((c) => {
                const f = forms[c.name] ?? EMPTY
                return (
                  <fieldset key={c.name} className="border border-[var(--border)] rounded-lg p-3">
                    <legend className="font-semibold px-1">{title(c.name)}</legend>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_2fr]">
                      <div>
                        <label className="field" htmlFor={`lo-${c.name}`}>ROI, low end</label>
                        <input id={`lo-${c.name}`} className="input num" inputMode="decimal" placeholder="e.g. 0.8" value={f.low} onChange={(e) => setForm(c.name, { low: e.target.value })} />
                      </div>
                      <div>
                        <label className="field" htmlFor={`hi-${c.name}`}>ROI, high end</label>
                        <input id={`hi-${c.name}`} className="input num" inputMode="decimal" placeholder="e.g. 2.0" value={f.high} onChange={(e) => setForm(c.name, { high: e.target.value })} />
                      </div>
                      <div>
                        <label className="field" htmlFor={`wk-${c.name}`}>Effect lasts about (weeks)</label>
                        <input id={`wk-${c.name}`} className="input num" inputMode="decimal" placeholder="e.g. 4" value={f.weeks} onChange={(e) => setForm(c.name, { weeks: e.target.value })} />
                      </div>
                      <div>
                        <label className="field" htmlFor={`nt-${c.name}`}>Where this belief comes from</label>
                        <input id={`nt-${c.name}`} className="input" maxLength={200} placeholder="e.g. Geo test, Q2 2025" value={f.note} onChange={(e) => setForm(c.name, { note: e.target.value })} />
                      </div>
                    </div>
                  </fieldset>
                )
              })}
            </div>
            <p className="text-sm muted">ROI range: the range you are 90% sure the channel’s return falls in (revenue per unit of spend), for example from a lift test.</p>
            {parsed.problems.length > 0 && (
              <div className="notice notice-bad" role="alert"><ul className="list-disc pl-5">{parsed.problems.map((p) => <li key={p}>{p}</li>)}</ul></div>
            )}
            <div className={`notice ${impossible ? 'notice-bad' : ''}`} role="status">
              <strong>What your priors imply: </strong>
              {implied ? (
                impossible ? (
                  <>even at the low ends of your ROI ranges, those channels would have generated {fmtPct(implied.low)} of all your revenue, which is impossible. Lower the ranges.</>
                ) : (
                  <>the channels with ROI ranges generated between {fmtPct(implied.low)} and {fmtPct(Math.min(implied.high, 9.99))} of your revenue ({fmtCompact(implied.low * s.revenue_total)} to {fmtCompact(implied.high * s.revenue_total)}).{implied.high > 1 ? ' The high end is more than all your revenue, so the data will pull these down.' : ''}</>
                )
              ) : (
                <>no ROI beliefs given, so the model starts from the weak defaults and the data decides.</>
              )}
            </div>
          </section>

          <section className="card grid gap-3" aria-labelledby="submit-h">
            <h2 id="submit-h">Name and submit</h2>
            <div style={{ maxWidth: '28rem' }}>
              <label className="field" htmlFor="run-name">Run name</label>
              <input id="run-name" className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <p className="text-sm muted">{fileName}: {s.weeks} weeks, {s.channels.length} channels. The run is queued and fitted in the background; you can close this tab and come back.</p>
            {oldest && <div className="notice notice-warn">You already have {MAX_FINISHED} finished runs. When this one finishes, your oldest, “{oldest.name}”, will be deleted with its file.</div>}
            {activeCount >= 3 && <div className="notice notice-warn">You already have 3 runs waiting or running (the limit is 1 running and 2 queued). Wait for one to finish, or cancel one from <Link to="/runs">My runs</Link>.</div>}
            {error && <div className="notice notice-bad" role="alert">{error}</div>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn" onClick={() => setStep('data')}>Back to data</button>
              <button type="button" className="btn btn-primary" disabled={!canSubmit} onClick={submit}>{busy ? 'Submitting…' : 'Submit run'}</button>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
