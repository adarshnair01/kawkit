import { useState } from 'react'
import { fmtRoi } from '../lib/format'
import { Legend } from './LineChart'

interface Props {
  grid: number[]
  prior: number[]
  posterior: number[]
  ariaLabel: string
  height?: number
}

const W = 360
const M = { top: 8, right: 10, bottom: 26, left: 10 }

/** Prior and posterior ROI on one log axis; the prior is dashed so colour is not the only signal. */
export function DensityChart({ grid, prior, posterior, ariaLabel, height = 150 }: Props) {
  const [hover, setHover] = useState<number | null>(null)
  const n = grid.length
  const lx = grid.map(Math.log)
  const iw = W - M.left - M.right
  const ih = height - M.top - M.bottom
  const sx = (i: number) => M.left + ((lx[i] - lx[0]) / (lx[n - 1] - lx[0])) * iw
  const sy = (v: number) => M.top + ih - v * ih * 0.96
  const line = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join('')
  const ticks = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50].filter((t) => t >= grid[0] && t <= grid[n - 1])
  const tx = (t: number) => M.left + ((Math.log(t) - lx[0]) / (lx[n - 1] - lx[0])) * iw
  return (
    <div style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-label={ariaLabel}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const px = ((e.clientX - r.left) / r.width) * W
          let best = 0
          for (let i = 1; i < n; i++) if (Math.abs(sx(i) - px) < Math.abs(sx(best) - px)) best = i
          setHover(best)
        }}
        onMouseLeave={() => setHover(null)}
      >
        <line x1={M.left} x2={W - M.right} y1={M.top + ih} y2={M.top + ih} stroke="var(--border)" />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={tx(t)} x2={tx(t)} y1={M.top + ih} y2={M.top + ih + 4} stroke="var(--muted)" />
            <text x={tx(t)} y={height - 8} textAnchor="middle" fontSize="10.5" fill="var(--muted)">{t}</text>
          </g>
        ))}
        {ticks.includes(1) && <line x1={tx(1)} x2={tx(1)} y1={M.top} y2={M.top + ih} stroke="var(--grid)" />}
        <path d={`${line(posterior)}L${sx(n - 1)},${sy(0)}L${sx(0)},${sy(0)}Z`} fill="var(--c0)" opacity={0.25} />
        <path d={line(posterior)} fill="none" stroke="var(--c0)" strokeWidth={2} />
        <path d={line(prior)} fill="none" stroke="var(--c1)" strokeWidth={2} strokeDasharray="5 4" />
        {hover !== null && <line x1={sx(hover)} x2={sx(hover)} y1={M.top} y2={M.top + ih} stroke="var(--muted)" />}
      </svg>
      {hover !== null && (
        <div className="chart-tip num" style={{ left: `${Math.min(Math.max((sx(hover) / W) * 100, 25), 65)}%`, top: 0, transform: 'translateX(-40%)' }}>
          ROI {fmtRoi(grid[hover])}: before {(prior[hover] * 100).toFixed(0)}%, after {(posterior[hover] * 100).toFixed(0)}% of peak
        </div>
      )}
      <Legend items={[{ label: 'Before the data (prior)', color: 'var(--c1)', dashed: true }, { label: 'After the data (posterior)', color: 'var(--c0)' }]} />
    </div>
  )
}
