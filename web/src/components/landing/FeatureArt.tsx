/** One illustration per feature. Each animates when its section gets the class "in". All decorative. */
const ink = 'var(--text)'
const blue = 'var(--accent-ink)'
const soft = 'var(--accent-soft)'
const line = 'var(--border)'
const muted = 'var(--muted)'
const surface = 'var(--surface)'

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 460 320" className="feature-art" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="458" height="318" fill={surface} stroke={line} rx="6" />
      {children}
    </svg>
  )
}

/** Every channel as a range against break-even. */
export function RangesArt() {
  const rows = [
    { label: 78, a: 250, b: 380, m: 318, hi: true },
    { label: 56, a: 190, b: 300, m: 244, hi: false },
    { label: 92, a: 120, b: 215, m: 160, hi: false },
    { label: 64, a: 90, b: 330, m: 205, hi: false },
  ]
  return (
    <Frame>
      <g data-speed="0.015">
        <line x1="205" x2="205" y1="40" y2="262" stroke={ink} strokeDasharray="5 5" />
        <text x="211" y="52" fontSize="12" fill={muted}>break-even</text>
      </g>
      <g data-speed="0.03">
        {rows.map((r, i) => (
          <g key={i}>
            <rect x="30" y={84 + i * 48 - 5} width={r.label * 0.55} height="10" fill={line} rx="2" />
            <g className="grow" style={{ transformOrigin: `${r.m}px ${84 + i * 48}px`, transitionDelay: `${i * 0.12}s` }}>
              <line x1={r.a} x2={r.b} y1={84 + i * 48} y2={84 + i * 48} stroke={r.hi ? blue : muted} strokeOpacity="0.4" strokeWidth="9" strokeLinecap="round" />
              <line x1={r.a} x2={r.a} y1={84 + i * 48 - 10} y2={84 + i * 48 + 10} stroke={r.hi ? blue : muted} strokeWidth="2.5" />
              <line x1={r.b} x2={r.b} y1={84 + i * 48 - 10} y2={84 + i * 48 + 10} stroke={r.hi ? blue : muted} strokeWidth="2.5" />
            </g>
            <circle className="pop" cx={r.m} cy={84 + i * 48} r="9" fill={r.hi ? blue : muted} style={{ transitionDelay: `${0.35 + i * 0.12}s` }} />
          </g>
        ))}
      </g>
      <g data-speed="0.045">
        <rect x="286" y="262" width="150" height="34" fill={ink} rx="4" />
        <text x="361" y="284" fontSize="13" fontWeight="600" textAnchor="middle" fill={surface}>97% above 1.0</text>
      </g>
    </Frame>
  )
}

/** A wide belief before the data, a narrow one after. */
export function PriorArt() {
  return (
    <Frame>
      <line x1="30" x2="430" y1="236" y2="236" stroke={ink} strokeWidth="2" />
      <g data-speed="0.02">
        <path className="fade fade-early" d="M40 236 C 150 236, 160 96, 230 96 S 310 236, 420 236" fill="none" stroke="var(--c1)" strokeWidth="2.5" strokeDasharray="7 6" />
        <text x="62" y="120" fontSize="12.5" fill={muted}>what you believed</text>
      </g>
      <g data-speed="0.04">
        <path className="fade" d="M210 236 C 252 236, 258 46, 286 46 S 320 236, 362 236 Z" fill={soft} />
        <path className="draw draw-late" pathLength={1} d="M210 236 C 252 236, 258 46, 286 46 S 320 236, 362 236" fill="none" stroke={blue} strokeWidth="3.5" />
        <text x="322" y="66" fontSize="12.5" fontWeight="600" fill={ink}>after your data</text>
      </g>
      <g data-speed="0.03">
        <rect x="30" y="262" width="252" height="34" fill={soft} rx="4" />
        <text x="44" y="284" fontSize="13" fontWeight="600" fill={ink}>The data was decisive: 64% narrower</text>
      </g>
    </Frame>
  )
}

/** Current split, recommended split and the chance it is better. */
export function SplitArt() {
  const cur = [120, 96, 84, 60]
  const rec = [70, 150, 110, 30]
  const fills = [muted, blue, ink, line]
  const bar = (vals: number[], y: number, cls: string) => {
    let x = 30
    return vals.map((w, i) => {
      const el = <rect key={i} className={cls} x={x} y={y} width={w - 4} height="34" fill={fills[i]} rx="3" style={{ transformOrigin: `${x}px ${y}px`, transitionDelay: `${i * 0.1}s` }} />
      x += w
      return el
    })
  }
  return (
    <Frame>
      <g data-speed="0.02">
        <text x="30" y="52" fontSize="12.5" fill={muted}>current split</text>
        {bar(cur, 62, 'wipe')}
        <text x="30" y="136" fontSize="12.5" fontWeight="600" fill={ink}>recommended split</text>
        {bar(rec, 146, 'wipe wipe-late')}
      </g>
      <g data-speed="0.04">
        <path d="M250 290 A 78 78 0 0 1 406 290" fill="none" stroke={line} strokeWidth="14" strokeLinecap="round" />
        <path className="draw draw-late" pathLength={1} d="M250 290 A 78 78 0 0 1 400 262" fill="none" stroke={blue} strokeWidth="14" strokeLinecap="round" />
        <text x="328" y="282" fontSize="34" fontWeight="700" textAnchor="middle" fill={ink} fontFamily="'Space Grotesk', Inter, sans-serif">94%</text>
      </g>
      <g data-speed="0.03">
        <text x="30" y="232" fontSize="13" fill={muted}>chance the new split</text>
        <text x="30" y="250" fontSize="13" fill={muted}>beats the current one</text>
        <text x="30" y="286" fontSize="15" fontWeight="700" fill={ink}>+8.1k a week</text>
      </g>
    </Frame>
  )
}

/** Weeks hidden from the model, predicted, then compared. */
export function TrustArt() {
  const actual = 'M30 190 L62 176 L94 196 L126 160 L158 172 L190 140 L222 156 L254 132 L286 150 L318 112 L350 128 L382 96 L414 118 L436 104'
  return (
    <Frame>
      <g data-speed="0.015">
        <rect x="286" y="34" width="152" height="216" fill={soft} rx="4" />
        <text x="362" y="54" fontSize="12" fontWeight="600" textAnchor="middle" fill={ink}>hidden from the model</text>
      </g>
      <g data-speed="0.035">
        <path className="fade" d="M286 172 L318 142 L350 150 L382 124 L414 138 L436 126 L436 82 L414 92 L382 76 L350 104 L318 92 L286 128 Z" fill={blue} fillOpacity="0.22" />
        <path className="draw draw-late" pathLength={1} d="M286 150 L318 118 L350 126 L382 100 L414 114 L436 104" fill="none" stroke={blue} strokeWidth="3" />
        <path className="draw" pathLength={1} d={actual} fill="none" stroke={ink} strokeWidth="2" />
        <path d="M286 164 L436 164" stroke={muted} strokeWidth="1.5" strokeDasharray="5 5" />
        <text x="292" y="180" fontSize="11" fill={muted}>simple forecast</text>
      </g>
      <g data-speed="0.05">
        <rect x="30" y="266" width="184" height="32" fill={ink} rx="4" />
        <text x="122" y="287" fontSize="13" fontWeight="600" textAnchor="middle" fill={surface}>Quarter total off by 0.3%</text>
        <text x="228" y="287" fontSize="12.5" fill={muted}>simple forecast: 17.8%</text>
      </g>
    </Frame>
  )
}

/** A spike the baseline explains, so advertising is not credited with it. */
export function DriversArt() {
  return (
    <Frame>
      <g data-speed="0.015">
        <path className="fade" d="M30 250 L30 206 C 90 196, 130 214, 190 202 S 280 190, 300 196 L312 96 L326 200 C 360 196, 400 206, 436 198 L436 250 Z" fill={soft} />
        <path d="M30 250 L436 250" stroke={ink} strokeWidth="2" />
      </g>
      <g data-speed="0.035">
        <path className="draw" pathLength={1} d="M30 176 C 90 150, 130 178, 190 158 S 280 150, 300 150 L312 56 L326 152 C 360 150, 400 160, 436 142" fill="none" stroke={ink} strokeWidth="2.5" />
      </g>
      <g data-speed="0.055">
        <g className="pop" style={{ transformOrigin: '312px 56px' }}>
          <circle cx="312" cy="56" r="7" fill={blue} />
          <rect x="196" y="34" width="100" height="26" fill={blue} rx="4" />
          <text x="246" y="52" fontSize="12.5" fontWeight="600" textAnchor="middle" fill="#fff">Black Friday</text>
        </g>
      </g>
      <g data-speed="0.03">
        <text x="40" y="238" fontSize="12" fill={ink} fontWeight="600">baseline: sales without advertising</text>
        {([['events', 30, 78], ['promotions', 116, 100], ['economy', 224, 88], ['search interest', 320, 110]] as const).map(([t, x, w], i) => (
          <g key={t} className="pop" style={{ transitionDelay: `${0.5 + i * 0.1}s`, transformOrigin: `${x + w / 2}px 283px` }}>
            <rect x={x} y="268" width={w} height="28" fill={surface} stroke={ink} rx="14" />
            <text x={x + w / 2} y="287" fontSize="11.5" textAnchor="middle" fill={ink}>{t}</text>
          </g>
        ))}
      </g>
    </Frame>
  )
}

/** Browser, queue, model server, results: the run keeps going after the tab closes. */
export function QueueArt() {
  const nodes = [
    { x: 30, label: 'your browser' },
    { x: 140, label: 'queue' },
    { x: 250, label: 'model server' },
    { x: 360, label: 'results' },
  ]
  return (
    <Frame>
      <g data-speed="0.02">
        <path className="flow" d="M100 130 H140 M210 130 H250 M320 130 H360" stroke={blue} strokeWidth="3" strokeDasharray="6 6" fill="none" />
      </g>
      <g data-speed="0.035">
        {nodes.map((n, i) => (
          <g key={n.label} className="pop" style={{ transitionDelay: `${i * 0.14}s`, transformOrigin: `${n.x + 35}px 130px` }}>
            <rect x={n.x} y="92" width="70" height="76" fill={i === 2 ? ink : surface} stroke={ink} strokeWidth="2" rx="6" />
            {i === 0 && <><rect x={n.x + 12} y="108" width="46" height="8" fill={line} rx="2" /><rect x={n.x + 12} y="124" width="30" height="8" fill={blue} rx="2" /><rect x={n.x + 12} y="140" width="38" height="8" fill={line} rx="2" /></>}
            {i === 1 && [0, 1, 2].map((k) => <rect key={k} x={n.x + 14} y={106 + k * 17} width="42" height="11" fill={k === 0 ? blue : line} rx="2" />)}
            {i === 2 && <path d={`M${n.x + 12} 150 C ${n.x + 26} 150, ${n.x + 26} 108, ${n.x + 35} 108 S ${n.x + 44} 150, ${n.x + 58} 150`} fill="none" stroke={surface} strokeWidth="2.5" />}
            {i === 3 && [0, 1, 2].map((k) => <g key={k}><line x1={n.x + 14 + k * 6} x2={n.x + 44 + k * 6} y1={112 + k * 17} y2={112 + k * 17} stroke={blue} strokeOpacity="0.4" strokeWidth="6" strokeLinecap="round" /><circle cx={n.x + 30 + k * 6} cy={112 + k * 17} r="4.5" fill={blue} /></g>)}
            <text x={n.x + 35} y="188" fontSize="12" textAnchor="middle" fill={ink}>{n.label}</text>
          </g>
        ))}
      </g>
      <g data-speed="0.05">
        <rect x="30" y="226" width="400" height="70" fill={soft} rx="6" />
        <path d="M54 250 v-6 a10 10 0 0 1 20 0 v6" fill="none" stroke={ink} strokeWidth="2.5" />
        <rect x="48" y="250" width="32" height="26" fill={ink} rx="4" />
        <text x="96" y="256" fontSize="13" fontWeight="600" fill={ink}>Only you can read your runs</text>
        <text x="96" y="278" fontSize="12.5" fill={muted}>Enforced in the database, not only in the app</text>
      </g>
    </Frame>
  )
}
