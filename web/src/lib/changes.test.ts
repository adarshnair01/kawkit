import { describe, expect, it } from 'vitest'
import { whatChanged } from './changes'

const r = (name: string, median: number, low: number, high: number) => ({ name, roi: { median, low, high } })

describe('whatChanged', () => {
  it('flags a shift whose ranges do not overlap above one whose ranges do', () => {
    const lines = whatChanged([r('tv', 1, 0.8, 1.2), r('search', 2, 1, 3)], [r('tv', 2, 1.6, 2.4), r('search', 2.6, 1.2, 4)])
    expect(lines[0]).toMatch(/^Tv is up from 1.00 to 2.00.*do not overlap/)
    expect(lines[1]).toMatch(/Search.*overlap, so this may be noise/)
  })
  it('notes channels that are in one run only and tiny moves', () => {
    const lines = whatChanged([r('tv', 1, 0.5, 1.5), r('radio', 1, 0.5, 1.5)], [r('tv', 1.02, 0.5, 1.5), r('social', 1, 0.5, 1.5)])
    expect(lines.join(' ')).toMatch(/Radio is only in run A/)
    expect(lines.join(' ')).toMatch(/Social is only in run B/)
    expect(lines.join(' ')).toMatch(/Tv barely moved/)
  })
})

import { normaliseTags } from '../api/runs'
describe('normaliseTags', () => {
  it('accepts real arrays and Postgres text arrays', () => {
    expect(normaliseTags(['a', 'b'])).toEqual(['a', 'b'])
    expect(normaliseTags('{client-a,q3}')).toEqual(['client-a', 'q3'])
    expect(normaliseTags('{}')).toEqual([])
    expect(normaliseTags(undefined)).toEqual([])
  })
})
