/**
 * Economy connector: monthly indicators for a country, fetched server-side from FRED and lined up
 * with the weeks in the data. Each week gets the previous month's figure, because that is the
 * latest one that would have been published at the time.
 */
import { supabase } from '../api/supabase'
import type { Dataset } from '../validation/validate'

export const COUNTRIES = { US: 'United States', UK: 'United Kingdom' } as const
export type Country = keyof typeof COUNTRIES

export const INDICATORS = {
  unemployment: { label: 'Unemployment rate', note: 'Share of the workforce out of work' },
  inflation: { label: 'Inflation', note: 'Consumer prices against a year earlier' },
  consumer_confidence: { label: 'Consumer confidence', note: 'How households feel about their finances and the economy' },
  interest_rate: { label: 'Interest rate', note: 'Short-term benchmark rate' },
  retail_growth: { label: 'Retail sales growth', note: 'National retail sales against a year earlier' },
} as const
export type Indicator = keyof typeof INDICATORS

export interface Observation {
  date: string
  value: number
}
export interface EconomyResponse {
  country: string
  source: string
  notice: string
  series: Record<string, { label: string; series_id: string; observations: Observation[]; error?: string }>
}

const pad = (n: number) => String(n).padStart(2, '0')
/** The first day of the month `months` before the month of an ISO date. */
export function monthBefore(iso: string, months: number): string {
  const y = Number(iso.slice(0, 4))
  const m = Number(iso.slice(5, 7)) - 1 - months
  const d = new Date(Date.UTC(y, m, 1))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`
}

export type Aligned = { ok: true; values: number[] } | { ok: false; reason: string }

/**
 * One value per week: the figure for the month before the week's month. Refuses a series that
 * starts after the data does, stops more than 3 months before it ends, or never changes.
 */
export function alignMonthly(weeks: string[], observations: Observation[]): Aligned {
  if (!observations.length) return { ok: false, reason: 'no figures were returned' }
  const obs = [...observations].sort((a, b) => a.date.localeCompare(b.date))
  const first = obs[0].date.slice(0, 7)
  const last = obs[obs.length - 1].date.slice(0, 7)
  if (monthBefore(weeks[0], 1).slice(0, 7) < first) return { ok: false, reason: `its figures only start in ${first}` }
  if (last < monthBefore(weeks[weeks.length - 1], 4).slice(0, 7)) return { ok: false, reason: `its figures stop in ${last}, too long before your data ends` }
  const values = weeks.map((w) => {
    const cutoff = monthBefore(w, 1)
    let v = obs[0].value
    for (const o of obs) {
      if (o.date <= cutoff) v = o.value
      else break
    }
    return v
  })
  if (values.every((v) => v === values[0])) return { ok: false, reason: 'it does not change over your dates' }
  return { ok: true, values }
}

export async function fetchEconomy(country: Country, weeks: string[], indicators: Indicator[]): Promise<EconomyResponse> {
  const { data, error } = await supabase.functions.invoke('economy', {
    body: { country, start: monthBefore(weeks[0], 2), end: weeks[weeks.length - 1], indicators },
  })
  if (error) throw new Error('The economy figures could not be fetched. Try again in a moment.')
  return data as EconomyResponse
}

/** Rebuild the weekly CSV from a checked dataset with extra control columns appended. */
export function withControls(ds: Dataset, extra: Record<string, number[]>): string {
  const names = Object.keys(extra).filter((n) => !ds.controlNames.includes(n))
  const head = ['date', 'revenue', ...ds.channels.map((c) => `spend_${c}`), ...ds.controlNames.map((c) => `control_${c}`), ...names.map((n) => `control_${n}`)]
  const rows = ds.dates.map((d, i) => [d, ds.y[i], ...ds.spend[i], ...ds.controls[i], ...names.map((n) => extra[n][i])].join(','))
  return [head.join(','), ...rows].join('\n') + '\n'
}
