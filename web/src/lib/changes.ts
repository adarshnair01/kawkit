import type { Interval } from '../api/types'
import { title } from './format'

export interface RoiSide {
  name: string
  roi: Interval
}

/** Plain-language lines on how channel ROI moved between run A and run B, biggest move first. */
export function whatChanged(a: RoiSide[], b: RoiSide[]): string[] {
  const out: { size: number; text: string }[] = []
  for (const ca of a) {
    const cb = b.find((c) => c.name === ca.name)
    if (!cb) {
      out.push({ size: 0.5, text: `${title(ca.name)} is only in run A.` })
      continue
    }
    const overlap = ca.roi.low <= cb.roi.high && cb.roi.low <= ca.roi.high
    const diff = cb.roi.median - ca.roi.median
    const rel = Math.abs(diff) / Math.max(Math.abs(ca.roi.median), 0.05)
    const dir = diff > 0 ? 'up' : 'down'
    if (rel < 0.05) {
      out.push({ size: rel, text: `${title(ca.name)} barely moved (${ca.roi.median.toFixed(2)} to ${cb.roi.median.toFixed(2)}).` })
    } else {
      out.push({
        size: rel + (overlap ? 0 : 1),
        text: `${title(ca.name)} is ${dir} from ${ca.roi.median.toFixed(2)} to ${cb.roi.median.toFixed(2)} (${Math.round(rel * 100)}%). ${overlap ? 'The ranges overlap, so this may be noise.' : 'The ranges do not overlap, so this is a real shift.'}`,
      })
    }
  }
  for (const cb of b) if (!a.some((c) => c.name === cb.name)) out.push({ size: 0.5, text: `${title(cb.name)} is only in run B.` })
  return out.sort((x, y) => y.size - x.size).map((o) => o.text)
}
