import type { RunResult } from '../api/types'
import { fmtCompact, fmtPct, fmtRange, fmtRoi, title } from '../lib/format'

const list = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`)

/** Three plain sentences at the top of every result: what to do, how sure, what the model cannot tell you. */
export function Summary({ result }: { result: RunResult }) {
  const ch = result.channels
  const plan = result.default_plan
  const f = result.fit

  // what to do
  let action = 'No budget recommendation is available for this run.'
  if (plan) {
    const moves = plan.channels.map((c, i) => ({ c, d: plan.recommended[i] - plan.current[i], pct: plan.current[i] > 0 ? (plan.recommended[i] - plan.current[i]) / plan.current[i] : 0 }))
    const up = moves.filter((m) => m.pct > 0.03).sort((a, b) => b.d - a.d)
    const down = moves.filter((m) => m.pct < -0.03).sort((a, b) => a.d - b.d)
    if (!up.length || !down.length) action = 'Your current split is already close to the best the model can find within the default limits.'
    else
      action = `Move budget from ${list(down.slice(0, 3).map((m) => title(m.c)))} to ${list(up.slice(0, 2).map((m) => title(m.c)))}. At the same weekly spend, that is expected to add ${fmtCompact(plan.lift.mean)} a week in revenue (90% range ${fmtCompact(plan.lift.low)} to ${fmtCompact(plan.lift.high)}), with a ${fmtPct(plan.prob_better)} chance of beating your current split.`
  }

  // how sure
  // only channels the data actually informed can be called best, or said to pay back
  const measured = ch.filter((c) => c.prior.informed ?? c.prior.shrink >= 0.2)
  const pool = measured.length ? measured : ch
  const best = [...pool].sort((a, b) => b.roi.median - a.roi.median)[0]
  const losing = pool.filter((c) => c.roi.p_above_1 < 0.2)
  const winning = pool.filter((c) => c.roi.p_above_1 > 0.9)
  let sure = `${title(best.name)} has the highest measured return: ${fmtRoi(best.roi.median)} in revenue per unit of spend (90% range ${fmtRange(best.roi.low, best.roi.high)}).`
  if (winning.length) sure += ` ${list(winning.map((c) => title(c.name)))} very likely ${winning.length === 1 ? 'pays' : 'pay'} back more than ${winning.length === 1 ? 'it costs' : 'they cost'}.`
  if (losing.length) sure += ` ${list(losing.map((c) => title(c.name)))} probably ${losing.length === 1 ? 'does' : 'do'} not.`

  // what the model cannot tell you
  const prior = ch.filter((c) => !(c.prior.informed ?? c.prior.shrink >= 0.2))
  const wide = ch.filter((c) => c.roi.confidence === 'low' && !prior.includes(c))
  const conflict = ch.filter((c) => c.prior.conflict)
  const caveats: string[] = []
  if (result.diagnostics.verdict !== 'pass') caveats.push('the sampler did not fully converge, so treat small differences with care')
  if (prior.length) caveats.push(`the data could not say much about ${list(prior.map((c) => title(c.name)))}, so ${prior.length === 1 ? 'that estimate mostly reflects' : 'those estimates mostly reflect'} the starting assumption`)
  if (wide.length) caveats.push(`the range for ${list(wide.map((c) => title(c.name)))} is wide`)
  if (conflict.length) caveats.push(`the data disagrees with the belief you gave for ${list(conflict.map((c) => title(c.name)))}`)
  if (f.media_share.median > 0.6) caveats.push(`the model credits ${Math.round(f.media_share.median * 100)}% of revenue to advertising, more than is usual, so the recommendation is likely overconfident`)
  if (f.holdout_mape !== null && f.holdout_mape > 5) caveats.push(`predictions for unseen weeks were off by ${f.holdout_mape.toFixed(1)}% on average`)
  const trust =
    f.holdout_mape !== null
      ? `Asked to predict the last ${f.holdout_weeks} weeks without seeing them, the model was off by ${f.holdout_mape.toFixed(1)}% in a typical week.`
      : 'There were too few weeks to test the model on data it had not seen.'
  const caution = caveats.length ? `Be careful: ${caveats.join('; ')}.` : 'No channel stands out as poorly measured.'

  return (
    <section className="summary" aria-labelledby="summary-h">
      <p className="eyebrow" id="summary-h">In short</p>
      <ul className="mt-1" style={{ listStyle: 'none', padding: 0 }}>
        <li><strong>What to do.</strong> {action}</li>
        <li><strong>How sure.</strong> {sure}</li>
        <li><strong>How far to trust it.</strong> {trust} {caution} This is a model of past data, not an experiment.</li>
      </ul>
    </section>
  )
}
