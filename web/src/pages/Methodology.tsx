const GLOSSARY: [string, string][] = [
  ['Marketing mix model (MMM)', 'A model that explains revenue over time from spend per channel, carry-over, diminishing returns, trend, seasonality and other drivers such as promotions.'],
  ['Bayesian', 'A way of fitting models that starts from a belief (the prior), updates it with data, and returns a full range of plausible values (the posterior) instead of one number.'],
  ['Prior', 'What is assumed about a quantity before seeing your data. Kawkit’s defaults are deliberately weak; you can replace them with what you know, such as a lift-test result.'],
  ['Posterior', 'What the model believes after seeing your data. Every result on screen is a summary of the posterior.'],
  ['90% credible range', 'The range that contains the true value with 90% probability, given the model and the data. Wide ranges mean the data cannot say much.'],
  ['ROI', 'Revenue attributed to a channel divided by what was spent on it. Above 1 means the channel returned more revenue than it cost.'],
  ['Marginal ROI', 'The return on the next unit of spend at your current level. It falls as a channel saturates, and it is what matters for moving budget.'],
  ['Carry-over (adstock)', 'Advertising keeps working after the week it ran. The half-life is how many weeks it takes for half of that effect to play out.'],
  ['Saturation', 'Diminishing returns: each extra unit of spend on a channel adds less than the one before.'],
  ['Response curve', 'Expected weekly revenue from a channel at each level of steady weekly spend.'],
  ['R-hat', 'A convergence check comparing independent sampling chains. Values at or below 1.01 mean the chains agree.'],
  ['Effective sample size', 'How many independent draws the sampler’s output is worth. At least 400 is wanted for stable ranges.'],
  ['Divergence', 'A warning from the sampler that it struggled with part of the model. More than a handful makes results unreliable.'],
  ['MAPE', 'Mean absolute percentage error: the typical gap between modelled and actual revenue, as a percentage.'],
  ['Holdout', 'The last 13 weeks are hidden, the model is fitted again without them, and its predictions for those weeks are checked. This measures error on data the model has not seen.'],
]

export default function Methodology() {
  return (
    <div className="grid gap-5" style={{ maxWidth: '50rem' }}>
      <h1>How Kawkit works</h1>
      <section className="grid gap-2">
        <h2>The model</h2>
        <p>Weekly revenue is modelled as a baseline plus each channel’s contribution:</p>
        <p className="card num text-sm" style={{ overflowX: 'auto', whiteSpace: 'nowrap' }}>
          revenue<sub>t</sub> = baseline + trend + yearly seasonality + controls + Σ<sub>channels</sub> β<sub>c</sub> · S(A<sub>c,t</sub>; λ<sub>c</sub>) + noise
        </p>
        <ul className="list-disc pl-5 grid gap-1">
          <li><strong>Carry-over.</strong> A<sub>c,t</sub> is a weighted average of the channel’s spend over the current and previous 7 weeks, with weights α<sub>c</sub><sup>lag</sup> (geometric adstock, normalised).</li>
          <li><strong>Diminishing returns.</strong> S(A; λ) = (1 − e<sup>−λA</sup>) / (1 + e<sup>−λA</sup>) flattens as spend grows (logistic saturation).</li>
          <li><strong>Baseline.</strong> An intercept, a linear trend, two yearly sine and cosine pairs (only with 78 weeks or more), and any control columns you supply. The intercept, trend and seasonality together are not allowed to go below zero in any week, because sales without advertising cannot be negative. The model also expects this baseline to make up 50% to 90% of revenue, as it does for most businesses: it has no preference inside that range and resists going outside it, so only strong evidence in the data moves it out.</li>
        </ul>
        <p>These are the geometric adstock and logistic saturation transforms from PyMC-Marketing. The model is sampled with the NUTS sampler (nutpie): 4 chains of 1,000 draws after 1,000 warm-up steps, with a fixed seed per run so the same data and priors give the same answer.</p>
      </section>
      <section className="grid gap-2">
        <h2>Priors</h2>
        <div className="overflow-x-auto">
          <table className="data">
            <caption className="sr-only">Default priors and how your inputs change them</caption>
            <thead><tr><th scope="col">Quantity</th><th scope="col" style={{ textAlign: 'left' }}>Default</th><th scope="col" style={{ textAlign: 'left' }}>With your input</th></tr></thead>
            <tbody>
              <tr><th scope="row" style={{ fontWeight: 500 }}>Maximum effect β</th><td style={{ textAlign: 'left', whiteSpace: 'normal' }}>Half-normal, scaled to the channel’s share of total spend</td><td style={{ textAlign: 'left' }}>Unchanged</td></tr>
              <tr><th scope="row" style={{ fontWeight: 500 }}>Carry-over α</th><td style={{ textAlign: 'left', whiteSpace: 'normal' }}>Beta(1, 3): about a quarter of the effect carries into the next week</td><td style={{ textAlign: 'left', whiteSpace: 'normal' }}>“Lasts about N weeks” becomes a Beta centred where 10% of the effect is left after N weeks</td></tr>
              <tr><th scope="row" style={{ fontWeight: 500 }}>Saturation speed λ</th><td style={{ textAlign: 'left' }}>Gamma(3, 1)</td><td style={{ textAlign: 'left' }}>Unchanged</td></tr>
              <tr><th scope="row" style={{ fontWeight: 500 }}>Channel ROI</th><td style={{ textAlign: 'left' }}>None</td><td style={{ textAlign: 'left', whiteSpace: 'normal' }}>Your 90% range becomes a log-normal belief on the channel’s ROI (total contribution ÷ total spend)</td></tr>
            </tbody>
          </table>
        </div>
        <p>Before sampling, the service checks that your ROI ranges are possible for your data: if even their low ends imply more revenue than you had, the run stops with a clear message.</p>
      </section>
      <section className="grid gap-2">
        <h2>Checks before trusting a result</h2>
        <ul className="list-disc pl-5 grid gap-1">
          <li><strong>Convergence.</strong> Pass needs every R-hat at or below 1.01, effective sample size of 400 or more, and under 0.1% divergent draws. If a run fails this, its results are hidden behind a warning.</li>
          <li><strong>Fit.</strong> R² and typical error in sample, and typical error on the last 13 weeks when they are held out.</li>
          <li><strong>Prior vs posterior.</strong> For each channel, how much narrower the ROI range became: more than 50% narrower is “the data was decisive”, 20% to 50% “the data refined the belief”, less than 20% “this mostly reflects the prior”.</li>
        </ul>
      </section>
      <section className="grid gap-2">
        <h2>The budget optimiser</h2>
        <p>The optimiser finds the steady weekly spend per channel that maximises expected revenue, averaged over 500 posterior draws, within your budget and per-channel limits. It then scores the recommended and current splits under every draw, which gives the expected change with a 90% range and the probability that the new split beats the current one. It runs in your browser, so changes are instant.</p>
        <p>Spend above 1.2× the highest week in your data is flagged, because the model has never seen the channel at that level.</p>
      </section>
      <section className="grid gap-2">
        <h2>What the model cannot do</h2>
        <ul className="list-disc pl-5 grid gap-1">
          <li>If a channel’s spend barely changes, or always moves with the season, no model can separate its effect from the baseline. Kawkit warns before the run, and such channels usually show “this mostly reflects the prior”.</li>
          <li>If you spend more in weeks when you expect to sell more, the model can credit advertising with sales that would have happened anyway. The real-data example shows this.</li>
          <li>It only knows about the outside factors you give it. Events, promotions, price changes and shifts in the market that are missing from the file end up credited to the baseline trend or to advertising.</li>
          <li>It finds associations in historical data. Experiments (geo tests, lift tests) remain the best evidence; feed their results in as priors.</li>
          <li>It models one market and one KPI, with effects that do not change over time.</li>
        </ul>
      </section>
      <section className="grid gap-2">
        <h2>Glossary</h2>
        <dl className="grid gap-2">
          {GLOSSARY.map(([term, def]) => (
            <div key={term} className="card" style={{ padding: '0.7rem 1rem' }}>
              <dt className="font-semibold">{term}</dt>
              <dd className="muted">{def}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}
