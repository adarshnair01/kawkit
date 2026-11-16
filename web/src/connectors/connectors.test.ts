import { describe, expect, it } from 'vitest'
import { validateCsv } from '../validation/validate'
import { alignMonthly, monthBefore, withControls } from './economy'
import { blackFriday, easterSunday, eventFlags, withEvents } from './events'
import fixture from './events.fixture.json'
import { fetchLink, LinkError, resolveLink } from './link'
import { applyMapping, checkMapping, detectDateFormat, guessColumns, isCanonical, readSheet, slug, toIsoDate } from './mapping'

const iso = (t: number) => new Date(t).toISOString().slice(0, 10)

describe('column mapper', () => {
  const messy = ['Week commencing,Sales (£),TV cost,Paid Search Spend,Facebook Ads,Promo running,Notes', ...Array.from({ length: 60 }, (_, i) => {
    const d = new Date(Date.UTC(2023, 0, 2 + 7 * i))
    return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()},"£${(50000 + 700 * (i % 9)).toLocaleString('en-GB')}",${1000 + 300 * (i % 5)},${800 + 90 * (i % 7)},${500 + 120 * (i % 4)},${i % 8 === 0 ? 1 : 0},ok`
  })].join('\n')

  it('recognises a file that is already in the right layout', () => {
    expect(isCanonical(['date', 'revenue', 'spend_tv'])).toBe(true)
    expect(isCanonical(['Week', 'Sales', 'TV cost'])).toBe(false)
  })

  it('guesses roles from names and values', () => {
    const cols = guessColumns(readSheet(messy))
    expect(cols.map((c) => c.role)).toEqual(['date', 'revenue', 'spend', 'spend', 'spend', 'control', 'ignore'])
    expect(cols.filter((c) => c.role === 'spend').map((c) => c.name)).toEqual(['tv', 'paid_search', 'facebook'])
    expect(checkMapping(cols)).toEqual([])
  })

  it('produces a file the validator accepts, with dates converted', () => {
    const sheet = readSheet(messy)
    const cols = guessColumns(sheet)
    const { format, ambiguous } = detectDateFormat(sheet.rows.map((r) => r[0]))
    expect([format, ambiguous]).toEqual(['dmy', false])
    const v = validateCsv(applyMapping(sheet, cols, format))
    expect(v.errors).toEqual([])
    expect(v.summary?.weeks).toBe(60)
    expect(v.dataset?.channels).toEqual(['tv', 'paid_search', 'facebook'])
    expect(v.dataset?.controlNames).toEqual(['promo_running'])
    expect(v.dataset?.dates[0]).toBe('2023-01-02')
    expect(v.dataset?.y[1]).toBe(50700)
  })

  it('reports what is missing or duplicated', () => {
    const cols = guessColumns(readSheet('a,b\nx,y\n'))
    expect(checkMapping(cols).length).toBe(3)
    const two = guessColumns(readSheet('date,revenue,TV spend,TV cost\n2024-01-01,10,1,2\n'))
    expect(checkMapping(two).some((p) => /share the name/.test(p.message))).toBe(true)
  })

  it('converts common date formats and leaves bad ones for the validator to flag', () => {
    expect(toIsoDate('25/03/2024', 'dmy')).toBe('2024-03-25')
    expect(toIsoDate('03/25/2024', 'mdy')).toBe('2024-03-25')
    expect(toIsoDate('5.1.24', 'dmy')).toBe('2024-01-05')
    expect(toIsoDate('2024/3/5', 'ymd_slash')).toBe('2024-03-05')
    expect(toIsoDate('2024-03-25T00:00:00', 'iso')).toBe('2024-03-25')
    expect(toIsoDate('25 Mar 2024', 'text')).toBe('2024-03-25')
    expect(toIsoDate('March 25, 2024', 'text')).toBe('2024-03-25')
    expect(toIsoDate('soon', 'dmy')).toBe('soon')
    expect(detectDateFormat(['01/02/2024', '03/04/2024'])).toEqual({ format: 'dmy', ambiguous: true })
    expect(detectDateFormat(['01/13/2024'])).toEqual({ format: 'mdy', ambiguous: false })
    expect(slug('Paid Search Spend (£)')).toBe('paid_search')
  })
})

describe('calendar events', () => {
  it('matches the worker on Monday-start weeks', () => {
    const f = eventFlags(fixture.weeks)
    for (const k of ['black_friday', 'cyber_week', 'pre_christmas', 'christmas_newyear'] as const) expect(f[k]).toEqual(fixture[k])
    // the worker only lists Easter for 2021 to 2024
    fixture.weeks.forEach((w, i) => {
      if (w >= '2021-01-01' && w < '2025-01-01') expect(f.easter[i]).toBe(fixture.easter[i])
    })
  })

  it('knows the dates', () => {
    expect([2022, 2023, 2024, 2025].map((y) => iso(blackFriday(y)))).toEqual(['2022-11-25', '2023-11-24', '2024-11-29', '2025-11-28'])
    expect([2019, 2020, 2024, 2025, 2026].map((y) => iso(easterSunday(y)))).toEqual(['2019-04-21', '2020-04-12', '2024-03-31', '2025-04-20', '2026-04-05'])
  })

  it('works for weeks that do not start on Monday', () => {
    const f = eventFlags(['2023-11-19', '2023-11-26', '2023-12-24']) // Sundays
    expect([f.black_friday, f.cyber_week, f.christmas_newyear]).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]])
  })

  it('adds only events that happen in some weeks, and keeps existing columns', () => {
    const rows = Array.from({ length: 60 }, (_, i) => `${iso(Date.UTC(2023, 0, 2 + 7 * i))},${1000 + i},${10 + (i % 5)},${i % 6 === 0 ? 1 : 0}`)
    const ds = validateCsv(['date,revenue,spend_tv,control_promo', ...rows].join('\n')).dataset!
    const { csv, added, skipped } = withEvents(ds, ['black_friday', 'easter', 'christmas_newyear'])
    expect(added).toEqual(['black_friday', 'easter', 'christmas_newyear'])
    expect(skipped).toEqual([])
    const v = validateCsv(csv)
    expect(v.errors).toEqual([])
    expect(v.dataset?.controlNames).toEqual(['promo', 'black_friday', 'easter', 'christmas_newyear'])
    expect(withEvents(v.dataset!, ['black_friday']).added).toEqual([]) // already there
    const short = validateCsv(['date,revenue,spend_tv', ...rows.slice(10, 40).map((r) => r.split(',').slice(0, 3).join(','))].join('\n'))
    expect(short.dataset).toBeNull() // too few weeks: nothing to add to
  })
})

describe('import from a link', () => {
  it('turns Google Sheets links into CSV addresses', () => {
    expect(resolveLink('https://docs.google.com/spreadsheets/d/abc123/edit#gid=42')).toEqual({ kind: 'google_sheet', url: 'https://docs.google.com/spreadsheets/d/abc123/gviz/tq?tqx=out:csv&gid=42' })
    expect(resolveLink('https://docs.google.com/spreadsheets/d/abc123/edit?usp=sharing')?.url).toBe('https://docs.google.com/spreadsheets/d/abc123/gviz/tq?tqx=out:csv')
    expect(resolveLink('https://docs.google.com/spreadsheets/d/e/2PACX-xyz/pubhtml?gid=7')?.url).toBe('https://docs.google.com/spreadsheets/d/e/2PACX-xyz/pub?output=csv&gid=7')
    expect(resolveLink('https://example.com/data.csv')).toEqual({ kind: 'csv', url: 'https://example.com/data.csv' })
    expect(resolveLink('http://example.com/data.csv')).toBeNull()
    expect(resolveLink('not a link')).toBeNull()
  })

  it('explains private sheets, web pages and blocked addresses', async () => {
    const sheet = { kind: 'google_sheet' as const, url: 'https://docs.google.com/x' }
    const ok = (async () => new Response('date,revenue\n2024-01-01,5\n')) as unknown as typeof fetch
    expect(await fetchLink(sheet, ok)).toContain('revenue')
    const login = (async () => new Response('<!DOCTYPE html><html>Sign in</html>')) as unknown as typeof fetch
    await expect(fetchLink(sheet, login)).rejects.toThrow(/anyone with the link/)
    const denied = (async () => new Response('', { status: 403 })) as unknown as typeof fetch
    await expect(fetchLink(sheet, denied)).rejects.toBeInstanceOf(LinkError)
    const blocked = (async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch
    await expect(fetchLink({ kind: 'csv', url: 'https://example.com/a.csv' }, blocked)).rejects.toThrow(/download the file/)
  })
})

describe('economy connector', () => {
  const monthly = (from: string, n: number, f: (i: number) => number) =>
    Array.from({ length: n }, (_, i) => ({ date: monthBefore(from, -i), value: f(i) }))
  const weeks = Array.from({ length: 60 }, (_, i) => iso(Date.UTC(2023, 0, 2 + 7 * i)))

  it('finds the month before', () => {
    expect(monthBefore('2024-03-25', 1)).toBe('2024-02-01')
    expect(monthBefore('2024-01-08', 1)).toBe('2023-12-01')
    expect(monthBefore('2024-01-08', 14)).toBe('2022-11-01')
  })

  it('gives each week the previous month\u2019s figure', () => {
    const obs = monthly('2022-11-01', 20, (i) => 100 + i) // Nov 2022 = 100, Dec = 101, Jan 2023 = 102 ...
    const a = alignMonthly(weeks, obs)
    expect(a.ok).toBe(true)
    if (!a.ok) return
    expect(a.values[0]).toBe(101) // week of 2 Jan 2023 uses December 2022
    expect(a.values[4]).toBe(101) // 30 Jan 2023 still uses December
    expect(a.values[5]).toBe(102) // 6 Feb 2023 uses January
    expect(a.values).toHaveLength(60)
  })

  it('refuses series that start late, stop early or never change', () => {
    expect(alignMonthly(weeks, [])).toMatchObject({ ok: false })
    expect(alignMonthly(weeks, monthly('2023-03-01', 20, (i) => i))).toMatchObject({ ok: false, reason: expect.stringMatching(/only start/) })
    expect(alignMonthly(weeks, monthly('2022-11-01', 6, (i) => i))).toMatchObject({ ok: false, reason: expect.stringMatching(/stop in 2023-04/) })
    expect(alignMonthly(weeks, monthly('2022-11-01', 20, () => 5))).toMatchObject({ ok: false, reason: expect.stringMatching(/does not change/) })
    // a series that ends up to 3 months early is carried forward
    expect(alignMonthly(weeks, monthly('2022-11-01', 13, (i) => i)).ok).toBe(true)
  })

  it('appends the new columns without touching what is there', () => {
    const rows = weeks.map((w, i) => `${w},${1000 + i},${10 + (i % 5)},${i % 6 === 0 ? 1 : 0}`)
    const ds = validateCsv(['date,revenue,spend_tv,control_promo', ...rows].join('\n')).dataset!
    const v = validateCsv(withControls(ds, { unemployment: weeks.map((_, i) => 4 + (i % 7) / 10), promo: weeks.map(() => 9) }))
    expect(v.errors).toEqual([])
    expect(v.dataset?.controlNames).toEqual(['promo', 'unemployment'])
    expect(v.dataset?.controls[3]).toEqual([0, 4.3])
  })
})
