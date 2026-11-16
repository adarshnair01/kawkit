/**
 * Feature library: calendar events worked out from the dates in the data, added to the baseline
 * as extra columns so advertising is not credited with them. Mirrors event_flags in
 * worker/scripts/conjura_features.py (a shared fixture checks the two agree).
 */
import type { Dataset } from '../validation/validate'

export const EVENTS = {
  black_friday: { label: 'Black Friday week', note: 'The week containing the Friday after US Thanksgiving' },
  cyber_week: { label: 'Cyber week', note: 'The week after Black Friday, containing Cyber Monday' },
  pre_christmas: { label: 'Run-up to Christmas', note: 'Weeks starting 1 to 18 December' },
  christmas_newyear: { label: 'Christmas and New Year', note: 'Weeks containing 25 December or 1 January' },
  easter: { label: 'Easter week', note: 'The week containing Easter Sunday' },
} as const
export type EventKey = keyof typeof EVENTS

const DAY = 86400000
const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d)
const parse = (iso: string) => utc(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), Number(iso.slice(8, 10)))

/** Friday after the fourth Thursday of November. */
export function blackFriday(year: number): number {
  const first = new Date(utc(year, 11, 1)).getUTCDay() // 0 Sunday .. 4 Thursday
  const firstThursday = 1 + ((4 - first + 7) % 7)
  return utc(year, 11, firstThursday + 21 + 1)
}

/** Easter Sunday in the Gregorian calendar (anonymous Gregorian algorithm). */
export function easterSunday(year: number): number {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return utc(year, month, day)
}

/** 0 or 1 per week for each event; a week is the 7 days starting on its date. */
export function eventFlags(weekStarts: string[]): Record<EventKey, number[]> {
  const out = Object.fromEntries(Object.keys(EVENTS).map((k) => [k, [] as number[]])) as Record<EventKey, number[]>
  for (const iso of weekStarts) {
    const start = parse(iso)
    const end = start + 6 * DAY
    const inWeek = (t: number) => t >= start && t <= end
    const year = new Date(start).getUTCFullYear()
    const years = [year - 1, year, year + 1]
    const bf = years.some((y) => inWeek(blackFriday(y)))
    const cyber = !bf && years.some((y) => inWeek(blackFriday(y) + 3 * DAY))
    const s = new Date(start)
    const pre = !bf && !cyber && s.getUTCMonth() === 11 && s.getUTCDate() <= 18
    const xmas = years.some((y) => inWeek(utc(y, 12, 25)) || inWeek(utc(y, 1, 1)))
    const easter = years.some((y) => inWeek(easterSunday(y)))
    out.black_friday.push(bf ? 1 : 0)
    out.cyber_week.push(cyber ? 1 : 0)
    out.pre_christmas.push(pre ? 1 : 0)
    out.christmas_newyear.push(xmas ? 1 : 0)
    out.easter.push(easter ? 1 : 0)
  }
  return out
}

/** Rebuild the weekly CSV from a checked dataset, with the chosen events as control columns. */
export function withEvents(ds: Dataset, chosen: EventKey[]): { csv: string; added: EventKey[]; skipped: EventKey[] } {
  const flags = eventFlags(ds.dates)
  const existing = new Set(ds.controlNames)
  const usable = chosen.filter((k) => !existing.has(k))
  // an event that never happens in the data, or happens every week, cannot be measured
  const added = usable.filter((k) => flags[k].some((v) => v === 1) && flags[k].some((v) => v === 0))
  const skipped = usable.filter((k) => !added.includes(k))
  const head = ['date', 'revenue', ...ds.channels.map((c) => `spend_${c}`), ...ds.controlNames.map((c) => `control_${c}`), ...added.map((k) => `control_${k}`)]
  const rows = ds.dates.map((d, i) => [d, ds.y[i], ...ds.spend[i], ...ds.controls[i], ...added.map((k) => flags[k][i])].join(','))
  return { csv: [head.join(','), ...rows].join('\n') + '\n', added, skipped }
}
