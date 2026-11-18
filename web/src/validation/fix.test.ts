import { describe, expect, it } from 'vitest'
import { availableFixes } from './fix'
import { validateCsv } from './validate'

const weeks = (n: number, f: (i: number) => string[]) =>
  Array.from({ length: n }, (_, i) => f(i).join(',')).join('\n')
const iso = (i: number) => new Date(Date.UTC(2023, 0, 2) + i * 7 * 86400000).toISOString().slice(0, 10)
const run = (text: string) => {
  const v = validateCsv(text)
  const fixes = availableFixes(v.errors)
  return { v, fixes }
}

describe('one-click fixes', () => {
  it('converts day-first dates and the file then validates', () => {
    const dmy = (i: number) => iso(i).split('-').reverse().join('/')
    const text = `date,revenue,spend_tv\n${weeks(60, (i) => [dmy(i), String(1000 + i), String(100 + i)])}\n`
    const { v, fixes } = run(text)
    expect(v.errors.some((e) => e.code === 'bad_date')).toBe(true)
    const fixed = fixes.find((f) => f.id === 'dates')!.apply(text)
    expect(validateCsv(fixed).errors).toEqual([])
  })
  it('fills blank spend with zero but never revenue', () => {
    const text = `date,revenue,spend_tv\n${weeks(60, (i) => [iso(i), i === 3 ? '' : '1000', i === 5 ? 'n/a' : '100'])}\n`
    const { v, fixes } = run(text)
    expect(v.errors.length).toBe(2)
    const fixed = fixes.find((f) => f.id === 'zero')!.apply(text)
    const after = validateCsv(fixed)
    expect(after.errors.map((e) => e.message).join()).toMatch(/'revenue'/)
    expect(after.errors.some((e) => /spend_tv/.test(e.message))).toBe(false)
  })
  it('drops repeated dates and clips negative spend', () => {
    const rows = Array.from({ length: 60 }, (_, i) => [iso(i), '1000', i === 4 ? '-50' : '100'])
    rows.splice(10, 0, rows[10])
    const text = `date,revenue,spend_tv\n${rows.map((r) => r.join(',')).join('\n')}\n`
    const { fixes } = run(text)
    expect(fixes.map((f) => f.id).sort()).toEqual(['dupes', 'neg'])
    const fixed = fixes.reduce((t, f) => f.apply(t), text)
    expect(validateCsv(fixed).errors).toEqual([])
  })
  it('offers nothing for problems it cannot repair', () => {
    const text = `date,revenue\n${weeks(60, (i) => [iso(i), '1000'])}\n`
    expect(run(text).fixes).toEqual([])
  })
})
