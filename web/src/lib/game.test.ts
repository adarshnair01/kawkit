import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Draws } from '../api/types'
import { at } from '../components/CurveExplorer'
import { newRound, rating, scoreSplit } from './game'

const draws = JSON.parse(readFileSync(new URL('../../public/sample/draws.json', import.meta.url), 'utf8')) as Draws

describe('beat the model', () => {
  it('scores the model’s own split at about 100% and the current split at 0%', () => {
    const r = newRound(draws)
    expect(r.budget).toBeCloseTo(draws.current.reduce((a, b) => a + b, 0), 6)
    expect(scoreSplit(draws, r, r.best_split).share).toBeGreaterThan(0.98)
    expect(scoreSplit(draws, r, draws.current).share).toBe(0)
  })
  it('keeps the model’s split inside the allowed range and on budget', () => {
    const r = newRound(draws)
    r.best_split.forEach((v, i) => {
      expect(v).toBeGreaterThanOrEqual(r.lower[i] - 1e-6)
      expect(v).toBeLessThanOrEqual(r.upper[i] + 1e-6)
    })
    expect(r.best_split.reduce((a, b) => a + b, 0)).toBeCloseTo(r.budget, 0)
  })
  it('a deliberately bad split scores low', () => {
    const r = newRound(draws)
    const worst = draws.current.map((v, i) => (r.best_split[i] > v ? r.lower[i] : r.upper[i]))
    expect(scoreSplit(draws, r, worst).share).toBeLessThan(0.2)
  })
  it('rates scores in words', () => {
    expect([1, 0.9, 0.7, 0.2, 0].map(rating)).toEqual(['Model whisperer', 'Sharp', 'Decent instinct', 'A start', 'Back to the spreadsheet'])
  })
})

describe('curve interpolation', () => {
  it('interpolates and clamps at the ends', () => {
    const xs = [0, 10, 20]
    const ys = [0, 5, 6]
    expect(at(xs, ys, 5)).toBeCloseTo(2.5)
    expect(at(xs, ys, 15)).toBeCloseTo(5.5)
    expect(at(xs, ys, -3)).toBe(0)
    expect(at(xs, ys, 99)).toBe(6)
  })
})
