import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

interface Accuracy {
  model: { weekly: number; quarter: number }
  simple: { name: string; weekly: number; quarter: number }
}
const BRANDS: [string, string][] = [
  ['home', 'Home decor (UK)'],
  ['beauty', 'Skincare (US)'],
  ['apparel', 'Apparel (US)'],
  ['food', 'Food and drink (US)'],
  ['health', 'Dental care (UK)'],
]

function Lesson({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="card grid gap-2" aria-labelledby={`l-${n}`}>
      <p className="eyebrow">Lesson {n}</p>
      <h2 id={`l-${n}`}>{title}</h2>
      {children}
    </section>
  )
}

/** What fitting the model to five real brands changed about it. Every figure here was measured, not assumed. */
export default function Lessons() {
  const [acc, setAcc] = useState<Record<string, Accuracy> | null>(null)
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}sample/real-features.json`)
      .then((r) => r.json())
      .then((d) => setAcc(d.accuracy))
      .catch(() => undefined)
  }, [])
  return (
    <div className="grid gap-5" style={{ maxWidth: '52rem' }}>
      <div>
        <p className="eyebrow">Case study</p>
        <h1>What five real brands taught this model</h1>
        <p className="muted mt-2">
          Kawkit was first built and tested on made-up data, where the right answer is known. Then it was fitted to five anonymised e-commerce brands from a public dataset. The model that came out the other side is different in six ways. This page records what broke, what was changed, and what was tried and thrown away.
        </p>
      </div>

      <Lesson n={1} title="The first real fit said advertising drove 122% of revenue">
        <p>On the made-up data the model recovered every true return. On the first real brand it credited paid media with more revenue than the brand had made, which means it believed sales would have been negative with no advertising.</p>
        <p><strong>What changed:</strong> the baseline (sales without advertising) can no longer go below zero in any week. With that single rule the same brand’s media share fell to 76%.</p>
      </Lesson>

      <Lesson n={2} title="The starting assumptions were quietly absurd">
        <p>Plotting each channel’s belief before and after the data showed the two did not even overlap. The default starting point implied typical returns of 3 to 19 per unit spent, with upper ends of 25 to 75, on brands that earn only 3 to 7 of revenue per unit of total spend. One channel’s starting assumption could exceed all revenue.</p>
        <p><strong>What changed:</strong> every channel now starts from the same expected return, the one at which advertising as a whole would explain about 30% of revenue. Priors were not tuned to each brand’s results; that would use the data twice and make every answer look confirmed.</p>
      </Lesson>

      <Lesson n={3} title="Most sales would happen anyway, and the model has to be told">
        <p>Even after the first two fixes, four of five brands showed advertising driving 75% to 98% of revenue. For most businesses the baseline is 50% to 90%.</p>
        <p><strong>What changed:</strong> the model expects the baseline to sit in that range and resists leaving it. Baselines moved from 2–25% to 23–47% for four brands.</p>
        <p><strong>What it cost:</strong> pushing harder made forecasts worse (one brand’s error on unseen weeks rose from 21.5% to 30.9%), so the rule is a strong nudge, not a wall. One brand still lands at about 40%, because its spend tracks its sales so closely that no model of past data can separate them. Its page says not to act on that result without an experiment.</p>
      </Lesson>

      <Lesson n={4} title="Black Friday is not your ads working">
        <p>The largest misses were single weeks. A smooth seasonal curve cannot follow a week that sells three times the usual amount, so the model gave the credit to whichever channel was spending most that week.</p>
        <p><strong>What was tested,</strong> each scored by predicting 39 weeks the model had not seen:</p>
        <ul className="list-disc pl-5 grid gap-1">
          <li><strong>Calendar events</strong> cut one brand’s error from 19.3% to 15.8%, and to 15.0% with promotion depth added.</li>
          <li><strong>Unemployment</strong> more than halved another’s, from 25.2% to 11.2%.</li>
          <li><strong>Category search interest</strong> gave two brands a small gain (about 1.5 points).</li>
          <li><strong>Weather</strong> helped none of the five.</li>
          <li><strong>Every economic measure at once</strong> made four of the five brands worse, one of them badly (30.8% to 64.3%).</li>
          <li><strong>Searches for the brand itself</strong> made two of three brands worse, and took credit from the advertising that prompted those searches.</li>
        </ul>
        <p><strong>What changed:</strong> outside factors go into the baseline, results show the effect of each one with its range, and a library adds calendar events and economy figures in a click. Each example brand uses only what helped it.</p>
      </Lesson>

      <Lesson n={5} title="Two obvious fixes for the error made it worse">
        <p>A client would reasonably ask why weekly error is 15% to 30% on real data when it is 2% on made-up data. Two standard remedies looked right and were built:</p>
        <ul className="list-disc pl-5 grid gap-1">
          <li><strong>Error that scales with the size of sales:</strong> worse for four of five brands.</li>
          <li><strong>A trend that can change pace each quarter:</strong> worse for all five, because it carries its latest pace forward and overshoots.</li>
        </ul>
        <p>Neither shipped. What the misses actually showed is that the worst three weeks of each quarter account for 31% to 63% of the error, and that for three brands the latest quarter came in 30% to 41% above forecast: an event the data does not record. No modelling choice fixes that; knowing what happened does.</p>
      </Lesson>

      <Lesson n={6} title="A model has to beat a forecast that needs no model">
        <p>Error on its own means little. Each brand’s model was compared with the better of two simple rules: the average of the previous 13 weeks, or the same weeks a year earlier scaled for growth.</p>
        {acc && (
          <div className="overflow-x-auto">
            <table className="data num">
              <caption className="sr-only">Error on three unseen quarters: the model against a simple forecast, per brand</caption>
              <thead>
                <tr><th scope="col">Brand</th><th scope="col">Model: typical week</th><th scope="col">Simple forecast: typical week</th><th scope="col">Model: quarter total</th><th scope="col">Verdict</th></tr>
              </thead>
              <tbody>
                {BRANDS.filter(([k]) => acc[k]).map(([k, label]) => {
                  const a = acc[k]
                  const gain = 1 - a.model.weekly / a.simple.weekly
                  return (
                    <tr key={k}>
                      <th scope="row" style={{ fontWeight: 500 }}><Link to={`/sample?example=${k}`}>{label}</Link></th>
                      <td>{a.model.weekly.toFixed(1)}%</td>
                      <td>{a.simple.weekly.toFixed(1)}%</td>
                      <td>{a.model.quarter.toFixed(1)}%</td>
                      <td style={{ whiteSpace: 'normal' }}>{gain > 0.15 ? `Clearly better (${Math.round(gain * 100)}% smaller miss)` : gain > 0 ? 'Slightly better' : 'No better than the simple rule'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p><strong>What changed:</strong> every run now shows its error on an unseen quarter next to the simple forecast’s, and says plainly when the model does no better. For the one brand where that is true, the advice is to use the model to split budget between channels and not to forecast sales.</p>
      </Lesson>

      <section className="summary" aria-labelledby="take-h">
        <p className="eyebrow" id="take-h">What to take from this</p>
        <ul className="mt-1" style={{ listStyle: 'none', padding: 0 }}>
          <li><strong>Made-up data proves the maths; real data tests the assumptions.</strong> Three of the six changes fixed things the made-up tests could never have caught.</li>
          <li><strong>Test changes on weeks the model has not seen, and keep the failures.</strong> Much of what was tried made things worse.</li>
          <li><strong>The honest answer is sometimes “this cannot be known from this data”.</strong> The tool says so, and suggests the experiment that would settle it.</li>
        </ul>
      </section>

      <p className="text-sm muted">
        Data: Anderson, Anthony (2024). Multi-Region Marketing Mix Modelling (MMM) Dataset for Several eCommerce Brands. figshare. <a href="https://doi.org/10.6084/m9.figshare.25314841.v3">doi.org/10.6084/m9.figshare.25314841.v3</a>, licensed <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. Economy figures from FRED; category search interest from Google Trends; weather from Open-Meteo.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link to="/sample?example=home" className="btn btn-primary">Explore the five brands</Link>
        <Link to="/check" className="btn">Check your own data</Link>
      </div>
    </div>
  )
}
