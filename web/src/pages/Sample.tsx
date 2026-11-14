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

interface FeatureTest {
  method: string
  order: string[]
  chosen: Record<string, string>
  results: Record<string, Record<string, { mape: number; wape: number }>>
  search: Record<string, Record<string, { mape: number; wape: number; media_share?: number }>>
  search_order: string[]
  used: Record<string, string>
  accuracy: Record<string, { model: { weekly: number; quarter: number }; simple: { name: string; weekly: number; quarter: number }; quarters: number[] }>
  tried: { name: string; result: string }[]
  terms: Record<string, string>
}
const SET_LABELS: Record<string, string> = {
  none: 'No outside factors',
  events: 'Calendar events (Black Friday, Cyber week, pre-Christmas, Christmas and New Year, Easter)',
  promo: 'Promotion depth (average discount rate)',
  weather: 'Weather (temperature and rain against the seasonal norm)',
  macro: 'Economy (consumer confidence, inflation)',
  'events+promo': 'Events + promotions',
  'events+promo+macro': 'Events + promotions + economy',
  all: 'All of the above',
  'events+category': 'Events + category search interest',
  'events+promo+category': 'Events + promotions + category search interest',
  chosen: 'The set this brand used before search interest was tested',
  'chosen+category_search': '+ search interest in the product category (Google Trends)',
  'chosen+brand_search': '+ searches for the brand itself, same week',
  'chosen+brand_search_lag': '+ searches for the brand itself, previous week',
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
  const [features, setFeatures] = useState<FeatureTest | null>(null)
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}sample/real-features.json`).then((r) => r.json()).then(setFeatures).catch(() => undefined)
  }, [])
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
  const weak = sample.result.channels.filter((c) => !(c.prior.informed ?? c.prior.shrink >= 0.2))
  const test = features?.results[key]
  const searchTest = features?.search?.[key]
  const acc = features?.accuracy?.[key]
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
            Real, anonymised data from one online brand: {src.vertical}{src.subvertical !== 'Other' ? ` (${src.subvertical})` : ''}, based in the {src.territory}. {s.weeks} weeks from {s.start} to {s.end}, {fmtNum(s.revenue_total)} {src.currency} in revenue, {s.channels.length} paid channels{s.controls.length ? ` and ${s.controls.length} outside factors in the baseline` : ''}. Daily rows were summed to weeks; revenue is merchandise value after discounts. No priors were given.{' '}
            <a href={csv} download>Download the weekly file (CSV)</a>.
          </p>
          <div className="notice notice-warn">
            <strong>Read this one with more care than the made-up example.</strong>
            <ul className="list-disc pl-5 mt-1 grid gap-1">
              <li>There is no known answer to check against, and real data is noisier: the model explains {fmtPct(f.r2)} of the week-to-week variation here and was off by {f.holdout_mape?.toFixed(1)}% in a typical unseen week.</li>
              <li>
                The model starts from the expectation that 50% to 90% of revenue would happen without advertising. Here it ends up crediting {fmtPct(1 - f.media_share.median)} to that baseline and {fmtPct(f.media_share.median)} to paid media (90% range {fmtPct(f.media_share.low)} to {fmtPct(f.media_share.high)}).{' '}
                {f.media_share.median > 0.6
                  ? 'The data pushed hard against that expectation, which usually means spend rises and falls with sales so closely that the model cannot separate the two. Do not act on the split below without an experiment.'
                  : 'Brands tend to spend more in weeks when they expect to sell more, and a model of past data cannot fully tell that apart from ads causing the sales. An experiment could.'}
              </li>
              {weak.length > 0 && <li>{weak.length === 1 ? 'One channel has' : `${weak.length} channels have`} too little spend or variation to measure ({weak.map((c) => title(c.name)).join(', ')}), so {weak.length === 1 ? 'its estimate mostly reflects' : 'their estimates mostly reflect'} the starting assumption.</li>}
              <li>The five brands were chosen for their data, not their results: among series with at least 104 weeks, the one with the most steadily used, varied channels in each of five product categories.</li>
            </ul>
          </div>
          {acc && (
            <section className="card" aria-labelledby="acc-h">
              <h2 id="acc-h">How accurate is it?</h2>
              <p className="text-sm muted mt-1">
                Three quarters (13 weeks each) were hidden in turn, and the model predicted each from the weeks before it. A marketing mix model is judged first on whether it beats a forecast that needs no model, and on the quarter’s total, which is what a budget is set against.
              </p>
              <div className="overflow-x-auto mt-2">
                <table className="data num">
                  <caption className="sr-only">Error on three unseen quarters: the model against a simple forecast</caption>
                  <thead><tr><th scope="col">Forecast</th><th scope="col">Quarter total off by</th><th scope="col">Typical week off by</th></tr></thead>
                  <tbody>
                    <tr><th scope="row" style={{ fontWeight: 600 }}>This model</th><td>{acc.model.quarter.toFixed(1)}%</td><td>{acc.model.weekly.toFixed(1)}%</td></tr>
                    <tr><th scope="row" style={{ fontWeight: 500, whiteSpace: 'normal' }}>Simple forecast: {acc.simple.name}</th><td>{acc.simple.quarter.toFixed(1)}%</td><td>{acc.simple.weekly.toFixed(1)}%</td></tr>
                  </tbody>
                </table>
              </div>
              <p className="text-sm mt-2">
                {acc.model.weekly < acc.simple.weekly - 3
                  ? <><strong>The model clearly beats the simple forecast</strong>, cutting the weekly miss by {Math.round((1 - acc.model.weekly / acc.simple.weekly) * 100)}%. </>
                  : acc.model.weekly < acc.simple.weekly
                    ? <><strong>The model is only slightly better than the simple forecast.</strong> </>
                    : <><strong>The model does not beat the simple forecast</strong> for this brand. Use it for how to split the budget between channels, not to forecast sales. </>}
                The quarter totals were off by {acc.quarters.map((q) => `${q.toFixed(1)}%`).join(', ')} in turn{Math.max(...acc.quarters) > 25 ? ': most quarters are close, but one is far off, which points to an event the data does not record, such as a large promotion, a stock-out or a site problem' : ''}.
              </p>
            </section>
          )}
          {test && (
            <details className="card">
              <summary className="font-semibold cursor-pointer">Outside factors: which ones were tested, and which reduced the error for this brand</summary>
              <p className="mt-2 text-sm muted">
                Sales also move for reasons that have nothing to do with advertising. Each group of factors below was added to the baseline and tested by predicting 39 weeks the model had not seen (three blocks of 13). Lower error is better. This brand uses <strong>{features!.used[key]}</strong>.
              </p>
              <div className="overflow-x-auto mt-2">
                <table className="data num">
                  <caption className="sr-only">Error on unseen weeks for each group of outside factors</caption>
                  <thead><tr><th scope="col">Factors added to the baseline</th><th scope="col">Error on unseen weeks</th><th scope="col">Change</th><th scope="col">Used</th></tr></thead>
                  <tbody>
                    {features!.order.filter((k) => test[k]).map((k) => (
                      <tr key={k}>
                        <th scope="row" style={{ fontWeight: 500, whiteSpace: 'normal' }}>{SET_LABELS[k]}</th>
                        <td>{test[k].wape.toFixed(1)}%</td>
                        <td>{k === 'none' ? '–' : `${test[k].wape - test.none.wape > 0 ? '+' : '−'}${Math.abs(test[k].wape - test.none.wape).toFixed(1)} pts`}</td>
                        <td>{features!.chosen[key] === k ? 'Yes' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {searchTest && (
                <>
                  <h2 className="mt-4 text-base">Does search interest help?</h2>
                  <p className="text-sm muted mt-1">
                    Two kinds were tested on top of that set. Interest in the product category comes from Google Trends for “{features!.terms[key]}” in the brand’s country. The brands are anonymous, so their own Google Trends cannot be looked up; clicks from searches for the brand name, recorded in the dataset, stand in for it.
                  </p>
                  <div className="overflow-x-auto mt-2">
                    <table className="data num">
                      <caption className="sr-only">Error on unseen weeks with search interest added</caption>
                      <thead><tr><th scope="col">Added to the baseline</th><th scope="col">Error on unseen weeks</th><th scope="col">Change</th><th scope="col">Revenue credited to media</th></tr></thead>
                      <tbody>
                        {features!.search_order.filter((k) => searchTest[k]).map((k) => (
                          <tr key={k}>
                            <th scope="row" style={{ fontWeight: 500, whiteSpace: 'normal' }}>{SET_LABELS[k]}</th>
                            <td>{searchTest[k].wape.toFixed(1)}%</td>
                            <td>{k === 'chosen' ? '–' : `${searchTest[k].wape - searchTest.chosen.wape > 0 ? '+' : '−'}${Math.abs(searchTest[k].wape - searchTest.chosen.wape).toFixed(1)} pts`}</td>
                            <td>{searchTest[k].media_share !== undefined ? fmtPct(searchTest[k].media_share!) : '–'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              <ul className="list-disc pl-5 mt-2 text-sm muted grid gap-1">
                <li>Also tested, to reduce the error, and rejected: {features!.tried.map((t) => `${t.name.charAt(0).toLowerCase()}${t.name.slice(1)} (${t.result.charAt(0).toLowerCase()}${t.result.slice(1)})`).join('; ')}.</li>
                <li>Error here is total absolute error as a share of total revenue over the hidden weeks.</li>
                <li>Category search interest gave a small gain for the skincare and dental brands and none for the others, so only those two use it. The search terms are guesses from each brand’s sub-category.</li>
                <li>Searches for the brand itself are not used. They made predictions worse for two of the three brands that have the data, and they are partly caused by advertising, so putting them in the baseline takes credit away from the ads that prompted them.</li>
                <li>Weather did not help any of the five brands. The economy measures helped the two US brands, but they move slowly, so they may be standing in for a change in trend, not causing it. Read the direction of their effect with caution.</li>
                <li>The sets were picked using these same test weeks, so the gains are a little optimistic.</li>
                <li>Not tested, but likely to help: competitor promotions, stock-outs and price changes. None is in the data.</li>
                <li>Weather from Open-Meteo; consumer confidence and prices from FRED (University of Michigan, OECD, national statistics offices); search interest from Google Trends.</li>
              </ul>
            </details>
          )}
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
