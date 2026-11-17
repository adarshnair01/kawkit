/**
 * Neon's matcher: finds the prepared answer closest to what someone typed.
 *
 * Neon follows the approach of LiteBot (github.com/emiryuksel/LiteBot, MIT): a chat window that
 * answers from a local JSON file with no backend and no API. LiteBot matches with a chain of
 * `message.includes(word)` checks; with well over a hundred answers that misfires, so this scores
 * every entry instead: similarity to each way of asking the question, how much of the query the
 * entry covers, and keyword hits, with rarer words counting for more.
 */

export interface QaLink {
  label: string
  to: string
}
export interface QaEntry {
  id: string
  level: 'new' | 'using' | 'pro'
  category: string
  q: string
  alt: string[]
  keywords: string[]
  a: string
  links: QaLink[]
  related: string[]
}

// Only words with no meaning of their own are dropped. Common question words stay in: how rare a
// word is across the answers already decides how much it counts.
const STOP = new Set('a an the is are was were be been am to of in on at for by with and or it its this that as so s t re ve ll d m'.split(' '))

// several spellings and near-synonyms collapse to one token
const PHRASES: [RegExp, string][] = [
  [/r[\s-]?squared|r²|\br2\b/g, ' rsquared '],
  [/r[\s-]?hat|\brhat\b/g, ' rhat '],
  [/carry[\s-]?over|ad[\s-]?stock/g, ' carryover '],
  [/half[\s-]?life/g, ' halflife '],
  [/last[\s-]?click/g, ' lastclick '],
  [/black\s+friday/g, ' blackfriday '],
  [/google\s+sheets?/g, ' gsheet '],
  [/google\s+analytics|\bga4?\b/g, ' ganalytics '],
  [/sign[\s-]?(in|up)|log[\s-]?in|register/g, ' signin '],
  [/break[\s-]?even/g, ' breakeven '],
  [/what[\s-]?if/g, ' whatif '],
  [/\s*(percent|per cent)\b/g, '% '],
  [/(lift|geo|incrementality|hold[\s-]?out)[\s-]?(tests?|experiments?|stud(y|ies))/g, ' lifttest '],
  [/diminishing returns?/g, ' saturation '],
  [/marketing mix model(l?ing|s)?|media mix model(l?ing|s)?|\bmmm\b/g, ' mmm '],
  [/outside factors?|control variables?|\bcontrols?\b/g, ' control '],
  [/don'?t|do not|doesn'?t|does not|isn'?t|is not|can'?t|cannot|won'?t/g, ' not '],
]
const SYN: Record<string, string> = {
  roas: 'roi', return: 'roi', returns: 'roi',
  optimis: 'optim', optimiz: 'optim', optimiser: 'optim', optimizer: 'optim', optimise: 'optim', optimize: 'optim', optimisation: 'optim', optimization: 'optim', allocate: 'optim', allocation: 'optim', reallocate: 'optim',
  modelling: 'model', modeling: 'model', models: 'model',
  interval: 'range', intervals: 'range', ranges: 'range', band: 'range',
  uncertain: 'uncertainty', unsure: 'uncertainty',
  budget: 'budget', budgets: 'budget', spend: 'spend', spending: 'spend', spent: 'spend', cost: 'spend', costs: 'spend',
  revenue: 'revenue', sales: 'revenue', turnover: 'revenue',
  upload: 'upload', uploading: 'upload', load: 'upload', import: 'import', importing: 'import',
  file: 'file', csv: 'file', spreadsheet: 'file',
  delete: 'delete', remove: 'delete', erase: 'delete',
  accuracy: 'accurate', error: 'error', errors: 'error', miss: 'error',
  results: 'result', output: 'result', outputs: 'result',
  channels: 'channel', media: 'channel',
  ads: 'advertising', ad: 'advertising', adverts: 'advertising', advertisement: 'advertising',
  experiment: 'lifttest', experiments: 'lifttest', test: 'test', tests: 'test', testing: 'test',
  suggested: 'recommend', suggest: 'recommend', recommended: 'recommend', recommendation: 'recommend', recommends: 'recommend',
  look: 'see', view: 'see', access: 'see', seen: 'see',
  // everyday words people use in place of the ones the answers are written in
  charge: 'price', charges: 'price', fee: 'price', fees: 'price', pricing: 'price', prices: 'price', pay: 'price', paid: 'price', payment: 'price',
  rival: 'competitor', rivals: 'competitor',
  fix: 'lock', fixed: 'lock', freeze: 'lock', pin: 'lock', locked: 'lock',
  iphone: 'phone', android: 'phone', ipad: 'phone', smartphone: 'phone', mobile: 'phone', cell: 'phone', tablet: 'phone',
  identical: 'same', duplicate: 'same', twice: 'same',
  relaunch: 'relaunch', relaunched: 'relaunch', rebrand: 'relaunch', rebranded: 'relaunch',
  launched: 'launch', launching: 'launch', started: 'launch', began: 'launch', introduced: 'launch',
  tiny: 'small', little: 'small', large: 'big', huge: 'big', massive: 'big',
  figures: 'data', numbers: 'data', dataset: 'data',
  hold: 'keep', kept: 'keep', retain: 'keep', retained: 'keep', retention: 'keep', store: 'keep', stored: 'keep', storing: 'keep',
  mistaken: 'wrong', incorrect: 'wrong', inaccurate: 'wrong',
  separate: 'split', separately: 'split', apart: 'split', together: 'combine', merge: 'combine', merged: 'combine', combined: 'combine',
  broken: 'broken', bug: 'broken', bugs: 'broken', crash: 'broken', crashed: 'broken',
  boss: 'manager', colleague: 'manager', team: 'manager', client: 'manager',
  history: 'week', enough: 'enough', sufficient: 'enough',
  begin: 'start', beginning: 'start', starting: 'start',
  need: 'need', require: 'need', required: 'need', must: 'need',
  priors: 'prior', belief: 'prior', beliefs: 'prior', assumption: 'prior', assumptions: 'prior',
  seasonal: 'seasonality', season: 'seasonality',
  weeks: 'week', weekly: 'week', days: 'day', daily: 'day', months: 'month', monthly: 'month', years: 'year', yearly: 'year',
  holidays: 'holiday', christmas: 'holiday', xmas: 'holiday', easter: 'holiday', events: 'event',
  macro: 'economy', macroeconomic: 'economy', economic: 'economy', economics: 'economy',
  competitors: 'competitor', competition: 'competitor',
  queued: 'queue', waiting: 'queue', stuck: 'queue',
  private: 'privacy', secure: 'privacy', security: 'privacy', safe: 'privacy', confidential: 'privacy',
  share: 'share', sharing: 'share', pdf: 'report', print: 'report',
  facebook: 'meta', instagram: 'meta', fb: 'meta', adwords: 'google',
  incremental: 'incrementality', causal: 'incrementality',
  saturated: 'saturation', plateau: 'saturation',
  converge: 'converg', converged: 'converg', convergence: 'converg',
  correlated: 'collinear', collinearity: 'collinear', multicollinearity: 'collinear',
  hi: 'hello', hey: 'hello', hiya: 'hello', thanks: 'thank', cheers: 'thank', bye: 'goodbye',
}

function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ies')) return `${w.slice(0, -3)}y`
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3)
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2)
  if (w.length > 4 && w.endsWith('es') && !w.endsWith('ses')) return w.slice(0, -1)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

export function tokens(text: string): string[] {
  let s = ` ${text.toLowerCase()} `
  for (const [re, to] of PHRASES) s = s.replace(re, to)
  const out: string[] = []
  for (const raw of s.replace(/[^a-z0-9%]+/g, ' ').split(' ')) {
    if (!raw || STOP.has(raw)) continue
    const w = SYN[raw] ?? SYN[stem(raw)] ?? stem(raw)
    if (w && !STOP.has(w)) out.push(w)
  }
  return out
}

interface Indexed {
  entry: QaEntry
  variants: Set<string>[]
  bag: Set<string>
  keywords: Set<string>[]
  /** words in the answer itself: people often ask using the words an answer is written in */
  body: Set<string>
}

export interface Match {
  entry: QaEntry
  score: number
}

export class Matcher {
  private items: Indexed[]
  private idf = new Map<string, number>()
  private byId = new Map<string, QaEntry>()

  constructor(entries: QaEntry[]) {
    this.items = entries.map((entry) => {
      const variants = [entry.q, ...entry.alt].map((v) => new Set(tokens(v)))
      // several keywords can reduce to the same words ("control", "controls"): count each once
      const seen = new Set<string>()
      const keywords = entry.keywords
        .map((k) => new Set(tokens(k)))
        .filter((k) => {
          const key = [...k].sort().join(' ')
          if (!k.size || seen.has(key)) return false
          seen.add(key)
          return true
        })
      const bag = new Set<string>()
      for (const v of [...variants, ...keywords]) for (const t of v) bag.add(t)
      const body = new Set(tokens(`${entry.a} ${entry.category}`))
      this.byId.set(entry.id, entry)
      return { entry, variants, bag, keywords, body }
    })
    const df = new Map<string, number>()
    for (const it of this.items) for (const t of new Set([...it.bag, ...it.body])) df.set(t, (df.get(t) ?? 0) + 1)
    const n = this.items.length
    for (const [t, d] of df) this.idf.set(t, Math.log((n + 1) / (d + 1)) + 1)
  }

  get(id: string): QaEntry | undefined {
    return this.byId.get(id)
  }

  private w(t: string): number {
    return this.idf.get(t) ?? 0 // a word no answer contains carries no signal
  }

  private mass(set: Iterable<string>): number {
    let s = 0
    for (const t of set) s += this.w(t) ** 2
    return s
  }

  /** Entries ranked for a query, best first. */
  rank(query: string): Match[] {
    // bare numbers ("22 channels", "8 months") carry no meaning of their own here
    const q = new Set(tokens(query).filter((t) => !/^\d+%?$/.test(t)))
    const known = [...q].filter((t) => this.idf.has(t))
    if (!known.length) return []
    const qMass = this.mass(known)
    // words the answers do not contain dilute the match: "roi of my cat" is less sure than "roi"
    const dilution = (known.length / q.size) ** 0.75
    const out: Match[] = []
    for (const it of this.items) {
      let best = 0
      for (const v of it.variants) {
        let dot = 0
        for (const t of known) if (v.has(t)) dot += this.w(t) ** 2
        if (!dot) continue
        const cos = dot / Math.sqrt(qMass * this.mass(v))
        if (cos > best) best = cos
      }
      let covered = 0
      for (const t of known) if (it.bag.has(t)) covered += this.w(t) ** 2
      const coverage = covered / qMass
      let kw = 0
      for (const k of it.keywords) {
        let all = true
        for (const t of k) if (!q.has(t)) all = false
        if (all) kw += this.mass(k)
      }
      const keyword = Math.min(1, kw / qMass)
      let inBody = 0
      for (const t of known) if (it.body.has(t)) inBody += this.w(t) ** 2
      const body = inBody / qMass
      // a query that is, word for word, one of the ways the question is written wins outright
      const exact = best > 0.999 ? 0.3 : 0
      const score = (0.45 * best + 0.15 * coverage + 0.15 * keyword + 0.25 * body + exact) * dilution
      if (score > 0) out.push({ entry: it.entry, score })
    }
    return out.sort((a, b) => b.score - a.score)
  }
}

/** Above this, Neon answers outright. Between the two, it offers its closest guesses. */
export const CONFIDENT = 0.42
export const POSSIBLE = 0.24

export type Reply = { kind: 'answer'; entry: QaEntry; alternatives: QaEntry[] } | { kind: 'unsure'; guesses: QaEntry[] } | { kind: 'none' }

export function reply(matcher: Matcher, query: string): Reply {
  const ranked = matcher.rank(query)
  const top = ranked[0]
  if (!top || top.score < POSSIBLE) return { kind: 'none' }
  if (top.score >= CONFIDENT) return { kind: 'answer', entry: top.entry, alternatives: ranked.slice(1, 3).filter((m) => m.score >= top.score * 0.75).map((m) => m.entry) }
  return { kind: 'unsure', guesses: ranked.slice(0, 3).filter((m) => m.score >= POSSIBLE).map((m) => m.entry) }
}
