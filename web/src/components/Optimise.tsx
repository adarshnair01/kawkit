import { useMemo, useState } from 'react'
import type { Draws, Plan } from '../api/types'
import { ChartFrame } from '../charts/ChartFrame'
import { SpendBars } from '../charts/SpendBars'
import { downloadCsv, fmtCompact, fmtNum, fmtPct, title } from '../lib/format'
import { optimise } from '../optimizer/optimize'
import { ScenarioPlanner, TargetPlanner } from './Planner'

interface Row {
  min: string
  max: string
  locked: boolean
}

const num = (s: string) => {
  const v = Number(s.replace(/[,\s]/g, ''))
  return Number.isFinite(v) && v >= 0 ? v : null
}

export function exportPlan(plan: Plan, runName: string) {
  downloadCsv(
    `kawkit-recommended-split-${runName.replace(/\W+/g, '-').toLowerCase()}.csv`,
    ['channel', 'current_weekly_spend', 'recommended_weekly_spend', 'change_pct', 'min', 'max', 'beyond_observed_spend'],
    [
      ...plan.channels.map((c, i) => [c, plan.current[i].toFixed(2), plan.recommended[i].toFixed(2), plan.current[i] > 0 ? (((plan.recommended[i] - plan.current[i]) / plan.current[i]) * 100).toFixed(1) : '', plan.lower[i].toFixed(2), plan.upper[i].toFixed(2), plan.extrapolated[i] ? 'yes' : 'no']),
      [],
      ['weekly_budget', plan.budget.toFixed(2)],
      ['expected_weekly_revenue_change', plan.lift.mean.toFixed(2)],
      ['expected_change_90pct_low', plan.lift.low.toFixed(2)],
      ['expected_change_90pct_high', plan.lift.high.toFixed(2)],
      ['probability_recommended_beats_current', plan.prob_better.toFixed(3)],
    ],
  )
}

/** Budget optimiser. Runs in the browser on the posterior draws, so changes are instant and need no server. */
export function Optimise({ draws, runName, runId }: { draws: Draws; runName: string; runId?: string }) {
  const current = draws.current
  const defaultBudget = current.reduce((a, b) => a + b, 0)
  const [budget, setBudget] = useState(String(Math.round(defaultBudget)))
  const [rows, setRows] = useState<Row[]>(() => current.map((v) => ({ min: String(Math.round(0.5 * v)), max: String(Math.round(1.5 * v)), locked: false })))

  const parsed = useMemo(() => {
    const problems: string[] = []
    const b = num(budget)
    if (b === null) problems.push('Enter the weekly budget as a number.')
    const lower: number[] = []
    const upper: number[] = []
    rows.forEach((r, i) => {
      if (r.locked) {
        lower.push(current[i])
        upper.push(current[i])
        return
      }
      const lo = num(r.min)
      const hi = num(r.max)
      if (lo === null || hi === null) problems.push(`${title(draws.channels[i])}: enter the minimum and maximum as numbers.`)
      else if (hi < lo) problems.push(`${title(draws.channels[i])}: the maximum is below the minimum.`)
      lower.push(lo ?? 0)
      upper.push(Math.max(hi ?? 0, lo ?? 0))
    })
    return { problems, budget: b ?? defaultBudget, lower, upper }
  }, [budget, rows, current, draws.channels, defaultBudget])

  const { plan, ms } = useMemo(() => {
    const t = performance.now()
    const p = optimise(draws, current, { budget: parsed.budget, lower: parsed.lower, upper: parsed.upper })
    return { plan: p, ms: performance.now() - t }
  }, [draws, current, parsed])

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const reset = () => {
    setBudget(String(Math.round(defaultBudget)))
    setRows(current.map((v) => ({ min: String(Math.round(0.5 * v)), max: String(Math.round(1.5 * v)), locked: false })))
  }
  const better = plan.prob_better
  const unchanged = plan.recommended.every((v, i) => Math.abs(v - plan.current[i]) < 1e-6 * Math.max(1, plan.current[i]))
  const sameBudget = Math.abs(plan.budget - defaultBudget) < 0.005 * defaultBudget

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section className="card" aria-labelledby="opt-settings">
          <h3 id="opt-settings">Budget and limits</h3>
          <p className="muted text-sm mt-0.5 mb-3">Weekly amounts. The budget starts at your average over the last 13 weeks; limits start at 50% to 150% of current spend.</p>
          <label className="field" htmlFor="opt-budget">Weekly budget</label>
          <input id="opt-budget" className="input num" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
          <div className="overflow-x-auto mt-3">
            <table className="data num">
              <caption className="sr-only">Per-channel limits</caption>
              <thead>
                <tr>
                  <th scope="col">Channel</th>
                  <th scope="col">Current</th>
                  <th scope="col">Min</th>
                  <th scope="col">Max</th>
                  <th scope="col">Lock</th>
                </tr>
              </thead>
              <tbody>
                {draws.channels.map((c, i) => (
                  <tr key={c}>
                    <th scope="row" style={{ fontWeight: 500 }}>{title(c)}</th>
                    <td>{fmtCompact(current[i])}</td>
                    <td><input className="input num" style={{ minWidth: '5.5rem', minHeight: '2rem' }} inputMode="decimal" aria-label={`${title(c)} minimum weekly spend`} value={rows[i].locked ? String(Math.round(current[i])) : rows[i].min} disabled={rows[i].locked} onChange={(e) => setRow(i, { min: e.target.value })} /></td>
                    <td><input className="input num" style={{ minWidth: '5.5rem', minHeight: '2rem' }} inputMode="decimal" aria-label={`${title(c)} maximum weekly spend`} value={rows[i].locked ? String(Math.round(current[i])) : rows[i].max} disabled={rows[i].locked} onChange={(e) => setRow(i, { max: e.target.value })} /></td>
                    <td><input type="checkbox" style={{ width: '1.2rem', height: '1.2rem' }} aria-label={`Lock ${title(c)} at current spend`} checked={rows[i].locked} onChange={(e) => setRow(i, { locked: e.target.checked })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" className="btn btn-small" onClick={reset}>Reset to defaults</button>
          </div>
          {parsed.problems.length > 0 && (
            <div className="notice notice-bad mt-3" role="alert">
              <ul className="list-disc pl-5">{parsed.problems.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          )}
        </section>

        <section className="card" aria-labelledby="opt-result" aria-live="polite">
          <h3 id="opt-result">Recommendation</h3>
          {plan.notes.map((n) => (
            <div key={n} className="notice notice-warn mt-2">{n} The plan below spends {fmtNum(plan.budget)} a week.</div>
          ))}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <div className="notice">
              <div className="text-sm muted">Chance the new split beats {sameBudget ? 'your current one' : 'your current spend'}</div>
              <div className="text-3xl font-bold num">{unchanged ? '–' : fmtPct(better)}</div>
              <div className="text-sm">{unchanged ? 'The recommended split is your current split.' : better >= 0.9 ? 'Very likely better.' : better >= 0.7 ? 'Probably better.' : better >= 0.5 ? 'Slightly more likely better than not.' : 'Not clearly better; the limits or budget leave little room.'}</div>
            </div>
            <div className="notice">
              <div className="text-sm muted">Expected change in weekly revenue from media</div>
              <div className="text-3xl font-bold num">{plan.lift.mean >= 0 ? '+' : '−'}{fmtCompact(Math.abs(plan.lift.mean))}</div>
              <div className="text-sm num">90% range {fmtCompact(plan.lift.low)} to {fmtCompact(plan.lift.high)} ({plan.lift_pct.low.toFixed(1)}% to {plan.lift_pct.high.toFixed(1)}%)</div>
            </div>
          </div>
          {!sameBudget && <p className="text-sm muted mt-2">The budget differs from your current spend ({fmtNum(defaultBudget)} a week), so the change includes the effect of spending {plan.budget > defaultBudget ? 'more' : 'less'}.</p>}
          {plan.extrapolated.some(Boolean) && (
            <div className="notice notice-warn mt-3">
              <strong>Beyond your data:</strong> {plan.channels.filter((_, i) => plan.extrapolated[i]).map(title).join(', ')} would spend more than 1.2× the highest week in your data. The model is guessing there; treat that part with caution.
            </div>
          )}
          <p className="text-xs muted mt-3">Recomputed in {ms < 1 ? 'under 1' : Math.round(ms)} ms in your browser, over {draws.beta.length} posterior draws. No refit needed.</p>
          <button type="button" className="btn mt-3" onClick={() => exportPlan(plan, runName)}>Download recommended split (CSV)</button>
        </section>
      </div>

      <ChartFrame
        title="Current vs recommended weekly spend"
        note="Steady weekly spend per channel. Hatched bars are the recommendation."
        table={{
          caption: 'Current and recommended weekly spend per channel',
          header: ['Channel', 'Current', 'Recommended', 'Change', 'Min', 'Max', 'Beyond data'],
          rows: plan.channels.map((c, i) => [title(c), fmtNum(plan.current[i]), fmtNum(plan.recommended[i]), plan.current[i] > 0 ? `${(((plan.recommended[i] - plan.current[i]) / plan.current[i]) * 100).toFixed(0)}%` : '–', fmtNum(plan.lower[i]), fmtNum(plan.upper[i]), plan.extrapolated[i] ? 'Yes' : 'No']),
        }}
      >
        <SpendBars
          ariaLabel="Bar chart of current and recommended weekly spend per channel"
          labels={plan.channels.map(title)}
          groups={[
            { label: 'Current', values: plan.current, color: 'var(--c7)' },
            { label: 'Recommended', values: plan.recommended, color: 'var(--c0)', hatch: true },
          ]}
          flags={plan.extrapolated}
        />
      </ChartFrame>
      <ScenarioPlanner draws={draws} runId={runId} />
      <TargetPlanner draws={draws} />
    </div>
  )
}
