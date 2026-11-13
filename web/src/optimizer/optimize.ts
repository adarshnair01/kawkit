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
export function allocate(curve: CurveFn, lower: number[], upper: number[], budget: number): number[] {
  const n = lower.length
  const x = [...lower]
  let remaining = budget - x.reduce((a, b) => a + b, 0)
  const step = budget > 0 ? budget / STEPS : 0

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
