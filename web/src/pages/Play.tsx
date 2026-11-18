import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Draws } from '../api/types'
import { fmtCompact, fmtNum, fmtPct, title } from '../lib/format'
import { newRound, rating, scoreSplit } from '../lib/game'

const BRANDS: [string, string, string][] = [
  ['synthetic', 'Made-up data', 'draws'],
  ['home', 'Home decor brand', 'real-home-draws'],
  ['beauty', 'Skincare brand', 'real-beauty-draws'],
  ['apparel', 'Apparel brand', 'real-apparel-draws'],
  ['food', 'Food and drink brand', 'real-food-draws'],
  ['health', 'Dental care brand', 'real-health-draws'],
]
const BEST = 'kawkit-play-best'

function readBest(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(BEST) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}

export default function Play() {
  const [brand, setBrand] = useState(BRANDS[0])
  const [draws, setDraws] = useState<Draws | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [split, setSplit] = useState<number[]>([])
  const [locked, setLocked] = useState(false)
  const [best, setBest] = useState<Record<string, number>>(readBest)

  useEffect(() => {
    let off = false
    setDraws(null)
    setLocked(false)
    fetch(`${import.meta.env.BASE_URL}sample/${brand[2]}.json`)
      .then((r) => r.json())
      .then((d: Draws) => {
        if (off) return
        setDraws(d)
        setSplit(d.current.map((v) => Math.round(v)))
      })
      .catch(() => !off && setError('The game could not load. Refresh to try again.'))
    return () => {
      off = true
    }
  }, [brand])

  const round = useMemo(() => (draws ? newRound(draws) : null), [draws])
  const used = split.reduce((a, b) => a + b, 0)
  const left = round ? round.budget - used : 0
  const balanced = round ? Math.abs(left) <= round.budget * 0.01 : false
  const result = useMemo(() => (locked && draws && round ? scoreSplit(draws, round, split) : null), [locked, draws, round, split])

  const lockIn = () => {
    if (!draws || !round) return
    setLocked(true)
    const sc = scoreSplit(draws, round, split).share
    if (sc > (best[brand[0]] ?? 0)) {
      const next = { ...best, [brand[0]]: sc }
      setBest(next)
      try {
        localStorage.setItem(BEST, JSON.stringify(next))
      } catch {
        // the best score just won't be remembered
      }
    }
  }
  const setOne = (i: number, v: number) => setSplit((s) => s.map((x, j) => (j === i ? v : x)))

  if (error) return <div className="notice notice-bad" role="alert">{error}</div>
  return (
    <div className="grid gap-4">
      <div>
        <h1>Beat the model</h1>
        <p className="muted mt-1">Same total budget, different split. Can you place the money as well as a model that has studied the data? Each channel can go from half to one and a half times its current spend.</p>
      </div>
      <div className="card grid gap-2" role="group" aria-label="Choose a brand" style={{ padding: '0.8rem 1rem' }}>
        <span className="text-sm font-semibold">Pick a brand to play with</span>
        <div className="flex flex-wrap gap-2">
          {BRANDS.map((b) => (
            <button key={b[0]} type="button" className={`btn btn-small ${brand[0] === b[0] ? 'btn-primary' : ''}`} aria-pressed={brand[0] === b[0]} onClick={() => setBrand(b)}>
              {b[1]}{best[b[0]] !== undefined ? ` · best ${fmtPct(best[b[0]])}` : ''}
            </button>
          ))}
        </div>
      </div>
      {!draws || !round ? (
        <p className="muted" role="status">Dealing the cards…</p>
      ) : (
        <section className="card grid gap-3" aria-labelledby="game-h">
          <h2 id="game-h">Split {fmtNum(round.budget)} a week across {draws.channels.length} channels</h2>
          <div className={`game-bar ${balanced ? 'ok' : left < 0 ? 'over' : ''}`} role="status" aria-live="polite">
            {balanced ? 'Every unit placed. Ready to lock in.' : left > 0 ? `${fmtNum(left)} left to place` : `${fmtNum(-left)} over budget. Take some back.`}
          </div>
          <ul className="game-list">
            {draws.channels.map((c, i) => (
              <li key={c}>
                <label htmlFor={`g-${c}`}><strong>{title(c)}</strong> <span className="muted text-sm">(now {fmtCompact(draws.current[i])})</span></label>
                <input id={`g-${c}`} type="range" className="slider" min={Math.round(round.lower[i])} max={Math.round(round.upper[i])} step={Math.max(1, Math.round(draws.current[i] / 100))} value={split[i] ?? 0} disabled={locked} onChange={(e) => setOne(i, Number(e.target.value))} aria-valuetext={`${fmtCompact(split[i] ?? 0)} a week`} />
                <span className="num game-val">{fmtNum(split[i] ?? 0)}</span>
              </li>
            ))}
          </ul>
          {!locked ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-primary" disabled={!balanced} onClick={lockIn}>Lock it in</button>
              <button type="button" className="btn" onClick={() => setSplit(draws.current.map((v) => Math.round(v)))}>Reset to now</button>
            </div>
          ) : (
            result && (
              <div className="grid gap-3" aria-live="polite">
                <div className="game-result">
                  <p className="eyebrow">Your score</p>
                  <p className="game-score num">{fmtPct(result.share)}</p>
                  <p><strong>{rating(result.share)}.</strong> You captured {fmtPct(result.share)} of the gain the model found.</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="notice"><div className="text-sm muted">Your split: expected change in weekly revenue</div><div className="text-2xl font-bold num">{result.lift >= 0 ? '+' : '−'}{fmtCompact(Math.abs(result.lift))}</div><div className="text-sm num">90% range {fmtCompact(result.low)} to {fmtCompact(result.high)}</div></div>
                  <div className="notice"><div className="text-sm muted">The model’s split</div><div className="text-2xl font-bold num">+{fmtCompact(round.best)}</div><div className="text-sm num">Same total spend</div></div>
                </div>
                <div className="overflow-x-auto">
                  <table className="data num">
                    <caption className="sr-only">Your split against the model’s</caption>
                    <thead><tr><th scope="col">Channel</th><th scope="col">Now</th><th scope="col">You</th><th scope="col">Model</th></tr></thead>
                    <tbody>{draws.channels.map((c, i) => <tr key={c}><th scope="row" style={{ fontWeight: 500 }}>{title(c)}</th><td>{fmtNum(draws.current[i])}</td><td>{fmtNum(split[i])}</td><td>{fmtNum(round.best_split[i])}</td></tr>)}</tbody>
                  </table>
                </div>
                <p className="text-sm muted">The model’s answer is itself an estimate with a range, so beating it by a little doesn’t make it wrong. It just means the data can’t tell the two splits apart.</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-primary" onClick={() => { setLocked(false); setSplit(draws.current.map((v) => Math.round(v))) }}>Try again</button>
                  <Link to="/sample" className="btn">See how the model works it out</Link>
                  <Link to="/sign-in" className="btn">Do this with my own data</Link>
                </div>
              </div>
            )
          )}
        </section>
      )}
    </div>
  )
}
