import { useId, useState } from 'react'
import { fmtCompact, niceTicks } from '../lib/format'

interface Props {
  labels: string[]
  groups: { label: string; values: number[]; color: string; hatch?: boolean }[]
  ariaLabel: string
  flags?: boolean[]
}

const W = 720
const H = 280
const M = { top: 12, right: 12, bottom: 44, left: 56 }

/** Grouped vertical bars (current vs recommended spend). The second group is hatched, not only recoloured. */
export function SpendBars({ labels, groups, ariaLabel, flags }: Props) {
  const [hover, setHover] = useState<number | null>(null)
  const hatchId = useId().replace(/:/g, '')
  const max = Math.max(...groups.flatMap((g) => g.values)) * 1.08 || 1
  const iw = W - M.left - M.right
  const ih = H - M.top - M.bottom
  const band = iw / labels.length
  const bw = Math.min(34, (band * 0.7) / groups.length)
  const sy = (v: number) => M.top + ih - (v / max) * ih
  const hatch = (
    <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="6" stroke="var(--surface)" strokeWidth="2.5" />
    </pattern>
  )
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} style={{ width: '100%', height: 'auto', display: 'block' }} onMouseLeave={() => setHover(null)}>
        <defs>{hatch}</defs>
        {niceTicks(0, max, 5).map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={sy(t)} y2={sy(t)} stroke="var(--grid)" />
            <text x={M.left - 6} y={sy(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{fmtCompact(t)}</text>
          </g>
        ))}
        {labels.map((l, i) => {
          const cx = M.left + band * (i + 0.5)
          return (
            <g key={l} onMouseEnter={() => setHover(i)}>
              <rect x={M.left + band * i} y={M.top} width={band} height={ih} fill={hover === i ? 'var(--surface-2)' : 'transparent'} />
              {groups.map((g, k) => {
                const x = cx - (groups.length * bw) / 2 + k * bw
                const h = M.top + ih - sy(g.values[i])
                return (
                  <g key={g.label}>
                    <rect x={x + 1} y={sy(g.values[i])} width={bw - 2} height={h} fill={g.color} />
                    {g.hatch && <rect x={x + 1} y={sy(g.values[i])} width={bw - 2} height={h} fill={`url(#${hatchId})`} />}
                  </g>
                )
              })}
              <text x={cx} y={H - M.bottom + 16} textAnchor="middle" fontSize="11.5" fill="var(--text)">{l.length > 12 ? `${l.slice(0, 11)}…` : l}</text>
              {flags?.[i] && <text x={cx} y={H - M.bottom + 31} textAnchor="middle" fontSize="10.5" fill="var(--warn)">⚠ beyond data</text>}
            </g>
          )
        })}
      </svg>
      {hover !== null && (
        <div className="chart-tip num" style={{ left: `${Math.min(Math.max(((M.left + band * (hover + 0.5)) / W) * 100, 15), 75)}%`, top: 4, transform: 'translateX(-40%)' }}>
          <strong>{labels[hover]}</strong>
          {groups.map((g) => (
            <div key={g.label}>{g.label}: {fmtCompact(g.values[hover])} a week</div>
          ))}
        </div>
      )}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs muted mt-1" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {groups.map((g) => (
          <li key={g.label} className="flex items-center gap-1.5">
            <svg width="14" height="12" aria-hidden="true">
              <defs>{hatch}</defs>
              <rect width="14" height="12" fill={g.color} />
              {g.hatch && <rect width="14" height="12" fill={`url(#${hatchId})`} />}
            </svg>
            {g.label}
          </li>
        ))}
      </ul>
    </div>
  )
}
