import { useMemo } from 'react'

const COLOURS = ['#fb5472', '#1b2b7c', '#dbdff3', '#cf2750', '#7d8ae0']

/** A short burst of paper for good news. Decorative only, and off for people who prefer reduced motion. */
export function Confetti() {
  const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const pieces = useMemo(
    () => Array.from({ length: 36 }, (_, i) => ({ i, left: Math.random() * 100, delay: Math.random() * 0.4, dur: 1.8 + Math.random() * 1.4, drift: (Math.random() - 0.5) * 160, colour: COLOURS[i % COLOURS.length], size: 6 + Math.random() * 6 })),
    [],
  )
  if (reduce) return null
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p) => (
        <span key={p.i} style={{ left: `${p.left}%`, width: p.size, height: p.size * 1.6, background: p.colour, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, ['--drift' as string]: `${p.drift}px` }} />
      ))}
    </div>
  )
}
