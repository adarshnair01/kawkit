import { describe, expect, it } from 'vitest'
import type { Draws } from '../api/types'
import { optimise, response } from './optimize'

function fixed(beta: number[], lam: number[], xmax: number[], current: number[]): Draws {
  return { channels: beta.map((_, i) => `c${i}`), ymax: 1000, xmax, max_weekly: xmax, current, beta: [beta], lam: [lam], alpha: [beta.map(() => 0.3)] }
}

/** Deterministic pseudo-random draws. */
function randomDraws(n: number, d: number, seed = 1): Draws {
  let s = seed
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
  const xmax = Array.from({ length: n }, () => 10000 + rnd() * 40000)
  const current = xmax.map((x) => x * (0.2 + 0.5 * rnd()))
  const base = Array.from({ length: n }, () => [0.05 + rnd() * 0.3, 1 + rnd() * 5])
  return {
    channels: Array.from({ length: n }, (_, i) => `ch${i}`),
    ymax: 500000,
    xmax,
    max_weekly: xmax,
    current,
    beta: Array.from({ length: d }, () => base.map(([b]) => b * (0.6 + 0.8 * rnd()))),
    lam: Array.from({ length: d }, () => base.map(([, l]) => l * (0.6 + 0.8 * rnd()))),
    alpha: Array.from({ length: d }, () => base.map(() => rnd())),
  }
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)

describe('optimiser', () => {
  it('spends exactly the budget and never breaks a limit', () => {
    const draws = randomDraws(6, 300)
    for (const factor of [0.8, 1, 1.3]) {
      const plan = optimise(draws, draws.current, { budget: sum(draws.current) * factor })
      expect(sum(plan.recommended)).toBeCloseTo(plan.budget, 6)
      plan.recommended.forEach((v, c) => {
        expect(v).toBeGreaterThanOrEqual(plan.lower[c] - 1e-6)
        expect(v).toBeLessThanOrEqual(plan.upper[c] + 1e-6)
      })
    }
  })

  it('is never worse than the current split in expectation', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const draws = randomDraws(8, 200, seed)
      const plan = optimise(draws, draws.current)
      expect(plan.expected_recommended).toBeGreaterThanOrEqual(plan.expected_current - 1e-9)
      expect(plan.prob_better).toBeGreaterThanOrEqual(0)
      expect(plan.lift.low).toBeLessThanOrEqual(plan.lift.high)
    }
  })

  it('matches a brute-force search within 0.1% on two channels with fixed curves', () => {
    const cases: [number[], number[], number[], number][] = [
      [[0.5, 0.3], [3, 1.5], [100, 80], 120],
      [[0.2, 0.6], [5, 2], [50, 200], 160],
      [[0.4, 0.4], [1, 6], [100, 100], 90],
    ]
    for (const [beta, lam, xmax, budget] of cases) {
      const draws = fixed(beta, lam, xmax, [budget / 2, budget / 2])
      const lower = [10, 10]
      const upper = [150, 150]
      const plan = optimise(draws, draws.current, { budget, lower, upper })
      const value = (x0: number) => response(draws, 0, 0, x0) + response(draws, 0, 1, budget - x0)
      const lo = Math.max(lower[0], budget - upper[1])
      const hi = Math.min(upper[0], budget - lower[1])
      let best = -Infinity
      for (let i = 0; i <= 20000; i++) best = Math.max(best, value(lo + ((hi - lo) * i) / 20000))
      const got = value(plan.recommended[0])
      expect(got).toBeGreaterThanOrEqual(best * (1 - 1e-3))
      expect(got).toBeLessThanOrEqual(best * (1 + 1e-6))
    }
  })

  it('explains impossible budgets, honours locks and flags extrapolation', () => {
    const draws = fixed([0.5, 0.3], [3, 1.5], [100, 80], [60, 40])
    const low = optimise(draws, draws.current, { budget: 10 })
    expect(low.budget).toBeCloseTo(50)
    expect(low.notes[0]).toMatch(/below/)
    const high = optimise(draws, draws.current, { budget: 1000 })
    expect(high.budget).toBeCloseTo(150)
    expect(high.notes[0]).toMatch(/above/)
    const locked = optimise(draws, draws.current, { budget: 100, lower: [60, 0], upper: [60, 100] })
    expect(locked.recommended[0]).toBeCloseTo(60)
    expect(locked.recommended[1]).toBeCloseTo(40)
    const big = optimise(draws, draws.current, { budget: 300, lower: [0, 0], upper: [250, 250] })
    expect(big.extrapolated.some(Boolean)).toBe(true)
  })

  it('re-optimises 15 channels over 500 draws well inside 2 seconds', () => {
    const draws = randomDraws(15, 500)
    const t = performance.now()
    optimise(draws, draws.current, { budget: sum(draws.current) * 1.1 })
    expect(performance.now() - t).toBeLessThan(2000)
  })
})
