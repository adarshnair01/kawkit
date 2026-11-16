import { describe, expect, it } from 'vitest'
import type { ChannelResult } from '../api/types'
import { testCandidates } from './testNext'

const ch = (name: string, weekly: number, low: number, high: number) => ({ name, current_weekly: weekly, roi: { low, high, median: (low + high) / 2 } }) as unknown as ChannelResult

describe('what to test next', () => {
  it('ranks by spend times the width of the range, not by either alone', () => {
    const r = testCandidates([ch('big_sure', 10000, 1.9, 2.1), ch('big_unsure', 8000, 0.5, 3.5), ch('small_unsure', 1000, 0.1, 9), ch('tiny', 100, 0, 50)])
    expect(r.map((c) => c.name)).toEqual(['big_unsure', 'small_unsure', 'big_sure'])
    expect(r[0].swing).toBe(24000)
    expect(r[0].revenueLow).toBe(4000)
    expect(r.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1)
  })
  it('returns nothing when there is no current spend', () => {
    expect(testCandidates([ch('a', 0, 1, 2)])).toEqual([])
  })
})
