/**
 * Breakdown file, in the browser: long-format weekly spend by channel and dimensions. Mirror of
 * worker/kawkit_worker/breakdown.py (the server checks again and its verdict wins).
 * Columns: date, channel, spend, plus any other columns, which are offered as dimensions.
 */
import { parseCsv } from '../validation/csv'
import { dayToIso, parseDate, parseNumber, type Dataset } from '../validation/validate'

export const MAX_ROWS = 60000
export const MAX_LEVELS = 7
export const MIN_LEVEL_SHARE = 0.02
export const MAX_ITEMS = 12
export const RECONCILE_TOL = 0.02
export const OTHER = 'Other'
export const REMAINDER = 'Not broken down'
export const SPARSE_ACTIVE_SHARE = 0.2

export type Spec = Record<string, { dims: string[] }>

export interface LongFile {
  header: string[]
  rows: string[][] // body rows, aligned with header
  dimensions: string[] // candidate dimension columns, in file order
  channels: string[] // distinct channel names as slugs
}

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
const norm = (v: string) => v.trim().replace(/\s+/g, ' ')

export function readLong(text: string): LongFile | string {
  const table = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''))
  if (table.length === 0) return 'The breakdown file is empty.'
  if (table.length - 1 > MAX_ROWS) return `The breakdown file has ${table.length - 1} rows; at most ${MAX_ROWS} are allowed.`
  const header = table[0].map((h) => h.trim().toLowerCase())
  for (const need of ['date', 'channel', 'spend']) if (!header.includes(need)) return `The breakdown file needs a '${need}' column.`
  const rows = table.slice(1).map((r) => [...r, ...Array(Math.max(0, header.length - r.length)).fill('')])
  const ci = header.indexOf('channel')
  return {
    header,
    rows,
    dimensions: header.filter((h) => h && !['date', 'channel', 'spend'].includes(h)),
    channels: [...new Set(rows.map((r) => slug(r[ci])))].filter(Boolean),
  }
}

export interface Item {
  name: string
  levels: string[] // one per dimension
  spend: number[] // weekly, aligned with the dataset's weeks
}
export interface ChannelPlan {
  channel: string
  dims: string[]
  items: Item[]
  total: number // spend inside the items
  mainTotal: number // the main file's channel total
  folded: string[]
  /** how much of the main file's channel spend the items do not cover, and how much they exceed it */
  remainderShare: number
  overShare: number
  sparse: string[]
  /** per item: coefficient of variation of its share of the channel over time, 0 means a constant mix */
  shareCv: number[]
  /** the largest pairwise correlation between item shares over time */
  maxCorr: number
  separability: 'good' | 'weak' | 'none'
  error?: string
}
export interface Analysis {
  plans: ChannelPlan[]
  warnings: string[]
  errors: string[]
}

function corr(a: number[], b: number[]): number {
  const n = a.length
  const ma = a.reduce((s, v) => s + v, 0) / n
  const mb = b.reduce((s, v) => s + v, 0) / n
  let sab = 0
  let saa = 0
  let sbb = 0
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb)
    saa += (a[i] - ma) ** 2
    sbb += (b[i] - mb) ** 2
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 1
}

/** How well the data can tell a channel's items apart, judged from how their spend shares move over time. */
export function separability(shares: number[][]): { cv: number[]; maxCorr: number; level: 'good' | 'weak' | 'none' } {
  const cv = shares.map((s) => {
    const m = s.reduce((a, b) => a + b, 0) / s.length
    const sd = Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / s.length)
    return m > 0 ? sd / m : 0
  })
  let maxCorr = -1
  for (let i = 0; i < shares.length; i++) for (let j = i + 1; j < shares.length; j++) maxCorr = Math.max(maxCorr, corr(shares[i], shares[j]))
  const spread = Math.max(...cv)
  const level = spread < 0.1 ? 'none' : spread < 0.25 || maxCorr > 0.9 ? 'weak' : 'good'
  return { cv, maxCorr: shares.length > 1 ? maxCorr : 0, level }
}

export function analyse(ds: Dataset, file: LongFile, spec: Spec): Analysis {
  const out: Analysis = { plans: [], warnings: [], errors: [] }
  const T = ds.dates.length
  const weekDays = ds.dates.map((d) => parseDate(d) as number)
  const weekOf = new Map(weekDays.map((d, i) => [d, i]))
  const find = (day: number): number | null => {
    for (let k = 0; k < 7; k++) {
      const i = weekOf.get(day - k)
      if (i !== undefined) return i
    }
    return null
  }
  const col = Object.fromEntries(file.header.map((h, i) => [h, i]))
  const wanted = Object.entries(spec).filter(([, v]) => v.dims.length > 0)
  const spellings = new Map<string, string>()
  const raw = new Map<string, Map<string, number[]>>() // channel -> level key -> weekly spend
  for (const [ch] of wanted) raw.set(ch, new Map())
  let outside = 0
  const bad: Record<string, number[]> = { date: [], spend: [], negative: [] }
  file.rows.forEach((r, n) => {
    const ch = slug(r[col.channel])
    const entry = spec[ch]
    if (!entry || entry.dims.length === 0) return
    const line = n + 2
    const day = parseDate(r[col.date])
    if (day === null) return void bad.date.push(line)
    const amount = parseNumber(r[col.spend])
    if (amount === null) return void bad.spend.push(line)
    if (amount < 0) return void bad.negative.push(line)
    const wi = find(day)
    if (wi === null) return void (outside += 1)
    const levels = entry.dims.map((d) => {
      const v = norm(r[col[d]] ?? '') || '(blank)'
      const key = `${ch}\u0000${d}\u0000${v.toLowerCase()}`
      if (!spellings.has(key)) spellings.set(key, v)
      return spellings.get(key) as string
    })
    const k = levels.join('\u0001')
    const m = raw.get(ch) as Map<string, number[]>
    if (!m.has(k)) m.set(k, new Array<number>(T).fill(0))
    ;(m.get(k) as number[])[wi] += amount
  })
  const listed = (rows: number[]) => `row${rows.length > 1 ? 's' : ''} ${rows.slice(0, 8).join(', ')}${rows.length > 8 ? ` and ${rows.length - 8} more` : ''}`
  if (bad.date.length) out.errors.push(`Date is not YYYY-MM-DD in the breakdown file, ${listed(bad.date)}.`)
  if (bad.spend.length) out.errors.push(`Spend is missing or not a number in the breakdown file, ${listed(bad.spend)}.`)
  if (bad.negative.length) out.errors.push(`Spend is negative in the breakdown file, ${listed(bad.negative)}.`)
  if (outside) out.warnings.push(`${outside} breakdown rows fall outside the weeks in the main file and are ignored.`)

  for (const [ch, entry] of wanted) {
    const c = ds.channels.indexOf(ch)
    const plan: ChannelPlan = { channel: ch, dims: entry.dims, items: [], total: 0, mainTotal: 0, folded: [], remainderShare: 0, overShare: 0, sparse: [], shareCv: [], maxCorr: 0, separability: 'none' }
    out.plans.push(plan)
    if (c < 0) {
      plan.error = `Channel '${ch}' is not in the main file.`
      continue
    }
    const series = raw.get(ch) as Map<string, number[]>
    if (series.size === 0) {
      plan.error = `The breakdown file has no rows for channel '${ch}'.`
      continue
    }
    const mainSeries = ds.spend.map((r) => r[c])
    plan.mainTotal = mainSeries.reduce((a, b) => a + b, 0)
    // fold rare levels of each dimension into "Other"
    const levelSpend = entry.dims.map(() => new Map<string, number>())
    let grand = 0
    for (const [k, s] of series) {
      const sum = s.reduce((a, b) => a + b, 0)
      grand += sum
      k.split('\u0001').forEach((lv, d) => levelSpend[d].set(lv, (levelSpend[d].get(lv) ?? 0) + sum))
    }
    const keep = levelSpend.map((m, d) => {
      const ranked = [...m.entries()].sort((a, b) => b[1] - a[1])
      const kept = new Set(ranked.filter(([, v], i) => i < MAX_LEVELS && v / Math.max(grand, 1e-9) >= MIN_LEVEL_SHARE).map(([lv]) => lv))
      if (kept.size === 0) kept.add(ranked[0][0])
      if (ranked.length - kept.size > 0) plan.folded.push(`${ranked.length - kept.size} small ${entry.dims[d]} values into Other`)
      return kept
    })
    const folded = new Map<string, number[]>()
    for (const [k, s] of series) {
      const k2 = k.split('\u0001').map((lv, d) => (keep[d].has(lv) ? lv : OTHER)).join('\u0001')
      const cur = folded.get(k2) ?? new Array<number>(T).fill(0)
      folded.set(k2, cur.map((v, i) => v + s[i]))
    }
    if (folded.size > MAX_ITEMS) {
      plan.error = `This breaks ${ch} into ${folded.size} items; at most ${MAX_ITEMS} are allowed. Use fewer dimensions, or a coarser one.`
      continue
    }
    const inside = new Array<number>(T).fill(0)
    for (const s of folded.values()) s.forEach((v, i) => (inside[i] += v))
    const gap = mainSeries.map((m, i) => m - inside[i])
    const denom = Math.max(plan.mainTotal, 1e-9)
    plan.overShare = gap.reduce((a, g) => a + Math.max(-g, 0), 0) / denom
    const remainder = gap.map((g) => Math.max(g, 0))
    plan.remainderShare = remainder.reduce((a, b) => a + b, 0) / denom
    if (plan.overShare > RECONCILE_TOL) {
      plan.error = `The breakdown adds up to ${(plan.overShare * 100).toFixed(1)}% more than ${ch}'s total in the main file (in ${gap.filter((g) => g < -1e-6).length} weeks). Check both files use the same spend and the same weeks.`
      continue
    }
    if (plan.remainderShare > RECONCILE_TOL) folded.set(entry.dims.map(() => REMAINDER).join('\u0001'), remainder)
    const order = [...folded.entries()].sort((a, b) => b[1].reduce((x, y) => x + y, 0) - a[1].reduce((x, y) => x + y, 0))
    plan.items = order.map(([k, s]) => ({ name: k.split('\u0001').join(' / '), levels: k.split('\u0001'), spend: s }))
    plan.total = order.reduce((a, [, s]) => a + s.reduce((x, y) => x + y, 0), 0)
    plan.sparse = plan.items.filter((it) => it.spend.filter((v) => v > 0).length / T < SPARSE_ACTIVE_SHARE).map((it) => it.name)
    const totals = new Array<number>(T).fill(0)
    plan.items.forEach((it) => it.spend.forEach((v, i) => (totals[i] += v)))
    const shares = plan.items.map((it) => it.spend.map((v, i) => v / Math.max(totals[i], 1e-9)))
    const sep = separability(shares)
    plan.shareCv = sep.cv
    plan.maxCorr = sep.maxCorr
    plan.separability = plan.items.length < 2 ? 'none' : sep.level
    if (plan.items.length < 2) plan.error = `This leaves ${ch} with one item, so there is nothing to compare. Pick a different dimension.`
  }
  return out
}

/** The long file as a CSV string with only the columns the chosen breakdown uses, to keep uploads small. */
export function trimmedCsv(file: LongFile, spec: Spec): string {
  const used = new Set(['date', 'channel', 'spend', ...Object.values(spec).flatMap((v) => v.dims.map((d) => d.toLowerCase()))])
  const idx = file.header.map((h, i) => (used.has(h) ? i : -1)).filter((i) => i >= 0)
  const q = (c: string) => (/[",\n\r]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)
  const ci = file.header.indexOf('channel')
  const rows = file.rows.filter((r) => spec[slug(r[ci])]?.dims.length)
  return [idx.map((i) => file.header[i]), ...rows.map((r) => idx.map((i) => r[i]))].map((r) => r.map(q).join(',')).join('\n') + '\n'
}

export { dayToIso }
