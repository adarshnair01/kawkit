/**
 * Budget optimiser over posterior draws. Mirror of worker/kawkit_worker/optimise.py.
 *
 * Steady weekly spend x_c per channel; with normalised adstock the steady-state response of
 * channel c under draw d is  beta_cd * ymax * tanh(lam_cd * x_c / (2 * xmax_c)).
 */
import type { Draws, Plan } from '../api/types'

const GRID = 400
const STEPS = 2000
const LOOKAHEAD = [1, 5, 25, 100]
export const EXTRAPOLATION = 1.2

/** Revenue from channel c at weekly spend x under draw d. */
export function response(draws: Draws, d: number, c: number, x: number): number {
  return draws.beta[d][c] * draws.ymax * Math.tanh((draws.lam[d][c] * x) / (2 * draws.xmax[c]))
}

export type CurveFn = (c: number, x: number) => number

/** Expected response per channel, averaged over the draws once on a fine grid. */
export function averagedCurves(draws: Draws, top: number[]): CurveFn {
  const D = draws.beta.length
  const tops = top.map((t) => Math.max(t, 1e-9))
  const tables = tops.map((t, c) => {
    const table = new Float64Array(GRID + 1)
    for (let g = 0; g <= GRID; g++) {
      const x = (t * g) / GRID
      let s = 0
      for (let d = 0; d < D; d++) s += response(draws, d, c, x)
      table[g] = s / D
    }
    return table
  })
  return (c, x) => {
    const pos = Math.min(Math.max(x / tops[c], 0), 1) * GRID
    const i = Math.min(Math.floor(pos), GRID - 1)
    const f = pos - i
    return tables[c][i] * (1 - f) + tables[c][i + 1] * f
  }
}

export interface Limits {
  budget?: number
  lower?: number[]
  upper?: number[]
}

/** Allocate a budget across channels given expected-response curves. Exported for the brute-force test. */
export function allocate(curve: CurveFn, lower: number[], upper: number[], budget: number, steps: number = STEPS): number[] {
  const n = lower.length
  const x = [...lower]
  let remaining = budget - x.reduce((a, b) => a + b, 0)
  const step = budget > 0 ? budget / steps : 0

  while (step > 0 && remaining > 1e-9) {
    const s = Math.min(step, remaining)
    let bestC = -1
    let bestGain = -Infinity
    for (let c = 0; c < n; c++) {
      const room = upper[c] - x[c]
      if (room <= 1e-12) continue
      const base = curve(c, x[c])
      for (const k of LOOKAHEAD) {
        const d = Math.min(k * s, room, remaining)
        if (d <= 0) continue
        const gain = (curve(c, x[c] + d) - base) / d
        if (gain > bestGain) {
          bestGain = gain
          bestC = c
        }
      }
    }
    if (bestC < 0) break
    const d = Math.min(s, upper[bestC] - x[bestC])
    x[bestC] += d
    remaining -= d
  }

  // refine: move money between pairs of channels while any move helps
  let delta = step
  for (let round = 0; round < 12; round++) {
    let improved = true
    let guard = 0
    while (improved && guard < 5000) {
      improved = false
      guard++
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (i === j) continue
          const d = Math.min(delta, x[i] - lower[i], upper[j] - x[j])
          if (d <= 1e-12) continue
          const gain = curve(j, x[j] + d) - curve(j, x[j]) + curve(i, x[i] - d) - curve(i, x[i])
          if (gain > 1e-9) {
            x[i] -= d
            x[j] += d
            improved = true
          }
        }
      }
    }
    delta /= 2
  }
  return x
}

function percentile(sorted: number[], p: number): number {
  const pos = (sorted.length - 1) * p
  const i = Math.floor(pos)
  const f = pos - i
  return i + 1 < sorted.length ? sorted[i] * (1 - f) + sorted[i + 1] * f : sorted[i]
}

export function optimise(draws: Draws, current: number[], limits: Limits = {}): Plan {
  const n = current.length
  const lower = limits.lower ?? current.map((v) => 0.5 * v)
  const upper = (limits.upper ?? current.map((v) => 1.5 * v)).map((u, c) => Math.max(u, lower[c]))
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0)
  const requested = limits.budget ?? sum(current)
  const notes: string[] = []
  let budget = requested
  if (budget < sum(lower) - 1e-9) {
    budget = sum(lower)
    notes.push('The budget is below the sum of the channel minimums, so the minimums were used.')
  } else if (budget > sum(upper) + 1e-9) {
    budget = sum(upper)
    notes.push('The budget is above the sum of the channel maximums, so the maximums were used.')
  }

  const curve = averagedCurves(
    draws,
    upper.map((u, c) => Math.max(u, current[c])),
  )
  let x = allocate(curve, lower, upper, budget)

  // never recommend something worse than the current split when the current split is feasible
  const total = (v: number[]) => v.reduce((s, val, c) => s + curve(c, val), 0)
  const feasibleNow =
    Math.abs(sum(current) - budget) <= 1e-6 * Math.max(budget, 1) &&
    current.every((v, c) => v >= lower[c] - 1e-9 && v <= upper[c] + 1e-9)
  if (feasibleNow && total(current) > total(x)) x = [...current]

  const D = draws.beta.length
  const lift: number[] = []
  const liftPct: number[] = []
  let curMean = 0
  let recMean = 0
  for (let d = 0; d < D; d++) {
    let cur = 0
    let rec = 0
    for (let c = 0; c < n; c++) {
      cur += response(draws, d, c, current[c])
      rec += response(draws, d, c, x[c])
    }
    curMean += cur / D
    recMean += rec / D
    lift.push(rec - cur)
    liftPct.push(((rec - cur) / Math.max(cur, 1e-9)) * 100)
  }
  const sorted = [...lift].sort((a, b) => a - b)
  const sortedPct = [...liftPct].sort((a, b) => a - b)
  const maxWeekly = draws.max_weekly ?? draws.xmax
  return {
    budget,
    requested_budget: requested,
    channels: draws.channels,
    current: [...current],
    recommended: x,
    lower,
    upper,
    extrapolated: x.map((v, c) => v > EXTRAPOLATION * maxWeekly[c]),
    expected_current: curMean,
    expected_recommended: recMean,
    lift: {
      mean: sum(lift) / D,
      median: percentile(sorted, 0.5),
      low: percentile(sorted, 0.05),
      high: percentile(sorted, 0.95),
    },
    lift_pct: {
      mean: curMean > 0 ? ((recMean - curMean) / curMean) * 100 : 0,
      low: percentile(sortedPct, 0.05),
      high: percentile(sortedPct, 0.95),
    },
    prob_better: lift.filter((v) => v > 0).length / D,
    notes,
  }
}

export interface Evaluation {
  budget: number
  expected_current: number
  expected: number
  lift: { mean: number; low: number; high: number }
  lift_pct: { mean: number; low: number; high: number }
  prob_better: number
  extrapolated: boolean[]
}

/** Revenue change under every draw when weekly spend moves from `current` to `x`. */
export function liftDraws(draws: Draws, current: number[], x: number[]): { lift: number[]; cur: number[] } {
  const D = draws.beta.length
  const lift: number[] = []
  const cur: number[] = []
  for (let d = 0; d < D; d++) {
    let a = 0
    let b = 0
    for (let c = 0; c < current.length; c++) {
      a += response(draws, d, c, current[c])
      b += response(draws, d, c, x[c])
    }
    cur.push(a)
    lift.push(b - a)
  }
  return { lift, cur }
}

/** Scenario planner: what any split the user types in is expected to do, against the current one. */
export function evaluate(draws: Draws, current: number[], x: number[]): Evaluation {
  const { lift, cur } = liftDraws(draws, current, x)
  const D = lift.length
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / D
  const sorted = [...lift].sort((a, b) => a - b)
  const pct = lift.map((v, i) => (v / Math.max(cur[i], 1e-9)) * 100).sort((a, b) => a - b)
  const curMean = mean(cur)
  const maxWeekly = draws.max_weekly ?? draws.xmax
  return {
    budget: x.reduce((s, v) => s + v, 0),
    expected_current: curMean,
    expected: curMean + mean(lift),
    lift: { mean: mean(lift), low: percentile(sorted, 0.05), high: percentile(sorted, 0.95) },
    lift_pct: { mean: curMean > 0 ? (mean(lift) / curMean) * 100 : 0, low: percentile(pct, 0.05), high: percentile(pct, 0.95) },
    prob_better: lift.filter((v) => v > 0).length / D,
    extrapolated: x.map((v, c) => v > EXTRAPOLATION * maxWeekly[c]),
  }
}

export interface TargetResult {
  reachable: boolean
  /** weekly budget needed, or the largest budget tried when the target is out of reach */
  budget: number
  extra_budget: number
  plan: Plan
  /** chance the plan delivers at least the target */
  prob_target: number
  /** the most extra revenue the model expects within the limits */
  max_lift: number
}

/**
 * Target mode: the smallest weekly budget whose best split is expected to add `target` revenue a
 * week. Each channel may go from half to `maxMultiple` times its current spend. Expected lift
 * rises with budget, so the answer is found by bisection.
 */
export function budgetForTarget(draws: Draws, current: number[], target: number, maxMultiple = 2): TargetResult {
  const lower = current.map((v) => 0.5 * v)
  const upper = current.map((v) => maxMultiple * v)
  const total = current.reduce((s, v) => s + v, 0)
  const top = upper.reduce((s, v) => s + v, 0)
  const at = (budget: number) => optimise(draws, current, { budget, lower, upper })
  const finish = (plan: Plan, reachable: boolean, maxLift: number): TargetResult => {
    const { lift } = liftDraws(draws, current, plan.recommended)
    return { reachable, budget: plan.budget, extra_budget: plan.budget - total, plan, prob_target: lift.filter((v) => v >= target).length / lift.length, max_lift: maxLift }
  }
  const best = at(top)
  if (best.lift.mean < target) return finish(best, false, best.lift.mean)
  const same = at(total)
  if (same.lift.mean >= target) return finish(same, true, best.lift.mean)
  let lo = total
  let hi = top
  let plan = best
  for (let i = 0; i < 14 && hi - lo > total * 0.002; i++) {
    const mid = (lo + hi) / 2
    const p = at(mid)
    if (p.lift.mean >= target) {
      hi = mid
      plan = p
    } else lo = mid
  }
  return finish(plan, true, best.lift.mean)
}


// ------------------------------------------------------------------ breakdown: channels made of items

const N_CHANNEL_GRID = 41
const INNER_STEPS = 200
export const SHARE_SLACK = 0.25 // an item's share of its channel may move by this much, relative
export const PROB_GATE = 0.8 // re-split a channel only when the draws say the re-split helps at least this often

export interface ItemPlan extends Plan {
  mode: 'keep' | 'resplit'
  by_channel: { name: string; current: number; recommended: number; lower: number; upper: number; items_resplit: boolean; p_resplit_helps: number | null }[]
  lift_between: number
  lift_within: number
}

export interface ItemLimits {
  budget?: number
  channelLower?: number[]
  channelUpper?: number[]
  slack?: number
  gate?: number
}

/**
 * Two-level optimiser. `draws` is item level (every item is a "channel") with draws.groups saying which channel each
 * item is in. Money moves between channels first, then (mode "resplit") between a channel's items, only in channels
 * where the re-split helps in at least `gate` of the draws. Mirror of optimise_items() in optimise.py.
 */
export function optimiseItems(draws: Draws, current: number[], mode: 'keep' | 'resplit' = 'keep', limits: ItemLimits = {}): ItemPlan {
  const groups = draws.groups!
  const chan = groups.channel_of
  const nItems = current.length
  const nChan = groups.channel_names.length
  const slack = limits.slack ?? SHARE_SLACK
  const gate = limits.gate ?? PROB_GATE
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0)
  const members: number[][] = Array.from({ length: nChan }, () => [])
  chan.forEach((c, i) => members[c].push(i))
  const curC = members.map((m) => sum(m.map((i) => current[i])))
  const share = current.map((v, i) => (curC[chan[i]] > 0 ? v / curC[chan[i]] : 1 / members[chan[i]].length))
  const lowerC = limits.channelLower ?? curC.map((v) => 0.5 * v)
  const upperC = (limits.channelUpper ?? curC.map((v) => 1.5 * v)).map((u, c) => Math.max(u, lowerC[c]))
  const requested = limits.budget ?? sum(curC)
  const notes: string[] = []
  let budget = requested
  if (budget < sum(lowerC) - 1e-9) {
    budget = sum(lowerC)
    notes.push('The budget is below the sum of the channel minimums, so the minimums were used.')
  } else if (budget > sum(upperC) + 1e-9) {
    budget = sum(upperC)
    notes.push('The budget is above the sum of the channel maximums, so the maximums were used.')
  }

  const tops = current.map((v, i) => Math.max(upperC[chan[i]] * share[i] * (1 + slack), v * 1.5))
  const curve = averagedCurves(draws, tops)
  const D = draws.beta.length
  const resp = (i: number, d: number, x: number) => response(draws, d, i, x)

  const splitInside = (c: number, xTotal: number, steps: number): number[] => {
    const m = members[c]
    const lo = m.map((i) => (1 - slack) * share[i] * xTotal)
    const hi = m.map((i, k) => Math.max(Math.min((1 + slack) * share[i] * xTotal, tops[i]), lo[k]))
    return allocate((k, v) => curve(m[k], v), lo, hi, xTotal, steps)
  }

  const useResplit: boolean[] = new Array(nChan).fill(false)
  const pHelps: number[] = new Array(nChan).fill(0)
  if (mode === 'resplit') {
    for (let c = 0; c < nChan; c++) {
      const m = members[c]
      if (m.length < 2 || curC[c] <= 0) continue
      const best = splitInside(c, curC[c], INNER_STEPS)
      let helps = 0
      for (let d = 0; d < D; d++) {
        let diff = 0
        m.forEach((i, k) => {
          diff += resp(i, d, best[k]) - resp(i, d, current[i])
        })
        if (diff > 0) helps++
      }
      pHelps[c] = helps / D
      useResplit[c] = pHelps[c] >= gate
    }
  }

  // each channel's expected response as a function of its total, on a grid
  const grids: number[][] = []
  const values: number[][] = []
  for (let c = 0; c < nChan; c++) {
    const top = Math.max(upperC[c], 1e-9)
    const gx = Array.from({ length: N_CHANNEL_GRID }, (_, k) => (top * k) / (N_CHANNEL_GRID - 1))
    const gv = gx.map((xv) => {
      if (useResplit[c] && xv > 0) {
        const part = splitInside(c, xv, INNER_STEPS)
        return members[c].reduce((s, i, j) => s + curve(i, part[j]), 0)
      }
      return members[c].reduce((s, i) => s + curve(i, xv * share[i]), 0)
    })
    grids.push(gx)
    values.push(gv)
  }
  const interp = (c: number, v: number) => {
    const gx = grids[c]
    const top = gx[gx.length - 1]
    const pos = (Math.min(Math.max(v, 0), top) / (top || 1)) * (N_CHANNEL_GRID - 1)
    const i = Math.min(Math.floor(pos), N_CHANNEL_GRID - 2)
    const f = pos - i
    return values[c][i] * (1 - f) + values[c][i + 1] * f
  }
  const xc = allocate(interp, lowerC, upperC, budget)

  let x: number[] = new Array(nItems).fill(0)
  let keepMix: number[] = new Array(nItems).fill(0)
  for (let c = 0; c < nChan; c++) {
    const m = members[c]
    m.forEach((i) => (keepMix[i] = xc[c] * share[i]))
    const part = useResplit[c] && xc[c] > 0 ? splitInside(c, xc[c], 400) : m.map((i) => keepMix[i])
    m.forEach((i, k) => (x[i] = part[k]))
  }
  const total = (v: number[]) => v.reduce((s, val, i) => s + curve(i, val), 0)
  const feasibleNow =
    Math.abs(sum(curC) - budget) <= 1e-6 * Math.max(budget, 1) && curC.every((v, c) => v >= lowerC[c] - 1e-9 && v <= upperC[c] + 1e-9)
  if (feasibleNow && total(current) > total(x)) {
    x = [...current]
    keepMix = [...current]
  }

  const lift: number[] = []
  const between: number[] = []
  const liftPct: number[] = []
  let curMean = 0
  let recMean = 0
  for (let d = 0; d < D; d++) {
    let cur = 0
    let rec = 0
    let keep = 0
    for (let i = 0; i < nItems; i++) {
      cur += resp(i, d, current[i])
      rec += resp(i, d, x[i])
      keep += resp(i, d, keepMix[i])
    }
    curMean += cur / D
    recMean += rec / D
    lift.push(rec - cur)
    between.push(keep - cur)
    liftPct.push(((rec - cur) / Math.max(cur, 1e-9)) * 100)
  }
  const sorted = [...lift].sort((a, b) => a - b)
  const sortedPct = [...liftPct].sort((a, b) => a - b)
  const itemLower = [...x]
  const itemUpper = [...x]
  for (let c = 0; c < nChan; c++) {
    if (!useResplit[c]) continue
    members[c].forEach((i) => {
      itemLower[i] = (1 - slack) * share[i] * xc[c]
      itemUpper[i] = (1 + slack) * share[i] * xc[c]
    })
  }
  const byChannel = groups.channel_names.map((name, c) => {
    const m = members[c]
    if (mode === 'resplit' && m.length > 1 && !useResplit[c]) {
      notes.push(`${name}: the data cannot tell its items apart well enough to move money between them (the re-split helps in ${(pHelps[c] * 100).toFixed(0)}% of draws, under ${(gate * 100).toFixed(0)}%). Test before moving.`)
    }
    return {
      name,
      current: curC[c],
      recommended: sum(m.map((i) => x[i])),
      lower: lowerC[c],
      upper: upperC[c],
      items_resplit: useResplit[c],
      p_resplit_helps: m.length > 1 && mode === 'resplit' ? pHelps[c] : null,
    }
  })
  const maxWeekly = draws.max_weekly ?? draws.xmax
  const meanOf = (a: number[]) => sum(a) / a.length
  return {
    budget,
    requested_budget: requested,
    channels: draws.channels,
    current: [...current],
    recommended: x,
    lower: itemLower,
    upper: itemUpper,
    extrapolated: x.map((v, i) => v > EXTRAPOLATION * maxWeekly[i]),
    expected_current: curMean,
    expected_recommended: recMean,
    lift: { mean: meanOf(lift), median: percentile(sorted, 0.5), low: percentile(sorted, 0.05), high: percentile(sorted, 0.95) },
    lift_pct: { mean: curMean > 0 ? ((recMean - curMean) / curMean) * 100 : 0, low: percentile(sortedPct, 0.05), high: percentile(sortedPct, 0.95) },
    prob_better: lift.filter((v) => v > 0).length / D,
    notes,
    mode,
    by_channel: byChannel,
    lift_between: meanOf(between),
    lift_within: meanOf(lift) - meanOf(between),
  }
}
