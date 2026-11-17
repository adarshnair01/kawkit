import { describe, expect, it } from 'vitest'
import qa from './qa.json'
import { CONFIDENT, Matcher, reply, tokens, type QaEntry } from './match'

const entries = qa.entries as QaEntry[]
const m = new Matcher(entries)
const top = (q: string, n = 1) => m.rank(q).slice(0, n).map((r) => r.entry.id)

// Questions worded differently from anything in the file, with the answer each should reach.
const HELD_OUT: [string, string][] = [
  ['so what is this thing actually for', 'what-is-kawkit'],
  ['never heard of mmm, can you explain', 'what-is-mmm'],
  ['i am not technical, will i manage', 'who-is-it-for'],
  ['does it cost anything', 'is-it-free'],
  ['how is this better than my GA last click report', 'mmm-vs-attribution'],
  ['why cant you just tell me one figure for roi', 'why-ranges'],
  ['what do i have to prepare before uploading', 'what-data-needed'],
  ['is 40 weeks of history ok', 'how-many-weeks'],
  ['my export is one row per day', 'daily-vs-weekly'],
  ['my spreadsheet headers are not the same as yours', 'column-mapper'],
  ['dates in my sheet are like 31/12/2023', 'date-formats'],
  ['i want to explain number of orders not money', 'revenue-or-other-kpi'],
  ['we do a lot of email marketing which is free, how to include it', 'zero-cost-channels'],
  ['we had a stock out in march that killed sales', 'outliers'],
  ['we run discounts quite often', 'promotions-pricing'],
  ['who else can look at the file i upload', 'is-data-private'],
  ['how do i wipe everything', 'delete-data'],
  ['can i pull the numbers straight from a google sheet', 'import-from-link'],
  ['do you integrate with snowflake', 'connectors-available'],
  ['how do i tell the model about black friday', 'events-library'],
  ['can i add unemployment rate', 'economy-connector'],
  ['should i throw in every economic indicator', 'macro-helps'],
  ['is it ok to add website sessions as a control', 'mediator-warning'],
  ['i have no idea what to type in the roi boxes', 'should-i-add-priors'],
  ['we did a geo experiment on tv, where do i put the result', 'roi-prior-how'],
  ['how would i design an incrementality experiment', 'how-to-lift-test'],
  ['how many minutes until i get results', 'how-long-run'],
  ['do i have to stay on the page while it runs', 'close-tab'],
  ['my run has been sitting in the queue for ages', 'server-offline'],
  ['the run errored out', 'run-failed'],
  ['i got my results, how do i make sense of them', 'read-results-first'],
  ['is roi the same thing as roas', 'what-is-roi'],
  ['which matters for moving money, average or marginal return', 'roi-vs-mroi'],
  ['why is the bar for display so long', 'roi-range-wide'],
  ['what is r hat', 'convergence'],
  ['it says results are hidden because it did not converge', 'did-not-converge'],
  ['is a 20 percent error acceptable', 'accuracy'],
  ['how do i bring the error down', 'reduce-error'],
  ['what would i sell if i stopped all advertising', 'what-is-baseline'],
  ['the tool thinks 85% of my sales come from ads, surely wrong', 'media-share-too-high'],
  ['what do the dashed and solid curves show', 'prior-vs-posterior'],
  ['do ads keep having an effect in later weeks', 'what-is-adstock'],
  ['why does spending more give less and less', 'what-is-saturation'],
  ['meta ads manager shows a much higher roas than you', 'platform-roas-differs'],
  ['we have a 30% margin, what roi do i need', 'profit-vs-revenue'],
  ['how does it come up with the suggested split', 'optimiser-how'],
  ['what does 94% likely better mean', 'prob-better'],
  ['tv is on a contract so i cant reduce it', 'optimiser-limits'],
  ['what happens if i halve search spend', 'scenario-planner'],
  ['i need 50k more revenue a week, what should i spend', 'target-mode'],
  ['which channel deserves an experiment', 'what-to-test-next'],
  ['should i just do what it recommends', 'how-to-act'],
  ['display roi is under 1, do i kill it', 'cut-channel'],
  ['how frequently should i refresh this', 'rerun-new-data'],
  ['facebook and instagram budgets always go up and down together', 'collinearity'],
  ['our budget is set as a percentage of forecast sales', 'endogeneity'],
  ['is brand keyword search really that good', 'branded-search'],
  ['does tv help my search ads', 'halo-effects'],
  ['does this capture brand building over years', 'long-term-effects'],
  ['is this like meta robyn', 'vs-other-tools'],
  ['how can i send this to my manager', 'share-link'],
  ['can i get this into excel', 'download-results'],
  ['i need a pdf for a deck', 'print-report'],
  ['are you a real person', 'neon-who'],
]

// A second set, written after the matcher was tuned on the first and never used to adjust it.
const UNSEEN: [string, string][] = [
  ['can you give me the basics of what you do here', 'what-is-kawkit'],
  ['is there a charge for this', 'is-it-free'],
  ['can i play with it before registering', 'need-account'],
  ['what makes a bayesian approach better', 'what-is-bayesian'],
  ['which columns must my csv have', 'what-data-needed'],
  ['i only have 8 months of numbers', 'how-many-weeks'],
  ['we have 22 different channels', 'limits'],
  ['my tv spend is identical every single week', 'warn-flat'],
  ['there are a few weeks missing in the middle', 'date-gaps'],
  ['should instagram and facebook be separate or together', 'group-channels'],
  ['how long do you hold on to my files', 'data-retention'],
  ['the sheet link gives an error', 'link-import-fails'],
  ['we always have a big sale on singles day', 'other-events'],
  ['does the interest rate matter for my model', 'economy-connector'],
  ['a rival brand launched a huge campaign last year', 'competitors'],
  ['is it worth adding temperature', 'weather'],
  ['what is a prior in plain english', 'what-is-prior'],
  ['how many weeks does a tv ad keep working', 'carryover-prior'],
  ['it tells me my roi ranges cannot be true', 'priors-impossible'],
  ['what if the belief i entered turns out to be mistaken', 'wrong-prior'],
  ['how do i stop a model that is running', 'cancel-run'],
  ['why can i not submit a fourth run', 'run-limits'],
  ['upload says negative spend in row 14', 'validation-errors'],
  ['what does the green converged box tell me', 'convergence'],
  ['what does the chance above 1 number tell me', 'p-above-1'],
  ['what is the dashed line on the fit chart', 'what-is-baseline'],
  ['what share of sales is normally baseline', 'baseline-share'],
  ['one of my controls has an effect below zero', 'negative-driver'],
  ['it says the result mostly reflects the prior', 'mostly-reflects-prior'],
  ['how many weeks until half the effect is gone', 'half-life'],
  ['how do i read the curve for each channel', 'response-curves'],
  ['what does incremental actually mean', 'what-is-incrementality'],
  ['it flagged spend beyond my data', 'extrapolation'],
  ['how big is the gain from the new split', 'expected-lift'],
  ['we doubled in size after a relaunch', 'trend-changes'],
  ['we launched tiktok two months ago', 'new-channel'],
  ['did performance change after the ios update', 'time-varying'],
  ['we only sell about 30 orders a week', 'small-budget'],
  ['will two identical uploads give identical numbers', 'reproducible'],
  ['how do i put two runs next to each other', 'compare-runs'],
  ['can i use it on my iphone', 'mobile'],
  ['something looks broken, who do i tell', 'contact'],
]

// A third set, written last and measured once before anything else changed: 31 of 40 right first
// time, 35 of 40 in the top three. That is the honest figure for this matcher.
const FINAL: [string, string][] = [
  ['in one sentence, what is kawkit', 'what-is-kawkit'],
  ['how do i begin using it', 'how-to-start'],
  ['is the example made from real companies', 'sample-explained'],
  ['how is mmm different to multi touch attribution', 'mmm-vs-attribution'],
  ['can i give it conversions rather than revenue', 'revenue-or-other-kpi'],
  ['can i feed in impressions', 'spend-or-impressions'],
  ['our seo traffic is free, do i include it', 'zero-cost-channels'],
  ['is it a problem that i spend the most in december every year', 'warn-seasonal'],
  ['one channel only ran for three weeks', 'warn-sparse'],
  ['do the spend and revenue have to be in the same currency', 'currency'],
  ['can i run the uk and germany in a single model', 'multi-market'],
  ['should i look at first time buyers only', 'new-vs-returning'],
  ['how do i erase my account', 'delete-data'],
  ['can i connect my bigquery', 'connectors-available'],
  ['what is a control variable', 'outside-factors'],
  ['is there a limit to how many controls i add', 'how-many-controls'],
  ['why was inflation skipped', 'economy-left-out'],
  ['are the priors mandatory', 'should-i-add-priors'],
  ['what does the model assume if i enter nothing', 'default-priors'],
  ['can i change my assumptions and fit again', 'rerun-priors'],
  ['what does it mean when a run is queued', 'run-status'],
  ['how do i make an account', 'how-sign-in'],
  ['what is the summary box above my results', 'in-short-box'],
  ['what is the meaning of the 90 percent interval', 'what-is-credible-range'],
  ['what does low confidence on a channel mean', 'confidence-label'],
  ['what is the naive benchmark', 'simple-forecast'],
  ['is a high r squared enough', 'r-squared'],
  ['does a small error prove the attribution is correct', 'low-error-not-proof'],
  ['what is the chart about other things that move sales', 'baseline-drivers'],
  ['what does data was decisive mean', 'verdicts'],
  ['how much revenue did each channel generate', 'contribution'],
  ['how do i fix a channel at its current spend', 'optimiser-limits'],
  ['it says my budget is under the minimums', 'impossible-budget'],
  ['can i model what happens if i raise the budget', 'scenario-planner'],
  ['how often do i need to rebuild the model', 'rerun-new-data'],
  ['what are the technical details of the model', 'model-spec'],
  ['how does it deal with yearly patterns', 'seasonality'],
  ['is my company big enough to benefit', 'small-budget'],
  ['can i rename a model run', 'rename-run'],
  ['what topics can you help with', 'neon-topics'],
]

describe('Neon matcher', () => {
  it('normalises spellings and synonyms', () => {
    expect(tokens('What is the ROAS?')).toEqual(['what', 'roi'])
    expect(tokens('carry-over and ad stock')).toEqual(['carryover', 'carryover'])
    expect(new Set(tokens('R² vs r-squared vs R2')).size).toBe(2)
    expect(tokens('Optimising budgets')).toEqual(tokens('optimizer budget'))
    expect(tokens('marketing mix modelling')).toEqual(tokens('MMM'))
  })

  it('every answer is found by its own question and by each alternative wording', () => {
    const misses: string[] = []
    let total = 0
    for (const e of entries)
      for (const v of [e.q, ...e.alt]) {
        total++
        if (top(v)[0] !== e.id) misses.push(`${v} -> ${top(v)[0]} (wanted ${e.id})`)
        expect(top(v, 3), v).toContain(e.id)
      }
    expect(misses.length / total, misses.join('\n')).toBeLessThan(0.03)
  })

  it('answers questions worded differently from the file', () => {
    const wrong1: string[] = []
    const wrong3: string[] = []
    for (const [q, id] of HELD_OUT) {
      if (top(q)[0] !== id) wrong1.push(`${q} -> ${top(q)[0]} (wanted ${id})`)
      if (!top(q, 3).includes(id)) wrong3.push(`${q} -> ${top(q, 3).join(', ')} (wanted ${id})`)
    }
    console.log(`held-out: top-1 ${HELD_OUT.length - wrong1.length}/${HELD_OUT.length}, top-3 ${HELD_OUT.length - wrong3.length}/${HELD_OUT.length}\n${wrong1.join('\n')}`)
    expect(wrong1.length / HELD_OUT.length, wrong1.join('\n')).toBeLessThanOrEqual(0.2)
    expect(wrong3.length / HELD_OUT.length, wrong3.join('\n')).toBeLessThanOrEqual(0.08)
  })

  it('holds up on questions it was never tuned on', () => {
    const wrong1 = UNSEEN.filter(([q, id]) => top(q)[0] !== id).map(([q, id]) => `${q} -> ${top(q)[0]} (wanted ${id})`)
    const wrong3 = UNSEEN.filter(([q, id]) => !top(q, 3).includes(id)).map(([q, id]) => `${q} -> ${top(q, 3).join(', ')} (wanted ${id})`)
    expect(wrong3.length / UNSEEN.length, wrong3.join('\n')).toBeLessThanOrEqual(0.15)
    expect(wrong1.length / UNSEEN.length, wrong1.join('\n')).toBeLessThanOrEqual(0.3)
  })

  it('final check on a set nothing was adjusted against', () => {
    const wrong1 = FINAL.filter(([q, id]) => top(q)[0] !== id).map(([q, id]) => `${q} -> ${top(q)[0]} (wanted ${id})`)
    const wrong3 = FINAL.filter(([q, id]) => !top(q, 3).includes(id)).map(([q, id]) => `${q} -> ${top(q, 3).join(', ')} (wanted ${id})`)
    expect(wrong3.length / FINAL.length, wrong3.join('\n')).toBeLessThanOrEqual(0.2)
    expect(wrong1.length / FINAL.length, wrong1.join('\n')).toBeLessThanOrEqual(0.3)
  })

  it('does not pretend to know things outside its answers', () => {
    for (const q of ['asdf qwerty', 'recipe for pancakes', 'who won the world cup', 'write me a poem about cats', '']) {
      const r = reply(m, q)
      expect(r.kind, q).not.toBe('answer')
    }
    expect(m.rank('recipe for pancakes')[0]?.score ?? 0).toBeLessThan(CONFIDENT)
  })

  it('answers small talk and offers related questions that exist', () => {
    expect(top('hi')[0]).toBe('hello')
    expect(top('thanks!')[0]).toBe('thanks')
    const ids = new Set(entries.map((e) => e.id))
    for (const e of entries) for (const r of e.related) expect(ids.has(r), `${e.id} -> ${r}`).toBe(true)
    for (const e of entries) for (const l of e.links) expect(l.to.startsWith('/')).toBe(true)
  })
})
