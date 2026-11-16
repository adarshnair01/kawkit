import type { ReactNode } from 'react'

const PANEL_W = 320
const PANEL_H = 300
const GAP = 56

interface Step {
  title: string
  lines: string[]
  art: ReactNode
}

const ink = 'var(--heading)'
const blue = 'var(--coral)'
const soft = 'var(--second-soft)'
const line = 'var(--border)'
const muted = 'var(--muted)'

/** Step 1: a small spreadsheet with a tick. */
const table = (
  <g>
    <rect x="40" y="14" width="200" height="132" fill="var(--surface)" stroke={ink} strokeWidth="2" rx="4" />
    <rect x="40" y="14" width="200" height="26" fill={ink} rx="4" />
    {['date', 'revenue', 'spend'].map((h, i) => (
      <text key={h} x={52 + i * 66} y="32" fontSize="11" fontWeight="600" fill="var(--surface)">{h}</text>
    ))}
    {[0, 1, 2, 3].map((r) => (
      <g key={r}>
        <line x1="40" x2="240" y1={66 + r * 26} y2={66 + r * 26} stroke={line} />
        <rect x="52" y={48 + r * 26} width="44" height="8" fill={line} rx="2" />
        <rect x="118" y={48 + r * 26} width={[40, 34, 46, 30][r]} height="8" fill={muted} opacity="0.55" rx="2" />
        <rect x="184" y={48 + r * 26} width={[30, 42, 24, 38][r]} height="8" fill={blue} rx="2" />
      </g>
    ))}
    <line x1="106" x2="106" y1="40" y2="146" stroke={line} />
    <line x1="172" x2="172" y1="40" y2="146" stroke={line} />
    <circle cx="246" cy="140" r="20" fill={blue} stroke="var(--bg)" strokeWidth="4" />
    <path d="M237 140l6 7 12-14" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
  </g>
)

/** Step 2: a belief, drawn as a dashed curve over a range. */
const belief = (
  <g>
    <line x1="30" x2="290" y1="124" y2="124" stroke={ink} strokeWidth="2" />
    <path d="M40 124 C 100 124, 110 26, 160 26 S 220 124, 280 124" fill={soft} stroke={blue} strokeWidth="2.5" strokeDasharray="7 5" />
    <line x1="104" x2="216" y1="140" y2="140" stroke={ink} strokeWidth="2" />
    <line x1="104" x2="104" y1="133" y2="147" stroke={ink} strokeWidth="2" />
    <line x1="216" x2="216" y1="133" y2="147" stroke={ink} strokeWidth="2" />
    <text x="104" y="162" fontSize="12" fontWeight="600" textAnchor="middle" fill={ink}>0.8</text>
    <text x="216" y="162" fontSize="12" fontWeight="600" textAnchor="middle" fill={ink}>2.0</text>
    <text x="160" y="162" fontSize="11" textAnchor="middle" fill={muted}>your ROI range</text>
  </g>
)

/** Step 3: ranges per channel against break-even, and a split. */
const ranges = (
  <g>
    <line x1="150" x2="150" y1="10" y2="112" stroke={ink} strokeDasharray="4 4" />
    <text x="154" y="18" fontSize="10.5" fill={muted}>break-even</text>
    {[
      { y: 36, lo: 168, hi: 262, m: 214 },
      { y: 66, lo: 96, hi: 178, m: 134 },
      { y: 96, lo: 60, hi: 128, m: 92 },
    ].map((r, i) => (
      <g key={i}>
        <rect x="30" y={r.y - 4} width="22" height="8" fill={line} rx="2" />
        <line x1={r.lo} x2={r.hi} y1={r.y} y2={r.y} stroke={i === 0 ? blue : muted} strokeWidth="6" strokeLinecap="round" opacity="0.4" />
        <line x1={r.lo} x2={r.lo} y1={r.y - 7} y2={r.y + 7} stroke={i === 0 ? blue : muted} strokeWidth="2" />
        <line x1={r.hi} x2={r.hi} y1={r.y - 7} y2={r.y + 7} stroke={i === 0 ? blue : muted} strokeWidth="2" />
        <circle cx={r.m} cy={r.y} r="6.5" fill={i === 0 ? blue : muted} />
      </g>
    ))}
    <rect x="30" y="132" width="260" height="18" fill={line} rx="3" />
    <rect x="30" y="132" width="150" height="18" fill={blue} rx="3" />
    <rect x="182" y="132" width="62" height="18" fill={ink} rx="3" />
    <text x="30" y="166" fontSize="11" fill={muted}>recommended split</text>
    <text x="290" y="166" fontSize="11" fontWeight="600" textAnchor="end" fill={ink}>94% likely better</text>
  </g>
)

const STEPS: Step[] = [
  { title: 'Upload a CSV', lines: ['One row per week: a date, revenue and one', 'spend column per channel. Problems are', 'shown at once, with row numbers.'], art: table },
  { title: 'Add what you know', lines: ['Optionally give an ROI range from a lift', 'test, or how long an effect lasts. Leave', 'it blank to let the data lead.'], art: belief },
  { title: 'Get ranges, not guesses', lines: ['Each channel’s return with a 90% range,', 'and a budget split with the probability', 'that it beats your current one.'], art: ranges },
]

function Diagram({ vertical }: { vertical: boolean }) {
  const w = vertical ? PANEL_W : PANEL_W * 3 + GAP * 2
  const h = vertical ? PANEL_H * 3 + GAP * 2 : PANEL_H
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label="How it works, in three steps. One: upload a CSV with one row per week, a date, revenue and one spend column per channel; problems are shown at once with row numbers. Two: add what you know, such as an ROI range from a lift test or how long an effect lasts, or leave it blank to let the data lead. Three: get ranges, not guesses: each channel's return with a 90% range, and a budget split with the probability that it beats your current one."
      style={{ width: '100%', maxWidth: vertical ? 380 : undefined, height: 'auto', display: 'block', margin: '0 auto' }}
    >
      {STEPS.map((s, i) => {
        const x = vertical ? 0 : i * (PANEL_W + GAP)
        const y = vertical ? i * (PANEL_H + GAP) : 0
        return (
          <g key={s.title} transform={`translate(${x} ${y})`}>
            <g transform="translate(-30 0)">{s.art}</g>
            <circle cx="16" cy="204" r="15" fill={ink} />
            <text x="16" y="209.5" fontSize="15" fontWeight="700" textAnchor="middle" fill="var(--bg)" fontFamily="'Space Grotesk', Inter, sans-serif">{i + 1}</text>
            <text x="42" y="210" fontSize="19" fontWeight="700" fill={ink} fontFamily="'Space Grotesk', Inter, sans-serif">{s.title}</text>
            {s.lines.map((l, k) => (
              <text key={k} x="0" y={244 + k * 21} fontSize="14.5" fill={muted}>{l}</text>
            ))}
            {i < 2 &&
              (vertical ? (
                <path d={`M${PANEL_W / 2} ${PANEL_H + 10} v${GAP - 26} m-7 -8 l7 9 l7 -9`} fill="none" stroke={ink} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              ) : (
                <path d={`M${PANEL_W + 8} 84 h${GAP - 18} m-8 -7 l9 7 l-9 7`} fill="none" stroke={ink} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              ))}
          </g>
        )
      })}
    </svg>
  )
}

/** The three steps as one illustration: side by side on wide screens, stacked on phones. */
export function HowItWorks() {
  return (
    <section aria-label="How it works" className="card">
      <div className="hidden md:block" style={{ padding: '0.75rem 0.5rem' }}><Diagram vertical={false} /></div>
      <div className="md:hidden" style={{ padding: '0.5rem 0' }}><Diagram vertical /></div>
    </section>
  )
}
