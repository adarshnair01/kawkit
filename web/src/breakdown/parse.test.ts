import { describe, expect, it } from 'vitest'
import { validateCsv } from '../validation/validate'
import fixture from './fixture.json'
import { analyse, readLong, separability, trimmedCsv, type LongFile } from './parse'

const ds = validateCsv(fixture.main).dataset!
const long = readLong(fixture.long) as LongFile

describe('breakdown parser (matches the python one)', () => {
  it('builds the same items with the same spend', () => {
    const a = analyse(ds, long, fixture.spec)
    expect(a.errors).toEqual([])
    expect(a.plans.every((p) => !p.error)).toBe(true)
    const theirs = a.plans.flatMap((p) => p.items.map((it) => ({ name: `${p.channel} / ${it.name}`, total: it.spend.reduce((s, v) => s + v, 0) })))
    const py = fixture.items.filter((i) => i.name.includes(' / ')).map((i) => ({ name: i.name, total: i.total }))
    expect(theirs.map((t) => t.name).sort()).toEqual(py.map((t) => t.name).sort())
    for (const t of theirs) expect(t.total).toBeCloseTo(py.find((p) => p.name === t.name)!.total, 0)
  })
  it('offers dimensions and channels from the file', () => {
    expect(long.dimensions).toEqual(['platform', 'region'])
    expect(long.channels).toEqual(['social', 'display', 'search'])
  })
  it('rates items that move independently as separable and a constant mix as not', () => {
    const a = analyse(ds, long, fixture.spec)
    const by = Object.fromEntries(a.plans.map((p) => [p.channel, p]))
    expect(by.social.separability).toBe('good')
    expect(by.search.separability).toBe('none')
  })
})

describe('breakdown checks', () => {
  const spec = { social: { dims: ['platform'] } }
  it('rejects a breakdown that adds up to more than the channel', () => {
    const doubled = fixture.long.split('\n').map((l, i) => (i && l.includes(',social,') ? l.replace(/,(\d+)$/, (_, n) => `,${Number(n) * 1.5}`) : l)).join('\n')
    const a = analyse(ds, readLong(doubled) as LongFile, spec)
    expect(a.plans[0].error).toMatch(/adds up to .* more than social/)
  })
  it('keeps what a breakdown leaves out as its own item', () => {
    const noYoutube = fixture.long.split('\n').filter((l) => !l.includes(',youtube,')).join('\n')
    const p = analyse(ds, readLong(noYoutube) as LongFile, spec).plans[0]
    expect(p.items.map((i) => i.name)).toContain('Not broken down')
    expect(p.remainderShare).toBeGreaterThan(0.02)
  })
  it('folds many tiny values into Other and merges spellings', () => {
    const tiny = Array.from({ length: 9 }, (_, k) => `${ds.dates[3]},social,tiny${k},,1`).join('\n')
    const spelled = fixture.long.replace(/,meta,/g, ',META ,')
    const p = analyse(ds, readLong(`${spelled}${tiny}\n`) as LongFile, spec).plans[0]
    expect(p.items.map((i) => i.name)).toContain('Other')
    expect(p.items.filter((i) => /meta/i.test(i.name))).toHaveLength(1)
  })
  it('reports missing columns and bad values in plain words', () => {
    expect(readLong('date,spend\n2023-01-02,5\n')).toBe("The breakdown file needs a 'channel' column.")
    const bad = readLong('date,channel,platform,spend\nnope,social,a,5\n2023-01-02,social,a,abc\n') as LongFile
    const a = analyse(ds, bad, spec)
    expect(a.errors.join(' ')).toMatch(/Date is not YYYY-MM-DD.*row 2/)
    expect(a.errors.join(' ')).toMatch(/not a number.*row 3/)
  })
  it('trims the upload to the columns in use', () => {
    const text = trimmedCsv(long, { social: { dims: ['platform'] } })
    expect(text.split('\n')[0]).toBe('date,channel,platform,spend')
    expect(text).not.toContain(',display,')
  })
  it('separability: a constant mix is none, wobbling shares are good', () => {
    const flat = separability([[0.5, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]])
    expect(flat.level).toBe('none')
    const moving = separability([[0.2, 0.6, 0.3, 0.7], [0.8, 0.4, 0.7, 0.3]])
    expect(moving.level).toBe('good')
    expect(separability([[0.4, 0.6, 0.45, 0.55], [0.6, 0.4, 0.55, 0.45]]).level).toBe('weak')
    const free = separability([[0.2, 0.6, 0.3, 0.7, 0.4], [0.5, 0.2, 0.6, 0.1, 0.5], [0.3, 0.2, 0.1, 0.2, 0.1]])
    expect(free.level).toBe('good')
  })
})
