import { useState } from 'react'
import { fmtCompact, niceTicks } from '../lib/format'

export interface IntervalRow {
  label: string
  median: number
  low: number
  high: number
  color: string
  /** drawn hollow with a dashed whisker, e.g. the second run in a comparison */
  hollow?: boolean
  detail?: string
}

interface Props {
  rows: IntervalRow[]
  ariaLabel: string
  fmt?: (v: number) => string
  /** reference line, e.g. ROI = 1 */
  reference?: { value: number; label: string }
  xLabel?: string
}

const W = 720
const ROW = 34

/** Horizontal dot-and-whisker chart: median with its 90% interval. Never a bare number. */
export function IntervalBars({ rows, ariaLabel, fmt = fmtCompact, reference, xLabel }: Props) {
  const [hover, setHover] = useState<number | null>(null)
  const labelW = Math.min(170, Math.max(70, ...rows.map((r) => r.label.length * 7.2)))
  const M = { top: 8, right: 86, bottom: 34, left: labelW + 8 }
  const height = M.top + M.bottom + rows.length * ROW
  let min = Math.min(0, ...rows.map((r) => r.low))
  let max = Math.max(...rows.map((r) => r.high), reference?.value ?? 0)
  const pad = (max - min) * 0.05 || 1
  max += pad
  if (min < 0) min -= pad
  const iw = W - M.left - M.right
  const sx = (v: number) => M.left + ((v - min) / (max - min)) * iw
  const ticks = niceTicks(min, max, 6)
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={ariaLabel} style={{ width: '100%', height: 'auto', display: 'block' }} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={sx(t)} x2={sx(t)} y1={M.top} y2={height - M.bottom} stroke="var(--grid)" />
            <text x={sx(t)} y={height - M.bottom + 15} textAnchor="middle" fontSize="11" fill="var(--muted)">{fmt(t)}</text>
          </g>
        ))}
        {xLabel && <text x={M.left + iw / 2} y={height - 3} textAnchor="middle" fontSize="11" fill="var(--muted)">{xLabel}</text>}
        {reference && (
          <g>
            <line x1={sx(reference.value)} x2={sx(reference.value)} y1={M.top} y2={height - M.bottom} stroke="var(--text)" strokeDasharray="4 3" />
            <text x={sx(reference.value) + 4} y={M.top + 9} fontSize="10.5" fill="var(--text)">{reference.label}</text>
          </g>
        )}
        {rows.map((r, i) => {
          const y = M.top + i * ROW + ROW / 2
          return (
            <g key={`${r.label}-${i}`} onMouseEnter={() => setHover(i)}>
              <rect x={0} y={y - ROW / 2} width={W} height={ROW} fill={hover === i ? 'var(--surface-2)' : 'transparent'} />
              <text x={M.left - 8} y={y + 4} textAnchor="end" fontSize="12" fill="var(--text)">{r.label}</text>
              <line x1={sx(r.low)} x2={sx(r.high)} y1={y} y2={y} stroke={r.color} strokeWidth={r.hollow ? 2.5 : 5} strokeLinecap="round" strokeDasharray={r.hollow ? '5 4' : undefined} opacity={r.hollow ? 1 : 0.45} />
              <line x1={sx(r.low)} x2={sx(r.low)} y1={y - 6} y2={y + 6} stroke={r.color} strokeWidth={2} />
              <line x1={sx(r.high)} x2={sx(r.high)} y1={y - 6} y2={y + 6} stroke={r.color} strokeWidth={2} />
              <circle cx={sx(r.median)} cy={y} r={5.5} fill={r.hollow ? 'var(--surface)' : r.color} stroke={r.color} strokeWidth={2} />
              <text x={W - M.right + 8} y={y + 4} fontSize="11.5" fill="var(--text)" className="num">{fmt(r.median)}</text>
            </g>
          )
        })}
      </svg>
      {hover !== null && (
        <div className="chart-tip num" style={{ right: 8, top: M.top + hover * ROW - 4 }}>
          <strong>{rows[hover].label}</strong>: {fmt(rows[hover].median)} <span className="muted">(90% range {fmt(rows[hover].low)} to {fmt(rows[hover].high)})</span>
          {rows[hover].detail && <div>{rows[hover].detail}</div>}
        </div>
      )}
    </div>
  )
}
