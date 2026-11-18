import type { Draws } from '../api/types'
import { evaluate, optimise } from '../optimizer/optimize'

export interface Round {
  budget: number
  lower: number[]
  upper: number[]
  /** the model's best expected weekly gain at the same total spend */
  best: number
  best_split: number[]
}

/** Each channel may go from half to one and a half times its current spend, at the same total, as in the optimiser's defaults. */
export function newRound(draws: Draws): Round {
  const plan = optimise(draws, draws.current)
  return {
    budget: draws.current.reduce((a, b) => a + b, 0),
    lower: draws.current.map((v) => v * 0.5),
    upper: draws.current.map((v) => v * 1.5),
    best: plan.lift.mean,
    best_split: plan.recommended,
  }
}

export function scoreSplit(draws: Draws, round: Round, split: number[]) {
  const e = evaluate(draws, draws.current, split)
  const share = round.best > 0 ? Math.max(0, Math.min(1, e.lift.mean / round.best)) : 0
  return { lift: e.lift.mean, low: e.lift.low, high: e.lift.high, prob_better: e.prob_better, share }
}

export function rating(share: number): string {
  if (share >= 0.97) return 'Model whisperer'
  if (share >= 0.85) return 'Sharp'
  if (share >= 0.6) return 'Decent instinct'
  if (share > 0) return 'A start'
  return 'Back to the spreadsheet'
}
