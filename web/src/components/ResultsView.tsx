import { useEffect, useState, type ReactNode } from 'react'
import type { ChannelResult, Draws, Priors, RunResult } from '../api/types'
import { ChartFrame, DataTable } from '../charts/ChartFrame'
import { DensityChart } from '../charts/DensityChart'
import { IntervalBars } from '../charts/IntervalBars'
import { LineChart } from '../charts/LineChart'
import { testCandidates } from '../lib/testNext'
import { downloadXlsx } from '../lib/xlsx'
import { downloadCsv, fmtCompact, fmtNum, fmtPct, fmtRange, fmtRoi, palette, title } from '../lib/format'
import { exportPlan, Optimise } from './Optimise'
import { Summary } from './Summary'
import { CurveExplorer } from './CurveExplorer'
import { Term } from './Term'
import { useToast } from './Toast'
import { Tabs } from './Tabs'

const VERDICT = {
  pass: { cls: 'notice-ok', badge: 'badge-ok', label: 'Converged', text: 'The sampler converged. These results can be trusted as a fair reading of the model.' },
  caution: { cls: 'notice-warn', badge: 'badge-warn', label: 'Caution', text: 'The sampler mostly converged. Treat narrow differences between channels with care.' },
  fail: { cls: 'notice-bad', badge: 'badge-bad', label: 'Did not converge', text: 'The sampler did not converge, so the numbers below may be wrong.' },
} as const

export function VerdictBadge({ verdict }: { verdict: string | undefined }) {
  if (!verdict || !(verdict in VERDICT)) return null
  const v = VERDICT[verdict as keyof typeof VERDICT]
  return <span className={`badge ${v.badge}`}>{verdict === 'pass' ? '✓' : verdict === 'caution' ? '!' : '✕'} {v.label}</span>
}

function Tile({ label, value, sub }: { label: ReactNode; value: string; sub?: string }) {
  return (
    <div className="card" style={{ padding: '0.8rem 1rem' }}>
      <div className="text-sm muted">{label}</div>
      <div className="text-2xl font-bold num">{value}</div>
      {sub && <div className="text-xs muted num">{sub}</div>}
    </div>
  )
}

const CONF = { high: 'badge-ok', medium: 'badge-warn', low: 'badge-bad' } as const

function exportResults(result: RunResult, name: string) {
  const slug = name.replace(/\W+/g, '-').toLowerCase()
  downloadCsv(
    `kawkit-results-${slug}.csv`,
    ['channel', 'total_spend', 'contribution_median', 'contribution_low', 'contribution_high', 'share_of_revenue_median', 'roi_median', 'roi_low', 'roi_high', 'prob_roi_above_1', 'confidence', 'marginal_roi_median', 'marginal_roi_low', 'marginal_roi_high', 'half_life_weeks_median', 'half_life_weeks_low', 'half_life_weeks_high', 'saturation_spend_median', 'prior_source', 'prior_roi_low', 'prior_roi_high', 'data_vs_prior'],
    result.channels.map((c) => [c.name, c.total_spend, c.contribution.median, c.contribution.low, c.contribution.high, c.contribution.share.median, c.roi.median, c.roi.low, c.roi.high, c.roi.p_above_1, c.roi.confidence, c.mroi.median, c.mroi.low, c.mroi.high, c.half_life_weeks.median, c.half_life_weeks.low, c.half_life_weeks.high, c.saturation_spend.median, c.prior.source, c.prior.roi.low, c.prior.roi.high, c.prior.verdict]),
  )
}

function exportWorkbook(result: RunResult, name: string) {
  const f = result.fit
  const d = result.diagnostics
  const plan = result.default_plan
  downloadXlsx(`kawkit-${name.replace(/\W+/g, '-').toLowerCase()}.xlsx`, [
    {
      name: 'Summary',
      rows: [
        ['Kawkit results', name],
        [],
        ['Convergence', d.verdict], ['Worst R-hat', d.max_rhat], ['Smallest effective sample', d.min_ess_bulk], ['Divergent draws', d.divergences],
        ['R squared', f.r2], ['Error in sample, MAPE %', f.mape], ['Error on unseen weeks, MAPE %', f.holdout_mape],
        ['Revenue driven by media, median', f.media_share.median], ['low', f.media_share.low], ['high', f.media_share.high],
        ['Weeks', f.weeks],
        [],
        ['Ranges are 90% credible intervals. ROI = revenue back per unit of spend.'],
      ],
    },
    {
      name: 'Channels',
      rows: [
        ['Channel', 'Total spend', 'ROI median', 'ROI low', 'ROI high', 'Chance ROI above 1', 'Confidence', 'Marginal ROI median', 'Contribution median', 'Contribution low', 'Contribution high', 'Share of revenue', 'Carry-over half-life (weeks)', 'Prior source', 'Data vs prior'],
        ...result.channels.map((c) => [c.name, c.total_spend, c.roi.median, c.roi.low, c.roi.high, c.roi.p_above_1, c.roi.confidence, c.mroi.median, c.contribution.median, c.contribution.low, c.contribution.high, c.contribution.share.median, c.half_life_weeks.median, c.prior.source, c.prior.verdict]),
      ],
    },
    {
      name: 'Weekly fit',
      rows: [
        ['Date', 'Actual', 'Modelled', 'Band low', 'Band high', 'Baseline', ...result.channels.map((c) => `${c.name} contribution`)],
        ...f.dates.map((dt, i) => [dt, f.actual[i], f.fitted[i], f.band_low[i], f.band_high[i], f.baseline[i], ...result.channels.map((c) => c.contribution_series.median[i])]),
      ],
    },
    ...(plan
      ? [{
          name: 'Recommended split',
          rows: [
            ['Channel', 'Current weekly spend', 'Recommended weekly spend', 'Change %', 'Min', 'Max', 'Beyond observed spend'],
            ...plan.channels.map((c, i) => [c, plan.current[i], plan.recommended[i], plan.current[i] > 0 ? ((plan.recommended[i] - plan.current[i]) / plan.current[i]) * 100 : null, plan.lower[i], plan.upper[i], plan.extrapolated[i] ? 'yes' : 'no']),
            [],
            ['Weekly budget', plan.budget], ['Expected weekly revenue change', plan.lift.mean], ['90% low', plan.lift.low], ['90% high', plan.lift.high], ['Chance it beats the current split', plan.prob_better],
          ],
        }]
      : []),
    {
      name: 'Response curves',
      rows: [
        ['Channel', 'Weekly spend', 'Revenue median', 'Revenue low', 'Revenue high'],
        ...result.curves.flatMap((c) => c.spend.map((sp, i) => [c.name, sp, c.median[i], c.low[i], c.high[i]])),
      ],
    },
  ])
}

function exportFit(result: RunResult, name: string) {
  const f = result.fit
  downloadCsv(
    `kawkit-fit-${name.replace(/\W+/g, '-').toLowerCase()}.csv`,
    ['date', 'actual', 'modelled', 'band_low', 'band_high', 'baseline', ...result.channels.flatMap((c) => [`${c.name}_contribution`, `${c.name}_low`, `${c.name}_high`])],
    f.dates.map((d, i) => [d, f.actual[i], f.fitted[i], f.band_low[i], f.band_high[i], f.baseline[i], ...result.channels.flatMap((c) => [c.contribution_series.median[i], c.contribution_series.low[i], c.contribution_series.high[i]])]),
  )
}

function exportPosterior(draws: Draws, result: RunResult, name: string) {
  const q = (vals: number[], p: number) => {
    const s = [...vals].sort((a, b) => a - b)
    const pos = (s.length - 1) * p
    const i = Math.floor(pos)
    return i + 1 < s.length ? s[i] * (1 - (pos - i)) + s[i + 1] * (pos - i) : s[i]
  }
  const rows: (string | number)[][] = []
  draws.channels.forEach((c, j) => {
    for (const [param, key, desc] of [['beta', 'beta', 'maximum effect (scaled)'], ['alpha', 'alpha', 'carry-over rate per week'], ['lambda', 'lam', 'saturation speed']] as const) {
      const vals = draws[key].map((d) => d[j])
      rows.push([c, param, desc, q(vals, 0.5), q(vals, 0.05), q(vals, 0.95), vals.reduce((a, b) => a + b, 0) / vals.length])
    }
  })
  const d = result.diagnostics
  rows.push([], ['diagnostics', 'max_rhat', '', d.max_rhat], ['diagnostics', 'min_ess_bulk', '', d.min_ess_bulk], ['diagnostics', 'divergences', '', d.divergences], ['diagnostics', 'verdict', '', d.verdict], ['diagnostics', 'kept_draws', '', draws.beta.length])
  downloadCsv(`kawkit-posterior-summary-${name.replace(/\W+/g, '-').toLowerCase()}.csv`, ['channel', 'parameter', 'meaning', 'median', 'low_5pct', 'high_95pct', 'mean'], rows)
}

function ChannelCard({ c, i }: { c: ChannelResult; i: number }) {
  const [table, setTable] = useState(false)
  const p = c.prior
  return (
    <section className="card" aria-label={`${title(c.name)}: prior versus posterior`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2">
          <span aria-hidden="true" style={{ width: 12, height: 12, background: palette(i), display: 'inline-block' }} />
          {title(c.name)}
        </h3>
        <span className={`badge ${CONF[c.roi.confidence]}`}>{title(c.roi.confidence)} confidence</span>
      </div>
      <p className="text-sm mt-1 num">
        <Term k="roi">ROI</Term> <strong>{fmtRoi(c.roi.median)}</strong> <span className="muted">(90% range {fmtRange(c.roi.low, c.roi.high)})</span> · {fmtPct(c.roi.p_above_1)} chance it is above 1
      </p>
      <div className="mt-2">
        {table ? (
          <table className="data num">
            <caption className="sr-only">Prior and posterior ROI for {c.name}</caption>
            <thead><tr><th scope="col">ROI</th><th scope="col">Median</th><th scope="col">90% range</th></tr></thead>
            <tbody>
              <tr><th scope="row" style={{ fontWeight: 500 }}>Before the data ({p.source === 'yours' ? 'your prior' : 'default prior'})</th><td>{fmtRoi(p.roi.median)}</td><td>{fmtRange(p.roi.low, p.roi.high)}</td></tr>
              <tr><th scope="row" style={{ fontWeight: 500 }}>After the data</th><td>{fmtRoi(c.roi.median)}</td><td>{fmtRange(c.roi.low, c.roi.high)}</td></tr>
            </tbody>
          </table>
        ) : (
          <DensityChart grid={p.grid} prior={p.prior_density} posterior={p.posterior_density} ariaLabel={`ROI of ${c.name} before the data (${fmtRange(p.roi.low, p.roi.high)}) and after (${fmtRange(c.roi.low, c.roi.high)}), on a log scale`} />
        )}
      </div>
      <p className="text-sm mt-2">
        <strong>{p.verdict}.</strong>{' '}
        <span className="muted">
          {p.source === 'yours' ? 'Your prior' : 'The default prior'} said {fmtRange(p.roi.low, p.roi.high)}; {p.moved ? `the result landed ${c.roi.median > p.roi.high ? 'above' : 'below'} that range` : `the range is now ${Math.max(0, Math.round(p.shrink * 100))}% narrower`}.
          {p.note ? ` Source: ${p.note}.` : ''}
        </span>
      </p>
      {p.conflict && <div className="notice notice-warn mt-2 text-sm">The data disagrees with your prior: the result sits outside the range you gave. Check the source of that belief.</div>}
      <button type="button" className="btn btn-small mt-2" aria-pressed={table} onClick={() => setTable((t) => !t)}>
        {table ? 'Show chart' : 'Show table'}<span className="sr-only"> for {c.name} prior versus posterior</span>
      </button>
    </section>
  )
}

interface Props {
  name: string
  result: RunResult
  draws: Draws | null
  drawsError?: string | null
  /** a shared link: no posterior draws, so the interactive optimiser is replaced by the stored plan */
  shared?: boolean
  priors?: Priors
  /** the owner's run id: enables saved scenarios (not shown for samples or shared links) */
  runId?: string
}

export function ResultsView({ name, result, draws, drawsError, shared, runId }: Props) {
  const toast = useToast()
  // the open tab is remembered per page, so a refresh keeps your place (a convenience only: storage may be unavailable)
  const tabKey = `kawkit-tab:${window.location.hash}`
  const [tab, setTabRaw] = useState(() => {
    try {
      return sessionStorage.getItem(tabKey) ?? 'overview'
    } catch {
      return 'overview'
    }
  })
  const setTab = (id: string) => {
    setTabRaw(id)
    try {
      sessionStorage.setItem(tabKey, id)
    } catch {
      // not remembered
    }
  }
  // other parts of the site can switch tab: window.dispatchEvent(new CustomEvent('kawkit:tab', { detail: { id: 'optimise' } }))
  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id
      if (id) setTabRaw(id)
    }
    window.addEventListener('kawkit:tab', on)
    return () => window.removeEventListener('kawkit:tab', on)
  }, [])
  const [reveal, setReveal] = useState(false)
  const [report, setReport] = useState(false)
  const show = (id: string) => (report ? id !== 'optimise' && id !== 'download' : tab === id)
  const d = result.diagnostics
  const f = result.fit
  const v = VERDICT[d.verdict] ?? VERDICT.fail
  const hidden = d.verdict === 'fail' && !reveal
  const ch = result.channels
  const tests = testCandidates(ch)

  const convergence = (
    <section className={`notice ${v.cls}`} aria-labelledby="conv-h">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="conv-h" className="text-base"><Term k="convergence">Convergence</Term> check</h2>
        <VerdictBadge verdict={d.verdict} />
      </div>
      <p className="mt-1">{v.text}</p>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 mt-2 text-sm num">
        <div><dt className="muted">Worst <Term k="rhat">R-hat</Term></dt><dd><strong>{d.max_rhat.toFixed(3)}</strong> (want ≤ 1.01)</dd></div>
        <div><dt className="muted">Smallest effective sample</dt><dd><strong>{fmtNum(d.min_ess_bulk)}</strong> (want ≥ 400)</dd></div>
        <div><dt className="muted">Divergent draws</dt><dd><strong>{d.divergences}</strong> ({d.divergence_pct}%; want &lt; 0.1%)</dd></div>
        <div><dt className="muted">Sampling</dt><dd>{d.chains} chains × {fmtNum(d.draws)} draws{d.retried ? ', retried with longer warm-up' : ''}</dd></div>
      </dl>
    </section>
  )

  if (hidden) {
    return (
      <div className="grid gap-4">
        {convergence}
        <div className="card">
          <h2>Results are hidden</h2>
          <p className="mt-1">Because the model did not converge, its estimates are unreliable. This usually means the data cannot separate the channels (steady spend, very few weeks, or channels that always move together). Try more weeks of data, fewer channels, or priors from experiments.</p>
          <button type="button" className="btn btn-danger mt-3" onClick={() => setReveal(true)}>Show the results anyway</button>
        </div>
      </div>
    )
  }

  const weeks = f.dates
  const roiRows = ch.map((c, i) => ({ label: title(c.name), ...c.roi, color: palette(i), detail: `${fmtPct(c.roi.p_above_1)} chance above 1` }))
  const tabs = [
    { id: 'overview', label: 'Fit' },
    { id: 'channels', label: 'Channels' },
    { id: 'priors', label: 'Prior vs posterior' },
    { id: 'curves', label: 'Response curves' },
    { id: 'optimise', label: 'Optimise budget' },
    { id: 'download', label: 'Download' },
  ]

  const plan = result.default_plan
  const sections = (
    <>
        {show('overview') && (
          <div className="grid gap-4">
            {report && <h2>Fit</h2>}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Tile label={<>Variation explained (<Term k="r2">R²</Term>)</>} value={fmtPct(f.r2, 1)} sub={`${f.weeks} weeks`} />
              {f.holdout?.wape !== undefined && f.holdout.benchmark ? (
                <>
                  <Tile label={<><Term k="holdout">Unseen quarter</Term>: total off by</>} value={`${Math.abs(f.holdout.total_error_pct).toFixed(1)}%`} sub={`simple forecast: ${Math.abs(f.holdout.benchmark.total_error_pct).toFixed(1)}%`} />
                  <Tile label={<><Term k="holdout">Unseen weeks</Term>: typical miss</>} value={`${f.holdout.wape.toFixed(1)}%`} sub={`simple forecast: ${f.holdout.benchmark.wape.toFixed(1)}%`} />
                </>
              ) : (
                <>
                  <Tile label={<>Typical <Term k="mape">error</Term>, in sample</>} value={`${f.mape.toFixed(1)}%`} sub="mean absolute % error" />
                  <Tile label="Typical error, unseen weeks" value={f.holdout_mape === null ? 'n/a' : `${f.holdout_mape.toFixed(1)}%`} sub={f.holdout_mape === null ? 'too few weeks to hold any out' : `last ${f.holdout_weeks} weeks held out`} />
                </>
              )}
              <Tile label="Revenue driven by media" value={fmtPct(f.media_share.median)} sub={`90% range ${fmtPct(f.media_share.low)} to ${fmtPct(f.media_share.high)}`} />
            </div>
            <ChartFrame
              title="Actual vs modelled revenue"
              note={`The shaded band is where the model expects 90% of weeks to fall; ${fmtPct(f.coverage90)} of actual weeks did.`}
              table={{ caption: 'Actual and modelled revenue by week', header: ['Week', 'Actual', 'Modelled', 'Band low', 'Band high', 'Baseline'], rows: weeks.map((w, i) => [w, fmtNum(f.actual[i]), fmtNum(f.fitted[i]), fmtNum(f.band_low[i]), fmtNum(f.band_high[i]), fmtNum(f.baseline[i])]) }}
            >
              <LineChart
                ariaLabel={`Line chart of actual and modelled weekly revenue from ${weeks[0]} to ${weeks[weeks.length - 1]}; R squared ${fmtPct(f.r2, 1)}`}
                x={weeks}
                series={[
                  { label: 'Modelled', values: f.fitted, color: 'var(--c0)', band: { low: f.band_low, high: f.band_high } },
                  { label: 'Actual', values: f.actual, color: 'var(--text)', width: 1.5 },
                  { label: 'Baseline (no media)', values: f.baseline, color: 'var(--c7)', dashed: true, width: 1.5 },
                ]}
              />
            </ChartFrame>
            {f.holdout && (
              <ChartFrame
                title="Can you trust it? Predicting weeks the model never saw"
                note={`The last ${f.holdout.dates.length} weeks were hidden and the model was fitted again without them. Its total for those weeks was off by ${Math.abs(f.holdout.total_error_pct).toFixed(1)}%, and a typical week by ${(f.holdout.wape ?? f.holdout_mape ?? 0).toFixed(1)}%; ${f.holdout.inside} of ${f.holdout.dates.length} actual weeks fell inside its 90% range.${f.holdout.benchmark ? ` For comparison, ${f.holdout.benchmark.method} would have been off by ${Math.abs(f.holdout.benchmark.total_error_pct).toFixed(1)}% in total and ${f.holdout.benchmark.wape.toFixed(1)}% a week.` : ''}`}
                table={{ caption: 'Predicted and actual revenue for the held-out weeks', header: ['Week', 'Actual', 'Predicted', '90% low', '90% high', 'Inside range'], rows: f.holdout.dates.map((w, i) => [w, fmtNum(f.holdout!.actual[i]), fmtNum(f.holdout!.predicted[i]), fmtNum(f.holdout!.low[i]), fmtNum(f.holdout!.high[i]), f.holdout!.actual[i] >= f.holdout!.low[i] && f.holdout!.actual[i] <= f.holdout!.high[i] ? 'Yes' : 'No']) }}
              >
                <LineChart
                  ariaLabel={`Line chart of predicted and actual revenue for the ${f.holdout.dates.length} held-out weeks`}
                  x={f.holdout.dates}
                  height={240}
                  zeroBased={false}
                  series={[
                    { label: 'Predicted without seeing these weeks', values: f.holdout.predicted, color: 'var(--c0)', band: { low: f.holdout.low, high: f.holdout.high } },
                    { label: 'Actual', values: f.holdout.actual, color: 'var(--text)', width: 1.5 },
                  ]}
                />
              </ChartFrame>
            )}
            {f.drivers && f.drivers.length > 0 && (
              <ChartFrame
                title="What else moves sales: baseline drivers"
                note="Effect on weekly revenue of each non-media factor you supplied. For an event, the change in a week it happens; for a measure such as temperature, its highest observed value against its lowest. These sit in the baseline, so advertising is not credited with them."
                table={{
                  caption: 'Effect of each baseline driver on weekly revenue',
                  header: ['Driver', 'Compared', 'Effect on weekly revenue', '90% range', 'Chance it raises sales', 'Share of all revenue'],
                  rows: f.drivers.map((d) => [title(d.name), d.binary ? `${d.active_weeks} week${d.active_weeks === 1 ? '' : 's'} with it vs without` : `${fmtNum(d.high_value, 1)} vs ${fmtNum(d.low_value, 1)}`, fmtCompact(d.effect.median), fmtRange(d.effect.low, d.effect.high, fmtCompact), fmtPct(d.p_positive), `${fmtPct(d.share.median, 1)} (${fmtPct(d.share.low, 1)} to ${fmtPct(d.share.high, 1)})`]),
                }}
              >
                <IntervalBars
                  ariaLabel="Effect of each baseline driver on weekly revenue, with 90% credible ranges"
                  rows={f.drivers.map((d) => ({ label: title(d.name), ...d.effect, color: d.effect.low > 0 || d.effect.high < 0 ? 'var(--c0)' : 'var(--c7)', detail: d.effect.low > 0 || d.effect.high < 0 ? `${fmtPct(d.p_positive)} chance it raises sales` : 'Range includes zero: no clear effect' }))}
                  reference={{ value: 0, label: 'no effect' }}
                  xLabel="Change in weekly revenue"
                />
              </ChartFrame>
            )}
          </div>
        )}

        {show('channels') && (
          <div className="grid gap-4">
            {report && <h2>Channels</h2>}
            {tests.length > 0 && (
              <section className="summary" aria-labelledby="test-h">
                <p className="eyebrow" id="test-h">What to test next</p>
                <p className="mt-1">
                  <strong>Run an experiment on {title(tests[0].name)} first.</strong> You spend about {fmtCompact(tests[0].weeklySpend)} a week there, and its return could be anywhere from {fmtRoi(tests[0].roiLow)} to {fmtRoi(tests[0].roiHigh)}. That is the difference between {fmtCompact(tests[0].revenueLow)} and {fmtCompact(tests[0].revenueHigh)} of weekly revenue, and {fmtPct(tests[0].share)} of all the uncertainty in this result.
                  {tests[1] ? ` ${title(tests[1].name)} is next (${fmtPct(tests[1].share)}).` : ''}
                </p>
                <p className="text-sm muted mt-1">A simple test: pause or halve the channel in some regions for 4 to 6 weeks and compare sales with the rest. Enter the return you measure as that channel’s ROI range on your next run, and every other estimate sharpens with it.</p>
                <details className="mt-2">
                  <summary className="text-sm font-semibold cursor-pointer">How much rides on each channel</summary>
                  <div className="overflow-x-auto mt-2">
                    <table className="data num">
                      <caption className="sr-only">Weekly revenue at stake from not knowing each channel’s return</caption>
                      <thead><tr><th scope="col">Channel</th><th scope="col">Weekly spend</th><th scope="col">ROI range</th><th scope="col">Weekly revenue at stake</th><th scope="col">Share of uncertainty</th></tr></thead>
                      <tbody>
                        {tests.map((t) => (
                          <tr key={t.name}><th scope="row" style={{ fontWeight: 500 }}>{title(t.name)}</th><td>{fmtNum(t.weeklySpend)}</td><td>{fmtRange(t.roiLow, t.roiHigh)}</td><td>{fmtCompact(t.swing)}</td><td>{fmtPct(t.share)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </section>
            )}
            <ChartFrame
              title="Return on spend (ROI) per channel"
              note="Revenue generated per unit of spend. Dot = median, bar = 90% credible range."
              table={{ caption: 'ROI per channel', header: ['Channel', 'Median ROI', '90% range', 'Chance above 1', 'Confidence', 'Marginal ROI (90% range)'], rows: ch.map((c) => [title(c.name), fmtRoi(c.roi.median), fmtRange(c.roi.low, c.roi.high), fmtPct(c.roi.p_above_1), title(c.roi.confidence), `${fmtRoi(c.mroi.median)} (${fmtRange(c.mroi.low, c.mroi.high)})`]) }}
            >
              <IntervalBars ariaLabel="ROI per channel with 90% credible ranges" rows={roiRows} fmt={fmtRoi} reference={{ value: 1, label: 'break-even (1.0)' }} xLabel="ROI (revenue per unit of spend)" />
            </ChartFrame>
            <ChartFrame
              title="Marginal ROI at current spend"
              note="What the next unit of weekly spend returns at your recent level (average of the last 13 weeks). Below the average ROI means the channel is saturating."
              table={{ caption: 'Marginal ROI per channel', header: ['Channel', 'Current weekly spend', 'Marginal ROI', '90% range'], rows: ch.map((c) => [title(c.name), fmtNum(c.current_weekly), fmtRoi(c.mroi.median), fmtRange(c.mroi.low, c.mroi.high)]) }}
            >
              <IntervalBars ariaLabel="Marginal ROI per channel with 90% credible ranges" rows={ch.map((c, i) => ({ label: title(c.name), ...c.mroi, color: palette(i) }))} fmt={fmtRoi} reference={{ value: 1, label: 'break-even (1.0)' }} xLabel="Marginal ROI" />
            </ChartFrame>
            <ChartFrame
              title="Total contribution to revenue"
              note="Revenue attributed to each channel over the whole period."
              table={{ caption: 'Contribution per channel', header: ['Channel', 'Spend', 'Contribution', '90% range', 'Share of revenue (90% range)'], rows: ch.map((c) => [title(c.name), fmtNum(c.total_spend), fmtNum(c.contribution.median), fmtRange(c.contribution.low, c.contribution.high, fmtCompact), `${fmtPct(c.contribution.share.median, 1)} (${fmtPct(c.contribution.share.low, 1)} to ${fmtPct(c.contribution.share.high, 1)})`]) }}
            >
              <IntervalBars ariaLabel="Total contribution per channel with 90% credible ranges" rows={ch.map((c, i) => ({ label: title(c.name), median: c.contribution.median, low: c.contribution.low, high: c.contribution.high, color: palette(i) }))} xLabel="Revenue attributed over the period" />
            </ChartFrame>
            <ChartFrame
              title="Contribution over time"
              note="Median weekly contribution per channel. Hover for the 90% range each week."
              table={{ caption: 'Weekly contribution per channel, median with 90% range', header: ['Week', ...ch.map((c) => title(c.name))], rows: weeks.map((w, i) => [w, ...ch.map((c) => `${fmtCompact(c.contribution_series.median[i])} (${fmtCompact(c.contribution_series.low[i])} to ${fmtCompact(c.contribution_series.high[i])})`)]) }}
            >
              <LineChart ariaLabel="Line chart of weekly contribution per channel" x={weeks} series={ch.map((c, i) => ({ label: title(c.name), values: c.contribution_series.median, color: palette(i), band: { low: c.contribution_series.low, high: c.contribution_series.high }, width: 1.6 }))} />
            </ChartFrame>
            <ChartFrame
              title="Carry-over half-life"
              note="Weeks until half of a week's advertising effect has played out."
              table={{ caption: 'Carry-over and saturation per channel', header: ['Channel', 'Half-life (weeks)', '90% range', 'Spend at 90% of maximum effect', '90% range'], rows: ch.map((c) => [title(c.name), c.half_life_weeks.median.toFixed(1), fmtRange(c.half_life_weeks.low, c.half_life_weeks.high, (x) => x.toFixed(1)), fmtCompact(c.saturation_spend.median), fmtRange(c.saturation_spend.low, c.saturation_spend.high, fmtCompact)]) }}
            >
              <IntervalBars ariaLabel="Carry-over half-life in weeks per channel with 90% credible ranges" rows={ch.map((c, i) => ({ label: title(c.name), ...c.half_life_weeks, color: palette(i), detail: `Saturates (90% of max) near ${fmtCompact(c.saturation_spend.median)} a week (${fmtRange(c.saturation_spend.low, c.saturation_spend.high, fmtCompact)})` }))} fmt={(x) => x.toFixed(1)} xLabel="Weeks" />
            </ChartFrame>
          </div>
        )}

        {show('priors') && (
          <div className="grid gap-4">
            {report && <h2>Prior vs posterior</h2>}
            <p className="muted">How far the data moved each belief. A wide dashed curve that becomes a narrow solid one means the data was informative; if the two look alike, the result mostly reflects the prior.</p>
            <div className="grid gap-4 md:grid-cols-2">
              {ch.map((c, i) => <ChannelCard key={c.name} c={c} i={i} />)}
            </div>
          </div>
        )}

        {show('curves') && (
          <div className="grid gap-4 md:grid-cols-2">
            {report && <h2 className="md:col-span-2">Response curves</h2>}
            {result.curves.map((c, i) => (
              <ChartFrame
                key={c.name}
                title={`${title(c.name)}: response curve`}
                note="Weekly revenue from the channel at a steady weekly spend."
                table={{ caption: `Response curve for ${c.name}`, header: ['Weekly spend', 'Revenue (median)', '90% low', '90% high'], rows: c.spend.map((s, k) => [fmtNum(s), fmtNum(c.median[k]), fmtNum(c.low[k]), fmtNum(c.high[k])]) }}
              >
                <CurveExplorer c={c} i={i} />
              </ChartFrame>
            ))}
          </div>
        )}

        {show('optimise') &&
          (draws ? (
            <Optimise draws={draws} runName={name} runId={runId} />
          ) : shared ? (
            plan ? (
              <div className="card grid gap-2">
                <h3>Recommended budget split</h3>
                <p className="muted">At the same weekly budget ({fmtNum(plan.budget)}), with each channel kept between 50% and 150% of its recent spend. Expected change in weekly revenue from media: {fmtCompact(plan.lift.mean)} (90% range {fmtCompact(plan.lift.low)} to {fmtCompact(plan.lift.high)}); {fmtPct(plan.prob_better)} chance it beats the current split.</p>
                <DataTable caption="Current and recommended weekly spend" header={['Channel', 'Current', 'Recommended', 'Change']} rows={plan.channels.map((c, i) => [title(c), fmtNum(plan.current[i]), fmtNum(plan.recommended[i]), plan.current[i] > 0 ? `${(((plan.recommended[i] - plan.current[i]) / plan.current[i]) * 100).toFixed(0)}%` : '–'])} />
                <p className="text-sm muted">The interactive optimiser, scenario planner and target mode are available to the person who ran this model.</p>
              </div>
            ) : (
              <p className="muted">No budget recommendation was stored with this run.</p>
            )
          ) : (
            <p role="status" className={drawsError ? 'notice notice-bad' : 'muted'}>{drawsError ?? 'Loading posterior draws…'}</p>
          ))}

        {show('download') && (
          <div className="card grid gap-3">
            <h3>Download</h3>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-primary" onClick={() => { exportWorkbook(result, name); toast('Workbook downloaded') }}>Excel workbook (everything)</button>
              <button type="button" className="btn" onClick={() => exportResults(result, name)}>Channel results</button>
              <button type="button" className="btn" onClick={() => exportFit(result, name)}>Weekly fit and contributions</button>
              <button type="button" className="btn" disabled={!result.default_plan} onClick={() => result.default_plan && exportPlan(result.default_plan, name)}>Recommended split (default limits)</button>
              <button type="button" className="btn" disabled={!draws} onClick={() => draws && exportPosterior(draws, result, name)}>Posterior summary</button>
            </div>
            <p className="text-sm muted">For a split with your own budget and limits, use the download button on the Optimise tab.</p>
          </div>
        )}
        {report && plan && (
          <div className="grid gap-2">
            <h2>Recommended budget split</h2>
            <p className="muted">At the same weekly budget ({fmtNum(plan.budget)}), with each channel kept between 50% and 150% of its recent spend. Expected change in weekly revenue from media: {fmtCompact(plan.lift.mean)} (90% range {fmtCompact(plan.lift.low)} to {fmtCompact(plan.lift.high)}); {fmtPct(plan.prob_better)} chance it beats the current split.</p>
            <DataTable caption="Current and recommended weekly spend" header={['Channel', 'Current', 'Recommended', 'Change']} rows={plan.channels.map((c, i) => [title(c), fmtNum(plan.current[i]), fmtNum(plan.recommended[i]), plan.current[i] > 0 ? `${(((plan.recommended[i] - plan.current[i]) / plan.current[i]) * 100).toFixed(0)}%` : '–'])} />
          </div>
        )}
    </>
  )

  return (
    <div className="grid gap-4">
      {d.verdict === 'fail' && <div className="notice notice-bad" role="alert"><strong>Unreliable:</strong> you chose to view results from a model that did not converge.</div>}
      {report && (
        <div className="report-only">
          <p className="eyebrow">Kawkit report</p>
          <p className="text-xl font-bold">{name}</p>
          <p className="muted text-sm">{f.weeks} weeks, {f.dates[0]} to {f.dates[f.dates.length - 1]} · {ch.length} channels</p>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2 no-print">
        {report ? (
          <>
            <button type="button" className="btn btn-primary" onClick={() => window.print()}>Print or save as PDF</button>
            <button type="button" className="btn" onClick={() => setReport(false)}>Back to the interactive view</button>
          </>
        ) : (
          <button type="button" className="btn" onClick={() => { setReport(true); window.scrollTo(0, 0) }}>Open printable report</button>
        )}
      </div>
      <Summary result={result} />
      {convergence}
      {report ? <div className="grid gap-6">{sections}</div> : <Tabs tabs={tabs} active={tab} onChange={setTab} label="Result sections">{sections}</Tabs>}
    </div>
  )
}
