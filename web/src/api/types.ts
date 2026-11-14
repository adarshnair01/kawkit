export type RunStatus = 'queued' | 'running' | 'finished' | 'failed' | 'cancelled'

export interface Interval {
  median: number
  low: number
  high: number
}

export interface ChannelPrior {
  roi_low?: number
  roi_high?: number
  carryover_weeks?: number
  note?: string
}
export type Priors = Record<string, ChannelPrior>

export interface DataWarning {
  code: string
  message: string
  column?: string | null
}
export interface DataError {
  code: string
  message: string
  rows: number[]
}
export interface ChannelSummary {
  name: string
  column: string
  total: number
  mean: number
  max: number
  active_share: number
  cv: number
  seasonal_share: number
}
export interface DataSummary {
  input_rows: number
  weeks: number
  cadence: 'weekly' | 'daily'
  start: string
  end: string
  revenue_total: number
  channels: ChannelSummary[]
  controls: string[]
  ignored: string[]
  warnings: DataWarning[]
}

export interface Run {
  id: string
  user_id: string
  name: string
  status: RunStatus
  progress: number
  upload_path: string
  data_summary: DataSummary
  priors: Priors
  settings: Record<string, unknown>
  seed: number
  attempts: number
  cancel_requested: boolean
  error: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export interface Diagnostics {
  max_rhat: number
  worst_parameter: string
  min_ess_bulk: number
  divergences: number
  divergence_pct: number
  verdict: 'pass' | 'caution' | 'fail'
  chains: number
  draws: number
  tune: number
  retried: boolean
  seconds: number
  prior_check?: { media_share_low: number; media_share_mid: number; media_share_high: number }
}

export interface Fit {
  r2: number
  mape: number
  holdout_mape: number | null
  holdout_weeks: number
  coverage90: number
  dates: string[]
  actual: number[]
  fitted: number[]
  band_low: number[]
  band_high: number[]
  baseline: number[]
  media_share: Interval
  weeks: number
  channels: string[]
  controls: string[]
  seasonality: boolean
  drivers?: { name: string; effect: Interval; p_positive: number; share: Interval; binary: boolean; active_weeks: number; low_value: number; high_value: number }[]
  holdout?: { dates: string[]; actual: number[]; predicted: number[]; low: number[]; high: number[]; inside: number; total_error_pct: number } | null
}

export interface ChannelResult {
  name: string
  total_spend: number
  current_weekly: number
  max_weekly: number
  contribution: Interval & { share: Interval }
  contribution_series: { median: number[]; low: number[]; high: number[] }
  roi: Interval & { p_above_1: number; confidence: 'high' | 'medium' | 'low' }
  mroi: Interval
  half_life_weeks: Interval
  saturation_spend: Interval
  prior: {
    source: 'yours' | 'default'
    roi: Interval
    carryover_weeks?: number | null
    note?: string | null
    shrink: number
    verdict: string
    conflict: boolean
    grid: number[]
    prior_density: number[]
    posterior_density: number[]
  }
}

export interface Curve {
  name: string
  spend: number[]
  median: number[]
  low: number[]
  high: number[]
  current: number
  max_weekly: number
}

export interface Plan {
  budget: number
  requested_budget: number
  channels: string[]
  current: number[]
  recommended: number[]
  lower: number[]
  upper: number[]
  extrapolated: boolean[]
  expected_current: number
  expected_recommended: number
  lift: { mean: number; median: number; low: number; high: number }
  lift_pct: { mean: number; low: number; high: number }
  prob_better: number
  notes: string[]
}

export interface RunResult {
  run_id: string
  diagnostics: Diagnostics
  fit: Fit
  channels: ChannelResult[]
  curves: Curve[]
  default_plan: Plan | null
  draws_path: string
}

export interface Draws {
  channels: string[]
  ymax: number
  xmax: number[]
  max_weekly: number[]
  current: number[]
  beta: number[][]
  lam: number[][]
  alpha: number[][]
}

export interface Heartbeat {
  worker_id: string
  last_seen: string
  version: string
  running_runs: number
  max_concurrency: number
}
