/**
 * Browser-side CSV checks for instant feedback. Mirror of worker/kawkit_worker/validate.py;
 * the two share test fixtures. The server checks the file again and its verdict wins.
 */
import type { ChannelSummary, DataError, DataSummary, DataWarning } from '../api/types'
import { parseCsv } from './csv'

export const MAX_BYTES = 10 * 1024 * 1024
export const MAX_ROWS = 5000
export const MAX_CHANNELS = 15
export const MAX_COLUMNS = 60
export const MIN_WEEKS = 52
export const RECOMMENDED_WEEKS = 104
const MAX_ROWS_LISTED = 10

export interface Dataset {
  dates: string[]
  y: number[]
  spend: number[][] // [week][channel]
  controls: number[][]
  channels: string[]
  controlNames: string[]
}

export interface Validation {
  errors: DataError[]
  warnings: DataWarning[]
  summary: DataSummary | null
  dataset: Dataset | null
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const NUMBER_RE = /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/
const STRIP_RE = /[\s,$€£₹¥]/g

function rowsText(rows: number[]): string {
  const shown = rows.slice(0, MAX_ROWS_LISTED).join(', ')
  const more = rows.length - MAX_ROWS_LISTED
  return `${rows.length === 1 ? 'row' : 'rows'} ${shown}${more > 0 ? ` and ${more} more` : ''}`
}

export function parseNumber(raw: string): number | null {
  const s = raw.replace(STRIP_RE, '')
  if (!s || !NUMBER_RE.test(s)) return null
  const v = Number(s)
  return Number.isFinite(v) ? v : null
}

/** Days since 1970-01-01 for a strict YYYY-MM-DD date, or null. */
export function parseDate(raw: string): number | null {
  const s = raw.trim()
  if (!DATE_RE.test(s)) return null
  const y = Number(s.slice(0, 4))
  const m = Number(s.slice(5, 7))
  const d = Number(s.slice(8, 10))
  const t = Date.UTC(y, m - 1, d)
  const back = new Date(t)
  if (y < 1 || back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null
  return Math.round(t / 86400000)
}

export function dayToIso(day: number): string {
  return new Date(day * 86400000).toISOString().slice(0, 10)
}

const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length
function variance(x: number[]): number {
  const m = mean(x)
  return x.reduce((a, b) => a + (b - m) ** 2, 0) / x.length
}

/** Least squares via normal equations (Gaussian elimination); small, well-conditioned designs only. */
function lstsqResidualVariance(cols: number[][], y: number[]): number {
  const p = cols.length
  const n = y.length
  const a: number[][] = Array.from({ length: p }, () => new Array<number>(p + 1).fill(0))
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      let s = 0
      for (let k = 0; k < n; k++) s += cols[i][k] * cols[j][k]
      a[i][j] = s
    }
    let s = 0
    for (let k = 0; k < n; k++) s += cols[i][k] * y[k]
    a[i][p] = s
  }
  for (let i = 0; i < p; i++) {
    let pivot = i
    for (let r = i + 1; r < p; r++) if (Math.abs(a[r][i]) > Math.abs(a[pivot][i])) pivot = r
    ;[a[i], a[pivot]] = [a[pivot], a[i]]
    if (Math.abs(a[i][i]) < 1e-12) continue
    for (let r = 0; r < p; r++) {
      if (r === i) continue
      const f = a[r][i] / a[i][i]
      for (let c = i; c <= p; c++) a[r][c] -= f * a[i][c]
    }
  }
  const coef = a.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[p] / row[i]))
  const resid = y.map((v, k) => v - coef.reduce((s, b, i) => s + b * cols[i][k], 0))
  return variance(resid)
}

/** Share of a series' variance explained by a linear trend plus 2 yearly Fourier pairs. */
export function seasonalShare(x: number[], period = 52): number {
  const n = x.length
  const v = variance(x)
  if (n < 8 || v === 0) return 0
  const t = x.map((_, i) => i)
  const cols = [t.map(() => 1), t.map((i) => i / Math.max(n - 1, 1))]
  for (const k of [1, 2]) {
    cols.push(t.map((i) => Math.sin((2 * Math.PI * k * i) / period)))
    cols.push(t.map((i) => Math.cos((2 * Math.PI * k * i) / period)))
  }
  return Math.max(0, 1 - lstsqResidualVariance(cols, x) / v)
}

export function validateCsv(text: string, byteLength?: number): Validation {
  const v: Validation = { errors: [], warnings: [], summary: null, dataset: null }
  const err = (code: string, message: string, rows: number[] = []) =>
    v.errors.push({ code, message, rows: rows.slice(0, 50) })
  const warn = (code: string, message: string, column: string | null = null) =>
    v.warnings.push({ code, message, column })

  if ((byteLength ?? text.length) > MAX_BYTES) {
    err('file_too_large', 'The file is larger than 10 MB.')
    return v
  }
  const table = parseCsv(text)
  const numbered = table
    .map((r, i) => ({ line: i + 1, r }))
    .filter(({ r }) => r.some((c) => c.trim() !== ''))
  if (numbered.length === 0) {
    err('empty', 'The file is empty.')
    return v
  }
  const header = numbered[0].r.map((h) => h.trim().toLowerCase())
  const body = numbered.slice(1)
  if (header.length > MAX_COLUMNS) {
    err('too_many_columns', `The file has ${header.length} columns; at most ${MAX_COLUMNS} are allowed.`)
    return v
  }
  if (body.length > MAX_ROWS) {
    err('too_many_rows', `The file has ${body.length} rows; at most ${MAX_ROWS} are allowed.`)
    return v
  }

  const dupes = [...new Set(header.filter((h) => h && header.indexOf(h) !== header.lastIndexOf(h)))].sort()
  if (dupes.length) err('duplicate_column', `Column name repeats: ${dupes.join(', ')}.`)
  if (!header.includes('date')) err('missing_column', "Required column 'date' is missing.")
  if (!header.includes('revenue')) err('missing_column', "Required column 'revenue' is missing.")
  const spendCols = header.filter((h) => h.startsWith('spend_') && h.length > 6)
  const controlCols = header.filter((h) => h.startsWith('control_') && h.length > 8)
  if (!spendCols.length) err('missing_column', "At least one 'spend_<channel>' column is needed.")
  if (spendCols.length > MAX_CHANNELS)
    err('too_many_channels', `The file has ${spendCols.length} spend columns; at most ${MAX_CHANNELS} are allowed.`)
  if (v.errors.length) return v

  const used = ['date', 'revenue', ...spendCols, ...controlCols]
  const ignored = header.filter((h) => !used.includes(h))
  if (ignored.length)
    warn(
      'ignored_columns',
      `Ignored columns (no spend_ or control_ prefix): ${ignored.slice(0, 8).map((h) => h || '(blank)').join(', ')}.`,
    )
  const idx = new Map(used.map((h) => [h, header.indexOf(h)]))
  const numericCols = ['revenue', ...spendCols, ...controlCols]

  const badDates: number[] = []
  const dupDates: number[] = []
  const badValues = new Map<string, number[]>()
  const negative = new Map<string, number[]>()
  const seen = new Set<number>()
  const records: { day: number; values: number[]; line: number }[] = []
  for (const { line, r } of body) {
    const cell = (c: string) => r[idx.get(c)!] ?? ''
    const day = parseDate(cell('date'))
    if (day === null) badDates.push(line)
    else if (seen.has(day)) dupDates.push(line)
    else seen.add(day)
    const values: number[] = []
    let ok = true
    for (const c of numericCols) {
      const num = parseNumber(cell(c))
      if (num === null) {
        badValues.set(c, [...(badValues.get(c) ?? []), line])
        ok = false
        continue
      }
      if (num < 0 && c.startsWith('spend_')) {
        negative.set(c, [...(negative.get(c) ?? []), line])
        ok = false
      }
      values.push(num)
    }
    if (day !== null && ok) records.push({ day, values, line })
  }
  if (badDates.length) err('bad_date', `Date is not YYYY-MM-DD in ${rowsText(badDates)}.`, badDates)
  if (dupDates.length) err('duplicate_date', `Date appears twice in ${rowsText(dupDates)}.`, dupDates)
  for (const [c, rows] of badValues)
    err('bad_value', `Column '${c}' has a missing or non-numeric value in ${rowsText(rows)}.`, rows)
  for (const [c, rows] of negative) err('negative_spend', `Column '${c}' has negative spend in ${rowsText(rows)}.`, rows)
  if (v.errors.length) return v

  records.sort((a, b) => a.day - b.day)
  let days = records.map((r) => r.day)
  const lines = records.map((r) => r.line)
  let data = records.map((r) => r.values)

  let cadence: 'weekly' | 'daily' = 'weekly'
  let gaps = 0
  if (days.length >= 2) {
    const diffs = days.slice(1).map((d, i) => d - days[i])
    const ordered = [...diffs].sort((a, b) => a - b)
    const median = ordered[Math.floor((ordered.length - 1) / 2)]
    if (median === 1) {
      cadence = 'daily'
      gaps = diffs.filter((d) => d > 1).length
    } else if (median === 7) {
      const off = diffs.map((d, i) => (d % 7 !== 0 ? lines[i + 1] : -1)).filter((l) => l >= 0)
      if (off.length) {
        err('bad_spacing', `Rows must be 7 days apart (or 1 day apart for daily data); see ${rowsText(off)}.`, off)
        return v
      }
      gaps = diffs.filter((d) => d > 7).length
    } else {
      err('bad_spacing', 'Rows are neither 7 days nor 1 day apart. Use one row per week or per day.')
      return v
    }
  }

  const inputRows = days.length
  if (cadence === 'daily') {
    // sum to weeks starting Monday; keep only complete weeks. 1970-01-01 was a Thursday.
    const weeks = new Map<number, { n: number; sum: number[] }>()
    days.forEach((d, i) => {
      const weekday = (((d + 3) % 7) + 7) % 7 // Monday = 0
      const monday = d - weekday
      const slot = weeks.get(monday) ?? { n: 0, sum: new Array<number>(numericCols.length).fill(0) }
      slot.n++
      data[i].forEach((val, j) => (slot.sum[j] += val))
      weeks.set(monday, slot)
    })
    const full = [...weeks.keys()].filter((k) => weeks.get(k)!.n === 7).sort((a, b) => a - b)
    const partial = weeks.size - full.length
    if (partial) warn('partial_weeks', `${partial} incomplete week(s) were left out after summing daily rows to weeks.`)
    days = full
    data = full.map((k) => weeks.get(k)!.sum)
    gaps = days.slice(1).filter((d, i) => d - days[i] > 7).length
  }

  const n = days.length
  if (n < MIN_WEEKS) {
    err('too_few_rows', `The file has ${n} weekly rows; at least ${MIN_WEEKS} are needed (104 or more recommended).`)
    return v
  }
  if (gaps) warn('date_gaps', `Dates have ${gaps} gap(s). The model treats the rows as consecutive weeks.`)
  if (n < RECOMMENDED_WEEKS)
    warn('short_history', `${n} weeks of data; 104 or more give steadier estimates, especially for seasonality.`)

  const y = data.map((r) => r[0])
  if (Math.max(...y) <= 0) {
    err('bad_value', "Column 'revenue' is zero or negative throughout.")
    return v
  }

  const channels: ChannelSummary[] = []
  const keepSpend: number[] = []
  spendCols.forEach((col, j) => {
    const x = data.map((r) => r[1 + j])
    const name = col.slice(6)
    const total = x.reduce((a, b) => a + b, 0)
    if (total === 0) {
      warn('channel_all_zero', `Channel '${name}' is zero throughout and was dropped.`, col)
      return
    }
    const active = x.filter((val) => val > 0).length / n
    const m = total / n
    const cv = m > 0 ? Math.sqrt(variance(x)) / m : 0
    const seasonal = seasonalShare(x)
    if (active < 0.15)
      warn('channel_sparse', `Channel '${name}' is active in only ${(active * 100).toFixed(0)}% of weeks; its estimate will be wide.`, col)
    else if (cv < 0.15)
      warn('channel_flat', `Channel '${name}' spend barely changes, so its effect cannot be measured from this data.`, col)
    if (seasonal > 0.6)
      warn(
        'channel_seasonal',
        `Channel '${name}' spend mostly follows the season or trend (${(seasonal * 100).toFixed(0)}% of its movement), so it is hard to separate from seasonality.`,
        col,
      )
    keepSpend.push(j)
    channels.push({ name, column: col, total, mean: m, max: Math.max(...x), active_share: active, cv, seasonal_share: seasonal })
  })
  if (!keepSpend.length) {
    err('no_spend', 'Every spend column is zero throughout.')
    return v
  }

  const keepControls: number[] = []
  const controlNames: string[] = []
  controlCols.forEach((col, j) => {
    const z = data.map((r) => r[1 + spendCols.length + j])
    if (Math.max(...z) === Math.min(...z)) {
      warn('control_constant', `Control '${col.slice(8)}' never changes and was dropped.`, col)
      return
    }
    keepControls.push(j)
    controlNames.push(col.slice(8))
  })

  if (n < 10 * (keepSpend.length + keepControls.length))
    warn('many_channels', `${keepSpend.length} channels and ${keepControls.length} controls is a lot for ${n} weeks; expect wide intervals.`)

  const dates = days.map(dayToIso)
  v.dataset = {
    dates,
    y,
    spend: data.map((r) => keepSpend.map((j) => r[1 + j])),
    controls: data.map((r) => keepControls.map((j) => r[1 + spendCols.length + j])),
    channels: channels.map((c) => c.name),
    controlNames,
  }
  v.summary = {
    input_rows: inputRows,
    weeks: n,
    cadence,
    start: dates[0],
    end: dates[n - 1],
    revenue_total: y.reduce((a, b) => a + b, 0),
    channels,
    controls: controlNames,
    ignored,
    warnings: v.warnings,
  }
  return v
}
