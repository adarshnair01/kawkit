import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Draws, Run, RunResult } from '../api/types'
import { ResultsView } from '../components/ResultsView'
import { fmtRoi, title } from '../lib/format'

interface SampleFile {
  run: Pick<Run, 'name' | 'priors' | 'data_summary'>
  result: RunResult
  truth: Record<string, number>
}

export default function Sample() {
  const [sample, setSample] = useState<SampleFile | null>(null)
  const [draws, setDraws] = useState<Draws | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const base = import.meta.env.BASE_URL
    Promise.all([fetch(`${base}sample/sample.json`).then((r) => r.json()), fetch(`${base}sample/draws.json`).then((r) => r.json())])
      .then(([s, d]) => {
        setSample(s as SampleFile)
        setDraws(d as Draws)
      })
      .catch(() => setError('The sample could not be loaded. Refresh the page to try again.'))
  }, [])
  if (error) return <div className="notice notice-bad" role="alert">{error}</div>
  if (!sample) return <p className="muted" role="status">Loading the sample…</p>
  const s = sample.run.data_summary
  return (
    <div className="grid gap-4">
      <div>
        <h1>Sample result</h1>
        <p className="muted mt-1">
          A finished run on made-up data: {s.weeks} weeks, {s.channels.length} channels ({s.channels.map((c) => title(c.name)).join(', ')}) and a promotion flag. TV was given a prior from a pretend geo test.{' '}
          <a href={`${import.meta.env.BASE_URL}sample/sample.csv`} download>Download the data (CSV)</a>.
        </p>
      </div>
      <details className="card">
        <summary className="font-semibold cursor-pointer">Because the data is made up, the true ROIs are known. Compare them with the model’s ranges.</summary>
        <div className="overflow-x-auto mt-2">
          <table className="data num">
            <caption className="sr-only">True ROI against the model’s estimate</caption>
            <thead><tr><th scope="col">Channel</th><th scope="col">True ROI</th><th scope="col">Model median</th><th scope="col">Model 90% range</th><th scope="col">Truth inside range</th></tr></thead>
            <tbody>
              {sample.result.channels.map((c) => {
                const t = sample.truth[c.name]
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
      <ResultsView name="sample" result={sample.result} draws={draws} />
      <p className="notice">Want this for your own data? <Link to="/sign-in">Sign in</Link> and upload a CSV.</p>
    </div>
  )
}
