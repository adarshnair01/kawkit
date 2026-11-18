import { useEffect, useState } from 'react'
import { fmtPct } from '../lib/format'

const STAGES = [
  { upto: 0.05, label: 'Reading your data', playful: 'Tidying the spreadsheet…' },
  { upto: 0.75, label: 'Fitting the model', playful: 'Trying thousands of possible worlds and keeping the likely ones…' },
  { upto: 0.94, label: 'Testing on weeks it never saw', playful: 'Hiding the last 13 weeks and asking the model to guess them…' },
  { upto: 1.01, label: 'Writing it up', playful: 'Turning numbers into plain words…' },
]

export const TIPS = [
  'A wide range isn’t a failure. It’s the model being honest that the data can’t pin a channel down.',
  'ROI below 1 means each unit of spend brought back less than a unit of revenue. It doesn’t always mean switch it off: carry-over and brand effects matter.',
  'Ad platforms often claim the same sale. A marketing mix model only credits spend that moved sales when it moved.',
  'Weeks where you changed spend a lot teach the model the most. A flat budget year says very little.',
  'Carry-over (adstock) is why last week’s TV can still sell this week.',
  'Diminishing returns: the first pound on a channel works harder than the thousandth.',
  'The baseline is what you’d sell with no advertising: loyal customers, word of mouth, seasons.',
  'The test on unseen weeks is the fairest check. A model that only fits the past can look great and predict badly.',
  'Short on history? Add what you already know, such as a geo-test result, as a prior.',
  'Promotions and big events belong in the baseline, so ads aren’t credited for discount weeks.',
  'Re-run every quarter or two. Markets drift, and old results go stale.',
  'Changing one channel at a time, in a planned test, beats any model for proving cause.',
]

/** The waiting screen: named stages with ticks, elapsed time, and a rotating tip. */
export function RunProgress({ progress, startedAt, attempt }: { progress: number; startedAt: string | null; attempt: number }) {
  const [now, setNow] = useState(() => Date.now())
  const [tip, setTip] = useState(() => Math.floor(Math.random() * TIPS.length))
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    const r = setInterval(() => setTip((i) => (i + 1) % TIPS.length), 9000)
    return () => {
      clearInterval(t)
      clearInterval(r)
    }
  }, [])
  const current = Math.max(0, STAGES.findIndex((s) => progress < s.upto))
  const secs = startedAt ? Math.max(0, Math.round((now - new Date(startedAt).getTime()) / 1000)) : 0
  const mm = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
  return (
    <div className="grid gap-3">
      <div className="progress" role="progressbar" aria-label="Model fitting progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
        <div style={{ width: `${Math.max(2, progress * 100)}%` }} />
      </div>
      <p className="num text-sm">{fmtPct(progress)} · {mm} so far{attempt > 1 ? ` · attempt ${attempt} (the server was interrupted and retried)` : ''}</p>
      <ol className="stages" aria-label="Stages">
        {STAGES.map((s, i) => (
          <li key={s.label} className={i < current ? 'done' : i === current ? 'now' : ''} aria-current={i === current ? 'step' : undefined}>
            <span className="stage-dot" aria-hidden="true">{i < current ? '✓' : i + 1}</span>
            <span>
              <strong>{s.label}</strong>
              {i === current && <span className="muted text-sm block">{s.playful}</span>}
            </span>
          </li>
        ))}
      </ol>
      <aside className="tip" aria-label="Did you know">
        <p className="eyebrow">While you wait</p>
        <p key={tip} className="tip-text">{TIPS[tip]}</p>
      </aside>
    </div>
  )
}
