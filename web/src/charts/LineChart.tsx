import { useRef, useState, type ReactNode } from 'react'
import { fmtCompact, niceTicks } from '../lib/format'

export interface Series {
  label: string
  values: number[]
  color: string
  dashed?: boolean
  band?: { low: number[]; high: number[] }
  width?: number
}

interface Props {
  /** x positions; numeric (spend) or category labels (dates) */
  x: number[] | string[]
  series: Series[]
  ariaLabel: string
  xLabel?: string
  yLabel?: string
  height?: number
  fmtX?: (v: number | string) => string
  fmtY?: (v: number) => string
  /** vertical marker lines at x values (numeric x only) */
  markers?: { x: number; label: string; color?: string }[]
  zeroBased?: boolean
}

const W = 720
const M = { top: 12, right: 16, bottom: 40, left: 56 }

/** Line chart with optional uncertainty bands and a hover tooltip. */
export function LineChart({ x, series, ariaLabel, xLabel, yLabel, height = 280, fmtX, fmtY = fmtCompact, markers = [], zeroBased = true }: Props) {
  const [hover, setHover] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const n = x.length
  const numeric = typeof x[0] === 'number'
  const xs = numeric ? (x as number[]) : (x as string[]).map((_, i) => i)
  const xMin = xs[0]
  const xMax = xs[n - 1]
  const all = series.flatMap((s) => [...s.values, ...(s.band ? [...s.band.low, ...s.band.high] : [])])
  let yMin = Math.min(...all)
  let yMax = Math.max(...all)
  if (zeroBased && yMin > 0) yMin = 0
  const pad = (yMax - yMin) * 0.06 || 1
  yMax += pad
  if (yMin < 0) yMin -= pad
  const iw = W - M.left - M.right
  const ih = height - M.top - M.bottom
  const sx = (v: number) => M.left + ((v - xMin) / (xMax - xMin || 1)) * iw
  const sy = (v: number) => M.top + ih - ((v - yMin) / (yMax - yMin || 1)) * ih
  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${sx(xs[i]).toFixed(1)},${sy(v).toFixed(1)}`).join('')
  const area = (lo: number[], hi: number[]) =>
    `${path(hi)}${lo.map((_, i) => `L${sx(xs[n - 1 - i]).toFixed(1)},${sy(lo[n - 1 - i]).toFixed(1)}`).join('')}Z`
  const yTicks = niceTicks(yMin, yMax, 5)
  const nx = Math.min(6, n)
  const xTickIdx = numeric ? [] : Array.from({ length: nx }, (_, i) => Math.round((i * (n - 1)) / Math.max(nx - 1, 1)))
  const xTicks = numeric ? niceTicks(xMin, xMax, 6) : []
  const fx = fmtX ?? ((v: number | string) => (typeof v === 'number' ? fmtCompact(v) : v))

  const onMove = (clientX: number) => {
    const r = box.current?.querySelector('svg')?.getBoundingClientRect()
    if (!r) return
    const px = ((clientX - r.left) / r.width) * W
    let best = 0
    for (let i = 1; i < n; i++) if (Math.abs(sx(xs[i]) - px) < Math.abs(sx(xs[best]) - px)) best = i
    setHover(best)
  }

  let tip: ReactNode = null
  if (hover !== null) {
    const left = (sx(xs[hover]) / W) * 100
    tip = (
      <div className="chart-tip num" style={{ left: `${Math.min(Math.max(left, 12), 78)}%`, top: 4, transform: 'translateX(-30%)' }}>
        <div style={{ fontWeight: 650 }}>{fx(x[hover])}</div>
        {series.map((s) => (
          <div key={s.label}>
            <span aria-hidden="true" style={{ color: s.color }}>● </span>
            {s.label}: {fmtY(s.values[hover])}
            {s.band && <span className="muted"> ({fmtY(s.band.low[hover])} to {fmtY(s.band.high[hover])})</span>}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-label={ariaLabel}
        style={{ width: '100%', height: 'auto', display: 'block', touchAction: 'pan-y' }}
        onMouseMove={(e) => onMove(e.clientX)}
        onMouseLeave={() => setHover(null)}
        onTouchStart={(e) => onMove(e.touches[0].clientX)}
        onTouchMove={(e) => onMove(e.touches[0].clientX)}
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={sy(t)} y2={sy(t)} stroke="var(--grid)" />
            <text x={M.left - 6} y={sy(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{fmtY(t)}</text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={sx(t)} y={height - M.bottom + 16} textAnchor="middle" fontSize="11" fill="var(--muted)">{fx(t)}</text>
        ))}
        {xTickIdx.map((i) => (
          <text key={i} x={sx(i)} y={height - M.bottom + 16} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize="11" fill="var(--muted)">{fx(x[i])}</text>
        ))}
        {xLabel && <text x={M.left + iw / 2} y={height - 4} textAnchor="middle" fontSize="11" fill="var(--muted)">{xLabel}</text>}
        {yLabel && <text transform={`translate(12 ${M.top + ih / 2}) rotate(-90)`} textAnchor="middle" fontSize="11" fill="var(--muted)">{yLabel}</text>}
        {series.map((s) => s.band && <path key={`b-${s.label}`} d={area(s.band.low, s.band.high)} fill={s.color} opacity={0.18} />)}
        {series.map((s) => (
          <path key={s.label} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={s.width ?? 2} strokeDasharray={s.dashed ? '5 4' : undefined} strokeLinejoin="round" />
        ))}
        {markers.map((m) => {
          const right = sx(m.x) > W * 0.7
          return (
            <g key={m.label}>
              <line x1={sx(m.x)} x2={sx(m.x)} y1={M.top} y2={M.top + ih} stroke={m.color ?? 'var(--text)'} strokeDasharray="3 3" />
              <text x={sx(m.x) + (right ? -4 : 4)} y={M.top + 10} fontSize="11" fill={m.color ?? 'var(--text)'} textAnchor={right ? 'end' : 'start'}>{m.label}</text>
            </g>
          )
        })}
        {hover !== null && <line x1={sx(xs[hover])} x2={sx(xs[hover])} y1={M.top} y2={M.top + ih} stroke="var(--muted)" />}
        {hover !== null && series.map((s) => <circle key={s.label} cx={sx(xs[hover])} cy={sy(s.values[hover])} r={3.5} fill={s.color} stroke="var(--surface)" />)}
      </svg>
      {tip}
      <Legend items={series.map((s) => ({ label: s.label + (s.band ? ', with 90% range shaded' : ''), color: s.color, dashed: s.dashed }))} />
    </div>
  )
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs muted mt-1" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          <svg width="22" height="8" aria-hidden="true">
            <line x1="0" x2="22" y1="4" y2="4" stroke={it.color} strokeWidth="3" strokeDasharray={it.dashed ? '5 3' : undefined} />
          </svg>
          {it.label}
        </li>
      ))}
    </ul>
  )
}
