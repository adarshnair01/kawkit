export interface Entry {
  name: string
  short: string
  /** Neon answer to open for "Tell me more" */
  ask: string
}

/** Plain-words definitions for terms that appear on results pages. Keys are used by <Term k="…">. */
export const GLOSSARY: Record<string, Entry> = {
  roi: { name: 'ROI', short: 'Revenue back for each unit of spend. 2.0 means every £1 brought back £2 of revenue (not profit).', ask: 'what-is-roi' },
  mroi: { name: 'Marginal ROI', short: 'What the next unit of spend would bring back, not the average. It is usually lower than ROI, because returns diminish.', ask: 'roi-vs-mroi' },
  adstock: { name: 'Carry-over (adstock)', short: 'Advertising keeps working after the week it ran. Carry-over says how much of last week’s effect is still left.', ask: 'what-is-adstock' },
  halflife: { name: 'Half-life', short: 'How many weeks until half of an ad’s effect has faded.', ask: 'half-life' },
  saturation: { name: 'Diminishing returns', short: 'The first unit of spend works harder than the thousandth. Saturation is where extra spend barely adds anything.', ask: 'what-is-saturation' },
  baseline: { name: 'Baseline', short: 'Sales you’d get with no advertising: loyal customers, word of mouth, seasons, promotions and the wider market.', ask: 'what-is-baseline' },
  range: { name: '90% range', short: 'The model is 90% sure the true value lies inside this range. Narrow means the data was clear; wide means it wasn’t.', ask: 'what-is-credible-range' },
  rhat: { name: 'R-hat', short: 'A check that the model’s separate calculations agree. Close to 1.00 is good; above 1.01 means don’t trust it yet.', ask: 'convergence' },
  convergence: { name: 'Convergence', short: 'Whether the model’s calculation settled on a stable answer. Green means yes.', ask: 'convergence' },
  holdout: { name: 'Unseen weeks', short: 'The last 13 weeks are hidden while the model learns, then predicted. It’s the fairest test of whether to trust it.', ask: 'accuracy' },
  prior: { name: 'Prior', short: 'What the model believes before seeing your data. Defaults are cautious; you can add what you already know, like a geo-test result.', ask: 'what-is-bayesian' },
  posterior: { name: 'Posterior', short: 'What the model believes after seeing your data: the prior updated by the evidence.', ask: 'prior-vs-posterior' },
  mape: { name: 'MAPE / error', short: 'The typical size of the model’s miss each week, as a share of revenue. Lower is better; judge it against the simple forecast.', ask: 'accuracy' },
  r2: { name: 'R²', short: 'The share of weekly ups and downs in revenue the model explains. High is good, but it doesn’t prove the channel effects are right.', ask: 'r-squared' },
  incrementality: { name: 'Incrementality', short: 'Sales that happened because of the advertising, and wouldn’t have happened without it.', ask: 'what-is-incrementality' },
}
