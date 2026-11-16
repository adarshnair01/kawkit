import { useMemo, useState } from 'react'
import type { Draws } from '../api/types'
import { fmtCompact, fmtNum, fmtPct, title } from '../lib/format'
import { budgetForTarget, evaluate, type TargetResult } from '../optimizer/optimize'

const num = (s: string) => {
  const v = Number(s.replace(/[,\s]/g, ''))
  return Number.isFinite(v) && v >= 0 ? v : null
}
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${fmtCompact(Math.abs(v))}`

/** Scenario planner: type any split and see what the model expects, with its range. */
export function ScenarioPlanner({ draws }: { draws: Draws }) {
  const current = draws.current
  const [rows, setRows] = useState<string[]>(() => current.map((v) => String(Math.round(v))))
  const values = rows.map(num)
  const valid = values.every((v) => v !== null)
  const x = values.map((v, i) => v ?? current[i])
  const e = useMemo(() => evaluate(draws, current, x), [draws, current, x.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  const total = current.reduce((a, b) => a + b, 0)
  const unchanged = x.every((v, i) => Math.abs(v - current[i]) < 0.5)
  const scale = (f: number) => setRows(current.map((v) => String(Math.round(v * f))))
  return (
    <section className="card grid gap-3" aria-labelledby="scn-h">
      <div>
        <h3 id="scn-h">Try your own split</h3>
        <p className="muted text-sm mt-0.5">Type a weekly spend for each channel to see what the model expects, compared with what you spend now. Nothing is refitted.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div>
          <div className="overflow-x-auto">
            <table className="data num">
              <caption className="sr-only">Your scenario: weekly spend per channel</caption>
              <thead><tr><th scope="col">Channel</th><th scope="col">Now</th><th scope="col">Your scenario</th></tr></thead>
              <tbody>
                {draws.channels.map((c, i) => (
                  <tr key={c}>
                    <th scope="row" style={{ fontWeight: 500 }}>{title(c)}</th>
                    <td>{fmtCompact(current[i])}</td>
                    <td><input className="input num" style={{ minWidth: '6rem', minHeight: '2rem' }} inputMode="decimal" aria-label={`${title(c)} weekly spend in your scenario`} value={rows[i]} onChange={(ev) => setRows((r) => r.map((v, j) => (j === i ? ev.target.value : v)))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2 mt-3" role="group" aria-label="Quick scenarios">
            <button type="button" className="btn btn-small" onClick={() => scale(0.8)}>Cut everything 20%</button>
            <button type="button" className="btn btn-small" onClick={() => scale(1.2)}>Raise everything 20%</button>
            <button type="button" className="btn btn-small" onClick={() => scale(1)}>Back to now</button>
          </div>
        </div>
        <div aria-live="polite" className="grid gap-3 content-start">
          {!valid ? (
            <div className="notice notice-bad" role="alert">Enter each spend as a number, 0 or more.</div>
          ) : unchanged ? (
            <div className="notice">Change a number to see what happens.</div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="notice">
                  <div className="text-sm muted">Expected change in weekly revenue</div>
                  <div className="text-3xl font-bold num">{signed(e.lift.mean)}</div>
                  <div className="text-sm num">90% range {signed(e.lift.low)} to {signed(e.lift.high)}</div>
                </div>
                <div className="notice">
                  <div className="text-sm muted">Chance it beats what you do now</div>
                  <div className="text-3xl font-bold num">{fmtPct(e.prob_better)}</div>
                  <div className="text-sm num">Weekly spend {fmtNum(e.budget)} ({signed(e.budget - total)})</div>
                </div>
              </div>
              <p className="text-sm">
                {Math.abs(e.budget - total) < 0.005 * total
                  ? 'Same total spend, so this is purely the effect of moving money between channels.'
                  : e.budget > total
                    ? `You spend ${fmtCompact(e.budget - total)} more a week; for each extra unit the model expects ${(e.lift.mean / (e.budget - total)).toFixed(2)} back in revenue.`
                    : `You save ${fmtCompact(total - e.budget)} a week (less spend overall); each unit saved is expected to cost ${(e.lift.mean / (e.budget - total)).toFixed(2)} in revenue.`}
              </p>
              {e.extrapolated.some(Boolean) && (
                <div className="notice notice-warn"><strong>Beyond your data:</strong> {draws.channels.filter((_, i) => e.extrapolated[i]).map(title).join(', ')} would spend more than 1.2× the highest week in your data. The model is guessing there.</div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}

/** Target mode: the smallest budget expected to add a given amount of weekly revenue. */
export function TargetPlanner({ draws }: { draws: Draws }) {
  const current = draws.current
  const total = current.reduce((a, b) => a + b, 0)
  const [target, setTarget] = useState('')
  const [result, setResult] = useState<{ target: number; r: TargetResult } | null>(null)
  const t = num(target)
  const run = () => {
    if (t === null || t <= 0) return
    setResult({ target: t, r: budgetForTarget(draws, current, t) })
  }
  const r = result?.r
  return (
    <section className="card grid gap-3" aria-labelledby="tgt-h">
      <div>
        <h3 id="tgt-h">Work back from a target</h3>
        <p className="muted text-sm mt-0.5">Say how much more revenue you want each week and get the smallest budget the model expects to deliver it. Each channel may go from half to twice its current spend.</p>
      </div>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(ev) => { ev.preventDefault(); run() }}>
        <div>
          <label className="field" htmlFor="tgt">Extra weekly revenue wanted</label>
          <input id="tgt" className="input num" style={{ width: '14rem' }} inputMode="decimal" placeholder="e.g. 20000" value={target} onChange={(ev) => setTarget(ev.target.value)} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={t === null || t <= 0}>Find the budget</button>
      </form>
      <div aria-live="polite">
        {r && result && (
          <div className="grid gap-3">
            {r.reachable ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="notice">
                  <div className="text-sm muted">Weekly budget needed</div>
                  <div className="text-2xl font-bold num">{fmtNum(r.budget)}</div>
                  <div className="text-sm num">{r.extra_budget < 0.005 * total ? 'No extra money: moving the budget is enough' : `${signed(r.extra_budget)} on today’s ${fmtNum(total)}`}</div>
                </div>
                <div className="notice">
                  <div className="text-sm muted">Chance of reaching +{fmtCompact(result.target)}</div>
                  <div className="text-2xl font-bold num">{fmtPct(r.prob_target)}</div>
                  <div className="text-sm">{r.prob_target >= 0.7 ? 'Likely.' : r.prob_target >= 0.45 ? 'About even: this is the budget where it is expected on average.' : 'Less likely than not; the range is wide.'}</div>
                </div>
                <div className="notice">
                  <div className="text-sm muted">Expected extra weekly revenue</div>
                  <div className="text-2xl font-bold num">{signed(r.plan.lift.mean)}</div>
                  <div className="text-sm num">90% range {signed(r.plan.lift.low)} to {signed(r.plan.lift.high)}</div>
                </div>
              </div>
            ) : (
              <div className="notice notice-warn">
                <strong>Out of reach within these limits.</strong> Even at twice today’s spend on every channel ({fmtNum(r.budget)} a week), the model expects about {signed(r.max_lift)} a week, short of +{fmtCompact(result.target)}. Returns flatten as spend grows, so more of the same channels will not get there.
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="data num">
                <caption className="sr-only">Split that goes with this budget</caption>
                <thead><tr><th scope="col">Channel</th><th scope="col">Now</th><th scope="col">{r.reachable ? 'To reach the target' : 'At the limit'}</th><th scope="col">Change</th></tr></thead>
                <tbody>
                  {r.plan.channels.map((c, i) => (
                    <tr key={c}>
                      <th scope="row" style={{ fontWeight: 500 }}>{title(c)}{r.plan.extrapolated[i] ? ' ⚠' : ''}</th>
                      <td>{fmtNum(r.plan.current[i])}</td>
                      <td>{fmtNum(r.plan.recommended[i])}</td>
                      <td>{r.plan.current[i] > 0 ? `${(((r.plan.recommended[i] - r.plan.current[i]) / r.plan.current[i]) * 100).toFixed(0)}%` : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {r.plan.extrapolated.some(Boolean) && <p className="text-sm" style={{ color: 'var(--warn)' }}>⚠ Spend beyond 1.2× the highest week in your data: the model is guessing there.</p>}
          </div>
        )}
      </div>
    </section>
  )
}
