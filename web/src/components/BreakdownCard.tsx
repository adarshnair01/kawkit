import { useRef } from 'react'
import { title, fmtPct } from '../lib/format'
import type { Analysis, LongFile, Spec } from '../breakdown/parse'

const SEP = {
  good: { cls: 'badge-ok', text: 'Items move independently: the model can tell them apart' },
  weak: { cls: 'badge-warn', text: 'Items move together a lot: expect wide ranges' },
  none: { cls: 'badge-bad', text: 'The mix barely changes: the model will not be able to separate these' },
} as const

/** Optional step: upload a long-format spend file and pick, per channel, the dimensions to break it down by. */
export function BreakdownCard({ channels, file, fileName, spec, analysis, error, onFile, onClear, onSpec }: {
  channels: string[]
  file: LongFile | null
  fileName: string
  spec: Spec
  analysis: Analysis | null
  error: string | null
  onFile: (f: File | undefined) => void
  onClear: () => void
  onSpec: (spec: Spec) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const toggle = (ch: string, dim: string) => {
    const cur = spec[ch]?.dims ?? []
    const next = cur.includes(dim) ? cur.filter((d) => d !== dim) : [...cur, dim]
    const out = { ...spec }
    if (next.length) out[ch] = { dims: next }
    else delete out[ch]
    onSpec(out)
  }
  const planOf = (ch: string) => analysis?.plans.find((p) => p.channel === ch)
  return (
    <section className="card grid gap-3" aria-labelledby="bd-h">
      <div>
        <h2 id="bd-h">Break channels down (optional)</h2>
        <p className="muted text-sm mt-0.5">
          Want to know which platform, campaign or region inside a channel did the work? Upload a second file with one row per week, channel and
          breakdown, then choose what to break each channel down by. The model estimates each part together with the channel, and says plainly
          when the data can’t tell parts apart.
        </p>
      </div>
      {!file ? (
        <div className="grid gap-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn" onClick={() => input.current?.click()}>Choose a breakdown file</button>
            <a className="btn" href={`${import.meta.env.BASE_URL}sample/breakdown-template.csv`} download="kawkit-breakdown-template.csv">Download the template</a>
          </div>
          <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Choose a breakdown CSV file" tabIndex={-1} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = '' }} />
          <p className="text-sm muted">Columns: <code>date</code>, <code>channel</code>, <code>spend</code>, and any others (platform, campaign, region…) as breakdowns. Channel names must match your main file, and each channel’s items should add up to its spend there.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge badge-ok">✓ {fileName}</span>
            <span className="text-sm muted">{file.rows.length.toLocaleString()} rows · breakdowns found: {file.dimensions.length ? file.dimensions.join(', ') : 'none (add columns such as platform)'}</span>
            <button type="button" className="btn btn-small" onClick={onClear}>Remove this file</button>
          </div>
          {file.dimensions.length > 0 && (
            <div className="grid gap-3">
              {channels.map((ch) => {
                const inFile = file.channels.includes(ch)
                const plan = planOf(ch)
                return (
                  <fieldset key={ch} className="bd-channel">
                    <legend className="font-semibold">{title(ch)}{!inFile && <span className="muted text-sm font-normal"> · not in the breakdown file</span>}</legend>
                    {inFile && (
                      <div className="flex flex-wrap gap-x-4 gap-y-1" role="group" aria-label={`Break ${title(ch)} down by`}>
                        {file.dimensions.map((d) => (
                          <label key={d} className="flex items-center gap-1.5 text-sm">
                            <input type="checkbox" checked={spec[ch]?.dims.includes(d) ?? false} onChange={() => toggle(ch, d)} />
                            {title(d)}
                          </label>
                        ))}
                      </div>
                    )}
                    {plan && (
                      <div className="grid gap-1.5 mt-2" aria-live="polite">
                        {plan.error ? (
                          <p className="notice notice-bad" role="alert">{plan.error}</p>
                        ) : (
                          <>
                            <p className="text-sm">
                              <strong>{plan.items.length} items:</strong>{' '}
                              {plan.items.map((it) => `${it.name} (${fmtPct(it.spend.reduce((a, b) => a + b, 0) / Math.max(plan.total, 1e-9))})`).join(', ')}
                            </p>
                            <p className="text-sm"><span className={`badge ${SEP[plan.separability].cls}`}>{SEP[plan.separability].text}</span></p>
                            {plan.dims.length > 1 && <p className="text-sm muted">Several breakdowns are combined additively: the model learns one effect per {plan.dims.join(' and ')} value, so each is estimated from many items.</p>}
                            {plan.remainderShare > 0.02 && <p className="text-sm muted">The items cover {fmtPct(1 - plan.remainderShare)} of this channel’s spend in your main file. The rest is kept as “Not broken down”.</p>}
                            {plan.folded.length > 0 && <p className="text-sm muted">Folded {plan.folded.join(' and ')}.</p>}
                            {plan.sparse.length > 0 && <p className="text-sm muted">{plan.sparse.slice(0, 4).join(', ')} had spend in under 20% of weeks, so the data says little about {plan.sparse.length > 1 ? 'them' : 'it'}.</p>}
                          </>
                        )}
                      </div>
                    )}
                  </fieldset>
                )
              })}
            </div>
          )}
          {analysis?.errors.map((e) => <p key={e} className="notice notice-bad" role="alert">{e}</p>)}
          {analysis?.warnings.map((w) => <p key={w} className="text-sm muted">{w}</p>)}
          {Object.keys(spec).length === 0 && file.dimensions.length > 0 && <p className="text-sm muted">Tick a breakdown under a channel to use it. Channels you leave alone are modelled as before.</p>}
        </>
      )}
      {error && <p className="notice notice-bad" role="alert">{error}</p>}
    </section>
  )
}
