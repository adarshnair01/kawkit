/** Layered hero illustration: a grid, three belief curves, ranges and drifting points. Decorative. */
export function HeroArt() {
  const curve = (cx: number, w: number, h: number) =>
    `M${cx - w} 420 C ${cx - w * 0.45} 420, ${cx - w * 0.4} ${420 - h}, ${cx} ${420 - h} S ${cx + w * 0.45} 420, ${cx + w} 420`
  return (
    <svg className="hero-art" viewBox="0 0 900 560" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="hero-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8ea2ff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#8ea2ff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="hero-fade2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.22" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* far layer: grid */}
      <g data-speed="0.06" data-drift="-8">
        {Array.from({ length: 13 }, (_, i) => (
          <line key={`v${i}`} x1={i * 75} x2={i * 75} y1="-40" y2="600" stroke="#ffffff" strokeOpacity="0.07" />
        ))}
        {Array.from({ length: 9 }, (_, i) => (
          <line key={`h${i}`} x1="-40" x2="940" y1={i * 75} y2={i * 75} stroke="#ffffff" strokeOpacity="0.07" />
        ))}
      </g>

      {/* middle layer: a wide prior behind a sharp posterior */}
      <g data-speed="0.14" data-drift="14">
        <path d={curve(520, 330, 190)} fill="url(#hero-fade2)" />
        <path className="hero-in" d={curve(520, 330, 190)} fill="none" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="2" strokeDasharray="8 7" />
      </g>
      <g data-speed="0.22" data-drift="26">
        <path d={curve(600, 150, 330)} fill="url(#hero-fade)" />
        <path className="draw draw-solid" pathLength={1} d={curve(600, 150, 330)} fill="none" stroke="#8ea2ff" strokeWidth="3.5" />
        <line x1="600" x2="600" y1="96" y2="420" stroke="#8ea2ff" strokeOpacity="0.5" strokeDasharray="3 6" />
      </g>

      {/* axis */}
      <g data-speed="0.1" data-drift="6">
        <line x1="150" x2="900" y1="420" y2="420" stroke="#ffffff" strokeOpacity="0.5" strokeWidth="1.5" />
        {[230, 340, 450, 560, 670, 780].map((x) => (
          <line key={x} x1={x} x2={x} y1="420" y2="430" stroke="#ffffff" strokeOpacity="0.5" />
        ))}
      </g>

      {/* near layer: ranges */}
      <g data-speed="0.32" data-drift="40">
        {[
          { y: 462, a: 500, b: 700, m: 606, c: '#8ea2ff' },
          { y: 492, a: 350, b: 560, m: 470, c: '#ffffff' },
          { y: 522, a: 610, b: 820, m: 700, c: '#ffffff' },
        ].map((r, i) => (
          <g key={i} className="grow" style={{ transformOrigin: `${r.m}px ${r.y}px`, animationDelay: `${0.9 + i * 0.15}s` }}>
            <line x1={r.a} x2={r.b} y1={r.y} y2={r.y} stroke={r.c} strokeOpacity={i ? 0.45 : 0.6} strokeWidth="7" strokeLinecap="round" />
            <circle cx={r.m} cy={r.y} r="8" fill={r.c} />
          </g>
        ))}
      </g>

      {/* nearest layer: drifting data points */}
      <g data-speed="0.5" data-drift="70">
        {[
          [210, 150, 5], [300, 260, 3.5], [770, 120, 6], [840, 300, 4], [430, 90, 4], [120, 330, 4.5], [700, 230, 3], [880, 470, 5],
        ].map(([x, y, r], i) => (
          <circle key={i} className="float" cx={x} cy={y} r={r} fill={i % 3 === 0 ? '#8ea2ff' : '#ffffff'} fillOpacity={i % 3 === 0 ? 0.95 : 0.5} style={{ animationDelay: `${i * -0.9}s` }} />
        ))}
      </g>
    </svg>
  )
}
