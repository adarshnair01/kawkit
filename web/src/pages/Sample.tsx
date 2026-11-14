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
  synthetic: { label: 'Made-up data with known answers', file: 'sample', draws: 'draws', csv: 'sample.csv' },
  real: { label: 'A real e-commerce brand', file: 'real', draws: 'real-draws', csv: 'real.csv' },
} as const
type Key = keyof typeof EXAMPLES

export default function Sample() {
  const [params, setParams] = useSearchParams()
  const key: Key = params.get('example') === 'real' ? 'real' : 'synthetic'
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

  const picker = (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Choose an example">
      {(Object.keys(EXAMPLES) as Key[]).map((k) => (
        <button key={k} type="button" className={`btn ${key === k ? 'btn-primary' : ''}`} aria-pressed={key === k} onClick={() => setParams(k === 'real' ? { example: 'real' } : {}, { replace: true })}>
          {EXAMPLES[k].label}
        </button>
      ))}
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
      {key === 'real' && src && (
        <>
          <p className="muted">
            Real, anonymised data from one online brand: {src.vertical} ({src.subvertical}), based in the {src.territory}. {s.weeks} weeks from {s.start} to {s.end}, {fmtNum(s.revenue_total)} {src.currency} in revenue, {s.channels.length} paid channels. Daily rows were summed to weeks; revenue is merchandise value after discounts. No priors were given.{' '}
            <a href={csv} download>Download the weekly file (CSV)</a>.
          </p>
          <div className="notice notice-warn">
            <strong>Read this one with more care than the made-up example.</strong>
            <ul className="list-disc pl-5 mt-1 grid gap-1">
              <li>There is no known answer to check against, and real data is noisier: the model explains {fmtPct(f.r2)} of the week-to-week variation here and was off by {f.holdout_mape?.toFixed(1)}% in a typical unseen week.</li>
              <li>The model credits {fmtPct(f.media_share.median)} of revenue to paid media (90% range {fmtPct(f.media_share.low)} to {fmtPct(f.media_share.high)}). That is probably too generous: brands tend to spend more in weeks when they expect to sell more, and a model of past data cannot tell that apart from ads causing the sales. An experiment could.</li>
              <li>Three channels have very little spend, so their estimates mostly reflect the starting assumption. The result says so for each.</li>
              <li>The brand was chosen for its data, not its results: of the series with at least 104 weeks, it has the most channels with steady, varied spend.</li>
            </ul>
          </div>
          <p className="text-sm muted">
            Source: {src.citation} <a href={src.doi}>{src.doi.replace('https://', '')}</a>. Licensed <a href={src.license_url}>{src.license}</a>. Weekly totals were derived from the daily data for this example.
          </p>
        </>
      )}
      <ResultsView key={key} name={key === 'real' ? 'real-brand' : 'sample'} result={sample.result} draws={draws} />
      <p className="notice">Want this for your own data? <Link to="/sign-in">Sign in</Link> and upload a CSV.</p>
    </div>
  )
}
