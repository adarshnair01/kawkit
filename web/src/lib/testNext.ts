import type { ChannelResult } from '../api/types'

export interface TestCandidate {
  name: string
  weeklySpend: number
  /** weekly revenue the channel brings in if its return is at the low or high end of its range */
  revenueLow: number
  revenueHigh: number
  /** how much weekly revenue hangs on not knowing: spend times the width of the ROI range */
  swing: number
  /** this channel's share of all the uncertainty across channels */
  share: number
  roiLow: number
  roiHigh: number
}

/**
 * Which channel is most worth an experiment: the one where the most money rides on the least
 * certain return. Channels under 3% of spend are left out; a test there cannot move much.
 */
export function testCandidates(channels: ChannelResult[]): TestCandidate[] {
  const total = channels.reduce((s, c) => s + c.current_weekly, 0)
  if (total <= 0) return []
  const rows = channels
    .filter((c) => c.current_weekly >= 0.03 * total)
    .map((c) => ({
      name: c.name,
      weeklySpend: c.current_weekly,
      revenueLow: c.current_weekly * c.roi.low,
      revenueHigh: c.current_weekly * c.roi.high,
      swing: c.current_weekly * (c.roi.high - c.roi.low),
      share: 0,
      roiLow: c.roi.low,
      roiHigh: c.roi.high,
    }))
  const all = rows.reduce((s, r) => s + r.swing, 0)
  return rows.map((r) => ({ ...r, share: all > 0 ? r.swing / all : 0 })).sort((a, b) => b.swing - a.swing)
}
