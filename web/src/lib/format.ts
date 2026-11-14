export function fmtNum(v: number, digits = 0): string {
  if (!Number.isFinite(v)) return '–'
  return v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

/** Compact number for axes and tiles: 1,234 -> 1.2k, 1,234,567 -> 1.23M. */
export function fmtCompact(v: number): string {
  if (!Number.isFinite(v)) return '–'
  const a = Math.abs(v)
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`
  if (a >= 1e4) return `${(v / 1e3).toFixed(0)}k`
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}k`
  if (a >= 100 || a === 0) return v.toFixed(0)
  return v.toFixed(a >= 10 ? 1 : 2)
}

export const fmtPct = (v: number, digits = 0) => (Number.isFinite(v) ? `${(v * 100).toFixed(digits)}%` : '–')
export const fmtRoi = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '–')
export const fmtRange = (low: number, high: number, f: (v: number) => string = fmtRoi) => `${f(low)} to ${f(high)}`

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '–'
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function fmtDuration(seconds: number): string {
  if (seconds < 60) return 'under a minute'
  const m = Math.round(seconds / 60)
  return m === 1 ? 'about 1 minute' : `about ${m} minutes`
}

export const title = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min]
  const raw = (max - min) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)))
  return out
}

export function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]): void {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const text = [header, ...rows].map((r) => r.map(esc).join(',')).join('\n') + '\n'
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export const palette = (i: number) => `var(--c${i % 8})`
