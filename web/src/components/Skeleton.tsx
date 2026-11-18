/** Grey placeholder blocks while content loads. The status text is for screen readers. */
export function Skeleton({ rows = 3, label = 'Loading…' }: { rows?: number; label?: string }) {
  return (
    <div className="grid gap-3" role="status">
      <span className="sr-only">{label}</span>
      <div className="skeleton" style={{ height: '2rem', width: '40%' }} aria-hidden="true" />
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ height: '3.2rem' }} aria-hidden="true" />)}
    </div>
  )
}
