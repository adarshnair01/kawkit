import { useMemo, useState } from 'react'
import type { Draws } from '../api/types'
import { SpendBars } from '../charts/SpendBars'
import { ChartFrame } from '../charts/ChartFrame'
import { fmtCompact, fmtNum, fmtPct, title } from '../lib/format'
import { optimiseItems, PROB_GATE } from '../optimizer/optimize'
import { exportPlan } from './Optimise'
import { ScenarioPlanner } from './Planner'

const num = (s: string) => {
  const v = Number(s.replace(/[,\s]/g, ''))
  return Number.isFinite(v) && v >= 0 ? v : null
}
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${fmtCompact(Math.abs(v))}`

interface Row {
  min: string
  max: string
  locked: boolean
}

/** Budget optimiser for runs with a breakdown: money moves between channels, and optionally between a channel's items. */
export function OptimiseBreakdown({ draws, runName, runId }: { draws: Draws; runName: string; runId?: string }) {
  const groups = draws.groups!
  const chan = groups.channel_of
  const current = draws.current
  const curC = useMemo(() => groups.channel_names.map((_, c) => current.reduce((s, v, i) => s + (chan[i] === c ? v : 0), 0)), [groups, current, chan])
  const total = curC.reduce((a, b) => a + b, 0)
  const [mode, setMode] = useState<'keep' | 'resplit'>('keep')
  const [budget, setBudget] = useState(String(Math.round(total)))
  const [rows, setRows] = useState<Row[]>(() => curC.map((v) => ({ min: String(Math.round(0.5 * v)), max: String(Math.round(1.5 * v)), locked: false })))
  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const parsed = useMemo(() => {
    const problems: string[] = []
    const b = num(budget)
    if (b === null) problems.push('Enter the weekly budget as a number.')
    const lower: number[] = []
    const upper: number[] = []
    rows.forEach((r, i) => {
      if (r.locked) {
        lower.push(curC[i])
        upper.push(curC[i])
        return
      }
      const lo = num(r.min)
      const hi = num(r.max)
      if (lo === null || hi === null) problems.push(`${title(groups.channel_names[i])}: enter the minimum and maximum as numbers.`)
      else if (hi < lo) problems.push(`${title(groups.channel_names[i])}: the maximum is below the minimum.`)
      lower.push(lo ?? 0)
      upper.push(Math.max(hi ?? 0, lo ?? 0))
    })
    return { problems, budget: b ?? total, lower, upper }
  }, [budget, rows, curC, groups, total])

  const { plan, ms } = useMemo(() => {
    const t = performance.now()
    const p = optimiseItems(draws, current, mode, { budget: parsed.budget, channelLower: parsed.lower, channelUpper: parsed.upper })
    return { plan: p, ms: performance.now() - t }
  }, [draws, current, mode, parsed])

  const sameBudget = Math.abs(plan.budget - total) < 0.005 * total
  const unchanged = plan.recommended.every((v, i) => Math.abs(v - plan.current[i]) < 1e-6 * Math.max(1, plan.current[i]))
  const reset = () => {
    setBudget(String(Math.round(total)))
    setRows(curC.map((v) => ({ min: String(Math.round(0.5 * v)), max: String(Math.round(1.5 * v)), locked: false })))
  }

  return (
    <div className="grid gap-4">
      <section className="card grid gap-2" aria-labelledby="opt-mode-h">
        <h3 id="opt-mode-h">How should the money move?</h3>
        <div className="grid gap-2" role="radiogroup" aria-labelledby="opt-mode-h">
          <label className="flex items-start gap-2">
            <input type="radio" name="opt-mode" checked={mode === 'keep'} onChange={() => setMode('keep')} />
            <span><strong>Between channels only.</strong> <span className="muted text-sm">Each channel keeps its mix of platforms or campaigns. The safe choice.</span></span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="opt-mode" checked={mode === 'resplit'} onChange={() => setMode('resplit')} />
            <span><strong>Also re-split inside channels.</strong> <span className="muted text-sm">Items can move up or down by a quarter of their share, but only in channels where the re-split helps in at least {fmtPct(PROB_GATE)} of the model’s draws. Where the data can’t tell items apart, the mix stays and the plan says so.</span></span>
          </label>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section className="card" aria-labelledby="opt-settings">
          <h3 id="opt-settings">Budget and channel limits</h3>
          <p className="muted text-sm mt-0.5 mb-3">Weekly amounts. The budget starts at your average over the last 13 weeks; limits start at 50% to 150% of each channel’s current spend.</p>
          <label className="field" htmlFor="opt-budget">Weekly budget</label>
          <input id="opt-budget" className="input num" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
          <div className="overflow-x-auto mt-3">
            <table className="data num">
              <caption className="sr-only">Per-channel limits</caption>
              <thead><tr><th scope="col">Channel</th><th scope="col">Current</th><th scope="col">Min</th><th scope="col">Max</th><th scope="col">Lock</th></tr></thead>
              <tbody>
                {groups.channel_names.map((c, i) => (
                  <tr key={c}>
                    <th scope="row" style={{ fontWeight: 500 }}>{title(c)}</th>
                    <td>{fmtCompact(curC[i])}</td>
                    <td><input className="input num" style={{ minWidth: '5.5rem', minHeight: '2rem' }} inputMode="decimal" aria-label={`${title(c)} minimum weekly spend`} value={rows[i].locked ? String(Math.round(curC[i])) : rows[i].min} disabled={rows[i].locked} onChange={(e) => setRow(i, { min: e.target.value })} /></td>
                    <td><input className="input num" style={{ minWidth: '5.5rem', minHeight: '2rem' }} inputMode="decimal" aria-label={`${title(c)} maximum weekly spend`} value={rows[i].locked ? String(Math.round(curC[i])) : rows[i].max} disabled={rows[i].locked} onChange={(e) => setRow(i, { max: e.target.value })} /></td>
                    <td><input type="checkbox" style={{ width: '1.2rem', height: '1.2rem' }} aria-label={`Lock ${title(c)} at current spend`} checked={rows[i].locked} onChange={(e) => setRow(i, { locked: e.target.checked })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn btn-small mt-3" onClick={reset}>Reset to defaults</button>
          {parsed.problems.length > 0 && <div className="notice notice-bad mt-3" role="alert"><ul className="list-disc pl-5">{parsed.problems.map((p) => <li key={p}>{p}</li>)}</ul></div>}
        </section>

        <section className="card" aria-labelledby="opt-result" aria-live="polite">
          <h3 id="opt-result">Recommendation</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <div className="notice">
              <div className="text-sm muted">Chance the new split beats {sameBudget ? 'your current one' : 'your current spend'}</div>
              <div className="text-3xl font-bold num">{unchanged ? '–' : fmtPct(plan.prob_better)}</div>
              <div className="text-sm">{unchanged ? 'The recommended split is your current split.' : plan.prob_better >= 0.9 ? 'Very likely better.' : plan.prob_better >= 0.7 ? 'Probably better.' : 'Not clearly better; the limits or budget leave little room.'}</div>
            </div>
            <div className="notice">
              <div className="text-sm muted">Expected change in weekly revenue from media</div>
              <div className="text-3xl font-bold num">{signed(plan.lift.mean)}</div>
              <div className="text-sm num">90% range {fmtCompact(plan.lift.low)} to {fmtCompact(plan.lift.high)}</div>
            </div>
          </div>
          <p className="text-sm mt-3">
            Where it comes from: <strong>{signed(plan.lift_between)}</strong> from moving money between channels
            {mode === 'resplit' && <>, and <strong>{signed(plan.lift_within)}</strong> from re-splitting inside them. The second part rests on weaker evidence than the first</>}.
          </p>
          {plan.notes.map((n) => <div key={n} className="notice notice-warn mt-2">{n}</div>)}
          {plan.extrapolated.some(Boolean) && (
            <div className="notice notice-warn mt-3"><strong>Beyond your data:</strong> {plan.channels.filter((_, i) => plan.extrapolated[i]).map(title).join(', ')} would spend more than 1.2× their highest week. The model is guessing there.</div>
          )}
          <p className="text-xs muted mt-3">Recomputed in {ms < 1 ? 'under 1' : Math.round(ms)} ms in your browser, over {draws.beta.length} posterior draws.</p>
          <button type="button" className="btn mt-3" onClick={() => exportPlan(plan, runName)}>Download recommended split (CSV)</button>
        </section>
      </div>

      <section className="card grid gap-2" aria-labelledby="opt-items-h">
        <h3 id="opt-items-h">Weekly spend by channel and item</h3>
        <div className="overflow-x-auto">
          <table className="data num">
            <caption className="sr-only">Current and recommended weekly spend per item, grouped by channel</caption>
            <thead><tr><th scope="col">Channel / item</th><th scope="col">Current</th><th scope="col">Recommended</th><th scope="col">Change</th></tr></thead>
            <tbody>
              {groups.channel_names.map((c, ci) => {
                const idx = chan.map((v, i) => (v === ci ? i : -1)).filter((i) => i >= 0)
                const bc = plan.by_channel[ci]
                return [
                  <tr key={c} className="bd-total">
                    <th scope="row">{title(c)}{idx.length > 1 && mode === 'resplit' && <span className="muted text-sm font-normal"> · {bc.items_resplit ? 're-split' : 'mix kept'}</span>}</th>
                    <td>{fmtNum(bc.current)}</td><td>{fmtNum(bc.recommended)}</td>
                    <td>{bc.current > 0 ? `${(((bc.recommended - bc.current) / bc.current) * 100).toFixed(0)}%` : '–'}</td>
                  </tr>,
                  ...(idx.length > 1
                    ? idx.map((i) => (
                        <tr key={`${c}-${i}`}>
                          <th scope="row" style={{ fontWeight: 400, paddingLeft: '1.6rem' }}>{plan.channels[i].split(' / ').slice(1).join(' / ')}</th>
                          <td>{fmtNum(plan.current[i])}</td><td>{fmtNum(plan.recommended[i])}</td>
                          <td>{plan.current[i] > 0 ? `${(((plan.recommended[i] - plan.current[i]) / plan.current[i]) * 100).toFixed(0)}%` : '–'}</td>
                        </tr>
                      ))
                    : []),
                ]
              })}
            </tbody>
          </table>
        </div>
      </section>

      <ChartFrame
        title="Current vs recommended weekly spend, by item"
        note="Hatched bars are the recommendation."
        table={{
          caption: 'Current and recommended weekly spend per item',
          header: ['Item', 'Current', 'Recommended', 'Change'],
          rows: plan.channels.map((c, i) => [title(c), fmtNum(plan.current[i]), fmtNum(plan.recommended[i]), plan.current[i] > 0 ? `${(((plan.recommended[i] - plan.current[i]) / plan.current[i]) * 100).toFixed(0)}%` : '–']),
        }}
      >
        <SpendBars
          ariaLabel="Bar chart of current and recommended weekly spend per item"
          labels={plan.channels.map((c) => title(c.replace(' / ', ' · ')))}
          groups={[{ label: 'Current', values: plan.current, color: 'var(--c7)' }, { label: 'Recommended', values: plan.recommended, color: 'var(--c0)', hatch: true }]}
          flags={plan.extrapolated}
        />
      </ChartFrame>
      <ScenarioPlanner draws={draws} runId={runId} />
    </div>
  )
}
