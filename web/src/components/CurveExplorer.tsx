import { useState } from 'react'
import type { Curve } from '../api/types'
import { LineChart } from '../charts/LineChart'
import { fmtCompact, fmtNum, palette } from '../lib/format'

/** Linear interpolation along the stored curve. */
export function at(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0]
  const last = xs.length - 1
  if (x >= xs[last]) return ys[last]
  let i = 1
  while (xs[i] < x) i++
  const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1] || 1)
  return ys[i - 1] + t * (ys[i] - ys[i - 1])
}

/** A response curve with a slider: drag the spend and watch the marker slide along the curve. */
export function CurveExplorer({ c, i }: { c: Curve; i: number }) {
  const max = c.spend[c.spend.length - 1]
  const [x, setX] = useState(c.current)
  const here = at(c.spend, c.median, x)
  const lo = at(c.spend, c.low, x)
  const hi = at(c.spend, c.high, x)
  const now = at(c.spend, c.median, c.current)
  const step = Math.max(max / 200, 1e-6)
  const slopeEps = Math.max(max / 40, 1e-6)
  const next = (at(c.spend, c.median, Math.min(x + slopeEps, max)) - at(c.spend, c.median, Math.max(x - slopeEps, 0))) / (Math.min(x + slopeEps, max) - Math.max(x - slopeEps, 0) || 1)
  const beyond = x > c.max_weekly * 1.2
  return (
    <div className="grid gap-2">
      <LineChart
        ariaLabel={`Response curve for ${c.name}: revenue against weekly spend, with 90% band; current spend ${fmtCompact(c.current)}; your marker at ${fmtCompact(x)}`}
        x={c.spend}
        height={240}
        xLabel="Weekly spend"
        series={[{ label: 'Expected weekly revenue', values: c.median, color: palette(i), band: { low: c.low, high: c.high } }]}
        markers={[
          { x: c.current, label: `current ${fmtCompact(c.current)}` },
          { x: c.max_weekly, label: `highest week ${fmtCompact(c.max_weekly)}`, color: 'var(--muted)' },
          ...(Math.abs(x - c.current) > max / 100 ? [{ x, label: `you ${fmtCompact(x)}`, color: 'var(--accent-ink)' }] : []),
        ]}
      />
      <div className="curve-try">
        <label className="field" htmlFor={`try-${c.name}`}>Try a weekly spend: <strong className="num">{fmtNum(x)}</strong></label>
        <input id={`try-${c.name}`} type="range" className="slider" min={0} max={max} step={step} value={x} onChange={(e) => setX(Number(e.target.value))} aria-valuetext={`${fmtCompact(x)} a week`} />
        <p className="text-sm num" aria-live="polite">
          Expect about <strong>{fmtCompact(here)}</strong> a week (90% range {fmtCompact(lo)} to {fmtCompact(hi)}), {here >= now ? '+' : '−'}{fmtCompact(Math.abs(here - now))} against now. Each extra unit adds roughly <strong>{Math.max(next, 0).toFixed(2)}</strong> here.
        </p>
        {beyond && <p className="text-sm notice notice-warn">That’s well above your highest week ({fmtCompact(c.max_weekly)}). The model is guessing out there.</p>}
        <button type="button" className="btn btn-small" onClick={() => setX(c.current)} disabled={x === c.current}>Back to current spend</button>
      </div>
    </div>
  )
}
