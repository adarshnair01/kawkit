/** One-click repairs for the problems the checker reports. Each returns new CSV text; the checker then runs again. */
import type { DataError } from '../api/types'
import { detectDateFormat, toIsoDate } from '../connectors/mapping'
import { parseCsv } from './csv'

export interface Fix {
  id: string
  label: string
  detail: string
  apply: (text: string) => string
}

const quote = (c: string) => (/[",\n\r]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)
const toCsv = (rows: string[][]) => rows.map((r) => r.map(quote).join(',')).join('\n') + '\n'
const MISSING = /^\s*(|-|--|n\/?a|na|nan|null|none|\.)\s*$/i

interface Table {
  header: string[]
  rows: string[][]
}
function table(text: string): Table {
  const all = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''))
  return { header: (all[0] ?? []).map((h) => h.trim().toLowerCase()), rows: all.slice(1) }
}
const out = (t: Table) => toCsv([t.header, ...t.rows])

function fixDates(text: string): string {
  const t = table(text)
  const di = t.header.indexOf('date')
  if (di < 0) return text
  const { format } = detectDateFormat(t.rows.map((r) => r[di] ?? ''))
  for (const r of t.rows) r[di] = toIsoDate(r[di] ?? '', format)
  return out(t)
}

function dropDuplicateDates(text: string): string {
  const t = table(text)
  const di = t.header.indexOf('date')
  const seen = new Set<string>()
  t.rows = t.rows.filter((r) => {
    const d = (r[di] ?? '').trim()
    if (seen.has(d)) return false
    seen.add(d)
    return true
  })
  return out(t)
}

/** Blank or "n/a" cells in spend and control columns become 0. Revenue is never invented. */
function zeroFill(text: string): string {
  const t = table(text)
  const cols = t.header.map((h, i) => (h.startsWith('spend_') || h.startsWith('control_') ? i : -1)).filter((i) => i >= 0)
  for (const r of t.rows) for (const i of cols) if (MISSING.test(r[i] ?? '')) r[i] = '0'
  return out(t)
}

function clipNegativeSpend(text: string): string {
  const t = table(text)
  const cols = t.header.map((h, i) => (h.startsWith('spend_') ? i : -1)).filter((i) => i >= 0)
  for (const r of t.rows) for (const i of cols) if (/^\s*-\s*[\d.,]/.test(r[i] ?? '')) r[i] = '0'
  return out(t)
}

export function availableFixes(errors: DataError[]): Fix[] {
  const codes = new Set(errors.map((e) => e.code))
  const fixes: Fix[] = []
  if (codes.has('bad_date'))
    fixes.push({ id: 'dates', label: 'Convert the dates', detail: 'Rewrites dates such as 31/12/2024 or 12 Dec 2024 as 2024-12-31. Day first is assumed when it is unclear.', apply: fixDates })
  if (codes.has('duplicate_date'))
    fixes.push({ id: 'dupes', label: 'Keep the first row for each date', detail: 'Removes later rows that repeat a date.', apply: dropDuplicateDates })
  if (errors.some((e) => e.code === 'bad_value' && !/'revenue'/.test(e.message)))
    fixes.push({ id: 'zero', label: 'Treat blank spend and control cells as 0', detail: 'Blank, “n/a” or “-” cells in spend and control columns become 0. Revenue is never filled in.', apply: zeroFill })
  if (codes.has('negative_spend'))
    fixes.push({ id: 'neg', label: 'Set negative spend to 0', detail: 'Refunds or credits in a spend column are treated as no spend that week.', apply: clipNegativeSpend })
  return fixes
}
