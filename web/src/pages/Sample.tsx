import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { Draws, Run, RunResult } from '../api/types'
import { ResultsView } from '../components/ResultsView'
import { fmtNum, fmtPct, fmtRoi, title } from '../lib/format'

interface SampleFile {
  run: Pick<Run, 'name' | 'priors' | 'data_summary'>
  result: RunResult
  truth?: Record<string, number>
  source?: { vertical: string; subvertical: string; territory: string; currency: string; citation: string; doi: string; license: string; license_url: string }
}

const EXAMPLES = {
  synthetic: { label: 'Made-up data', file: 'sample', draws: 'draws', csv: 'sample.csv' },
  home: { label: 'Home decor brand', file: 'real-home', draws: 'real-home-draws', csv: 'real-home.csv' },
  beauty: { label: 'Skincare brand', file: 'real-beauty', draws: 'real-beauty-draws', csv: 'real-beauty.csv' },
  apparel: { label: 'Apparel brand', file: 'real-apparel', draws: 'real-apparel-draws', csv: 'real-apparel.csv' },
  food: { label: 'Food and drink brand', file: 'real-food', draws: 'real-food-draws', csv: 'real-food.csv' },
  health: { label: 'Dental care brand', file: 'real-health', draws: 'real-health-draws', csv: 'real-health.csv' },
} as const
type Key = keyof typeof EXAMPLES
const isKey = (v: string | null): v is Key => v !== null && v in EXAMPLES

export default function Sample() {
  const [params, setParams] = useSearchParams()
  const wanted = params.get('example')
  const key: Key = wanted === 'real' ? 'home' : isKey(wanted) ? wanted : 'synthetic'
  const [loaded, setLoaded] = useState<{ key: Key; sample: SampleFile; draws: Draws } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let off = false
    const base = import.meta.env.BASE_URL
    const ex = EXAMPLES[key]
    Promise.all([fetch(`${base}sample/${ex.file}.json`).then((r) => r.json()), fetch(`${base}sample/${ex.draws}.json`).then((r) => r.json())])
      .then(([s, d]) => !off && setLoaded({ key, sample: s as SampleFile, draws: d as Draws }))
      .catch(() => !off && setError('The example could not be loaded. Refresh the page to try again.'))
    return () => {
      off = true
    }
  }, [key])

  const button = (k: Key) => (
    <button key={k} type="button" className={`btn btn-small ${key === k ? 'btn-primary' : ''}`} aria-pressed={key === k} onClick={() => setParams(k === 'synthetic' ? {} : { example: k }, { replace: true })}>
      {EXAMPLES[k].label}
    </button>
  )
  const picker = (
    <div className="card grid gap-3" role="group" aria-label="Choose an example" style={{ padding: '0.8rem 1rem' }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold" style={{ minWidth: '9.5rem' }}>Known answers</span>
        {button('synthetic')}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold" style={{ minWidth: '9.5rem' }}>Real, anonymised brands</span>
        {(Object.keys(EXAMPLES) as Key[]).filter((k) => k !== 'synthetic').map(button)}
      </div>
    </div>
  )
  if (error) return <div className="notice notice-bad" role="alert">{error}</div>
  if (!loaded || loaded.key !== key)
    return (
      <div className="grid gap-4">
        <h1>Sample result</h1>
        {picker}
        <p className="muted" role="status">Loading the example…</p>
      </div>
    )
  const { sample, draws } = loaded
  const s = sample.run.data_summary
  const src = sample.source
  const f = sample.result.fit
  const csv = `${import.meta.env.BASE_URL}sample/${EXAMPLES[key].csv}`
  const weak = sample.result.channels.filter((c) => c.prior.shrink < 0.2)
  return (
    <div className="grid gap-4">
      <h1>Sample result</h1>
      {picker}
      {key === 'synthetic' && sample.truth && (
        <>
          <p className="muted">
            A finished run on made-up data: {s.weeks} weeks, {s.channels.length} channels ({s.channels.map((c) => title(c.name)).join(', ')}) and a promotion flag. TV was given a prior from a pretend geo test.{' '}
            <a href={csv} download>Download the data (CSV)</a>.
          </p>
          <details className="card">
            <summary className="font-semibold cursor-pointer">Because the data is made up, the true ROIs are known. Compare them with the model’s ranges.</summary>
            <div className="overflow-x-auto mt-2">
              <table className="data num">
                <caption className="sr-only">True ROI against the model’s estimate</caption>
                <thead><tr><th scope="col">Channel</th><th scope="col">True ROI</th><th scope="col">Model median</th><th scope="col">Model 90% range</th><th scope="col">Truth inside range</th></tr></thead>
                <tbody>
                  {sample.result.channels.map((c) => {
                    const t = sample.truth![c.name]
                    return (
                      <tr key={c.name}>
                        <th scope="row" style={{ fontWeight: 500 }}>{title(c.name)}</th>
                        <td>{fmtRoi(t)}</td><td>{fmtRoi(c.roi.median)}</td><td>{fmtRoi(c.roi.low)} to {fmtRoi(c.roi.high)}</td><td>{t >= c.roi.low && t <= c.roi.high ? 'Yes' : 'No'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
      {key !== 'synthetic' && src && (
        <>
          <p className="muted">
            Real, anonymised data from one online brand: {src.vertical}{src.subvertical !== 'Other' ? ` (${src.subvertical})` : ''}, based in the {src.territory}. {s.weeks} weeks from {s.start} to {s.end}, {fmtNum(s.revenue_total)} {src.currency} in revenue, {s.channels.length} paid channels. Daily rows were summed to weeks; revenue is merchandise value after discounts. No priors were given.{' '}
            <a href={csv} download>Download the weekly file (CSV)</a>.
          </p>
          <div className="notice notice-warn">
            <strong>Read this one with more care than the made-up example.</strong>
            <ul className="list-disc pl-5 mt-1 grid gap-1">
              <li>There is no known answer to check against, and real data is noisier: the model explains {fmtPct(f.r2)} of the week-to-week variation here and was off by {f.holdout_mape?.toFixed(1)}% in a typical unseen week.</li>
              <li>
                The model credits {fmtPct(f.media_share.median)} of revenue to paid media (90% range {fmtPct(f.media_share.low)} to {fmtPct(f.media_share.high)}).{' '}
                {f.media_share.median > 0.9
                  ? 'Almost all revenue coming from ads is not believable. This brand’s spend rises and falls with its sales so closely that the model cannot separate the two, so do not act on the split below without an experiment.'
                  : f.media_share.median > 0.6
                    ? 'That is probably too generous: brands tend to spend more in weeks when they expect to sell more, and a model of past data cannot tell that apart from ads causing the sales. An experiment could.'
                    : 'Brands tend to spend more in weeks when they expect to sell more, and a model of past data cannot fully tell that apart from ads causing the sales. An experiment could.'}
              </li>
              {weak.length > 0 && <li>{weak.length === 1 ? 'One channel has' : `${weak.length} channels have`} too little spend or variation to measure ({weak.map((c) => title(c.name)).join(', ')}), so {weak.length === 1 ? 'its estimate mostly reflects' : 'their estimates mostly reflect'} the starting assumption.</li>}
              <li>The five brands were chosen for their data, not their results: among series with at least 104 weeks, the one with the most steadily used, varied channels in each of five product categories.</li>
            </ul>
          </div>
          <p className="text-sm muted">
            Source: {src.citation} <a href={src.doi}>{src.doi.replace('https://', '')}</a>. Licensed <a href={src.license_url}>{src.license}</a>. Weekly totals were derived from the daily data for this example.
          </p>
        </>
      )}
      <ResultsView key={key} name={key === 'synthetic' ? 'sample' : `real-${key}`} result={sample.result} draws={draws} />
      <p className="notice">Want this for your own data? <Link to="/sign-in">Sign in</Link> and upload a CSV.</p>
    </div>
  )
}
