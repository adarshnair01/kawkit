/**
 * Column mapper: turn a spreadsheet with any column names and common date formats into the
 * layout the model reads (date, revenue, spend_<channel>, control_<name>).
 */
import { parseCsv } from '../validation/csv'
import { parseNumber } from '../validation/validate'

export type Role = 'date' | 'revenue' | 'spend' | 'control' | 'ignore'
export type DateFormat = 'iso' | 'dmy' | 'mdy' | 'ymd_slash' | 'text'

export interface Column {
  index: number
  header: string
  sample: string[]
  numericShare: number
  role: Role
  name: string // label used after the prefix for spend and control columns
}

export interface Sheet {
  header: string[]
  rows: string[][]
}

export const DATE_FORMATS: Record<DateFormat, string> = {
  iso: 'Year-month-day (2024-03-25)',
  dmy: 'Day/month/year (25/03/2024)',
  mdy: 'Month/day/year (03/25/2024)',
  ymd_slash: 'Year/month/day (2024/03/25)',
  text: 'Written out (25 Mar 2024)',
}

export function readSheet(text: string): Sheet {
  const table = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''))
  return { header: (table[0] ?? []).map((h) => h.trim()), rows: table.slice(1) }
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(spend|cost|costs|budget|ads?|media|control)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'column'

/** True when the file already uses the model's layout, so no mapping is needed. */
export function isCanonical(header: string[]): boolean {
  const h = header.map((x) => x.trim().toLowerCase())
  return h.includes('date') && h.includes('revenue') && h.some((x) => x.startsWith('spend_') && x.length > 6)
}

const DATE_NAME = /^(date|day|week|week[\s_-]*(start|starting|commencing|beginning|of)|period|wc|w\/c)$/i
const REVENUE_NAME = /(revenue|sales|turnover|income|gmv|kpi|orders|conversions|bookings|sign[\s_-]*ups|leads)/i
const SPEND_NAME = /(spend|cost|budget|invest|\bads?\b|media)/i
const CHANNEL_NAME = /(tv|search|social|facebook|meta|instagram|google|tiktok|youtube|display|video|radio|email|affiliate|print|ooh|outdoor|podcast|influencer|linkedin|pinterest|snap|bing|ppc|sem|programmatic)/i

function looksLikeDate(v: string): boolean {
  const s = v.trim()
  return /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(s) || /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(s) || /^\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}$/.test(s) || /^[A-Za-z]{3,}\s+\d{1,2},?\s+\d{4}$/.test(s)
}

/** First guess at what each column is, from its name and its values. The user can change every one. */
export function guessColumns(sheet: Sheet): Column[] {
  const cols: Column[] = sheet.header.map((header, index) => {
    const values = sheet.rows.map((r) => (r[index] ?? '').trim()).filter((v) => v !== '')
    const numeric = values.filter((v) => parseNumber(v) !== null).length
    return { index, header, sample: values.slice(0, 3), numericShare: values.length ? numeric / values.length : 0, role: 'ignore' as Role, name: slug(header) }
  })
  const lower = (c: Column) => c.header.trim().toLowerCase()

  const date =
    cols.find((c) => DATE_NAME.test(c.header.trim()) && c.sample.some(looksLikeDate)) ?? cols.find((c) => c.sample.length > 0 && c.sample.every(looksLikeDate))
  if (date) date.role = 'date'

  for (const c of cols) {
    if (c === date || c.numericShare < 0.9) continue
    const h = lower(c)
    if (h.startsWith('spend_')) {
      c.role = 'spend'
      c.name = h.slice(6)
    } else if (h.startsWith('control_')) {
      c.role = 'control'
      c.name = h.slice(8)
    } else if (SPEND_NAME.test(h) || CHANNEL_NAME.test(h)) c.role = 'spend'
  }
  const revenue = cols.find((c) => c.role === 'ignore' && c !== date && c.numericShare >= 0.9 && (lower(c) === 'revenue' || REVENUE_NAME.test(lower(c))))
  if (revenue) revenue.role = 'revenue'
  // whatever numeric columns remain are most likely other drivers of sales
  for (const c of cols) if (c.role === 'ignore' && c !== date && c.numericShare >= 0.9 && revenue) c.role = 'control'
  return cols
}

export function detectDateFormat(values: string[]): { format: DateFormat; ambiguous: boolean } {
  const v = values.map((s) => s.trim()).filter(Boolean)
  if (v.every((s) => /^\d{4}-\d{1,2}-\d{1,2}/.test(s))) return { format: 'iso', ambiguous: false }
  if (v.every((s) => /^\d{4}\/\d{1,2}\/\d{1,2}/.test(s))) return { format: 'ymd_slash', ambiguous: false }
  if (v.every((s) => /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(s))) {
    const parts = v.map((s) => s.split(/[-/.]/).map(Number))
    if (parts.some((p) => p[0] > 12)) return { format: 'dmy', ambiguous: false }
    if (parts.some((p) => p[1] > 12)) return { format: 'mdy', ambiguous: false }
    return { format: 'dmy', ambiguous: true }
  }
  return { format: 'text', ambiguous: false }
}

const pad = (n: number) => String(n).padStart(2, '0')
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** Convert one date to YYYY-MM-DD, or return it unchanged so the validator reports the row. */
export function toIsoDate(raw: string, format: DateFormat): string {
  const s = raw.trim()
  let y: number
  let m: number
  let d: number
  if (format === 'iso' || format === 'ymd_slash') {
    const p = s.split(/[-/T\s]/)
    ;[y, m, d] = [Number(p[0]), Number(p[1]), Number(p[2])]
  } else if (format === 'dmy' || format === 'mdy') {
    const p = s.split(/[-/.]/).map(Number)
    if (p.length !== 3) return raw
    ;[d, m, y] = format === 'dmy' ? p : [p[1], p[0], p[2]]
    if (y < 100) y += 2000
  } else {
    const a = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\.?,?\s+(\d{4})$/)
    const b = s.match(/^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/)
    if (a) [d, m, y] = [Number(a[1]), MONTHS.indexOf(a[2].toLowerCase()) + 1, Number(a[3])]
    else if (b) [d, m, y] = [Number(b[2]), MONTHS.indexOf(b[1].toLowerCase()) + 1, Number(b[3])]
    else return raw
  }
  if (!(y > 0 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return raw
  return `${y}-${pad(m)}-${pad(d)}`
}

export interface MappingProblem {
  message: string
}

export function checkMapping(cols: Column[]): MappingProblem[] {
  const out: MappingProblem[] = []
  const count = (r: Role) => cols.filter((c) => c.role === r).length
  if (count('date') !== 1) out.push({ message: count('date') ? 'Pick only one date column.' : 'Pick the column that holds the date.' })
  if (count('revenue') !== 1) out.push({ message: count('revenue') ? 'Pick only one revenue column.' : 'Pick the column that holds revenue (or whatever you want to explain).' })
  if (count('spend') < 1) out.push({ message: 'Pick at least one advertising spend column.' })
  if (count('spend') > 15) out.push({ message: 'At most 15 spend columns can be used.' })
  for (const role of ['spend', 'control'] as const) {
    const names = cols.filter((c) => c.role === role).map((c) => slug(c.name))
    const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))]
    if (dupes.length) out.push({ message: `Two ${role === 'spend' ? 'spend' : 'outside factor'} columns share the name “${dupes[0]}”. Rename one.` })
  }
  return out
}

const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

/** Build the CSV the model reads from the user's sheet and their column choices. */
export function applyMapping(sheet: Sheet, cols: Column[], format: DateFormat): string {
  const used = cols.filter((c) => c.role !== 'ignore')
  const order = [...used.filter((c) => c.role === 'date'), ...used.filter((c) => c.role === 'revenue'), ...used.filter((c) => c.role === 'spend'), ...used.filter((c) => c.role === 'control')]
  const head = order.map((c) => (c.role === 'date' ? 'date' : c.role === 'revenue' ? 'revenue' : `${c.role}_${slug(c.name)}`))
  const body = sheet.rows.map((r) => order.map((c) => esc(c.role === 'date' ? toIsoDate(r[c.index] ?? '', format) : (r[c.index] ?? '').trim())).join(','))
  return [head.join(','), ...body].join('\n') + '\n'
}
