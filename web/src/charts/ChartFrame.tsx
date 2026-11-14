import { useId, useState, type ReactNode } from 'react'

export interface TableData {
  caption: string
  header: string[]
  rows: (string | number)[][]
}

/** Every chart sits in this frame: a title, the chart, and a table view of the same numbers. */
export function ChartFrame({ title, note, table, children }: { title: string; note?: ReactNode; table: TableData; children: ReactNode }) {
  const [showTable, setShowTable] = useState(false)
  const id = useId()
  return (
    <section className="card" aria-labelledby={`${id}-t`}>
      <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
        <div>
          <h3 id={`${id}-t`}>{title}</h3>
          {note && <p className="muted text-sm mt-0.5">{note}</p>}
        </div>
        <button type="button" className="btn btn-small" aria-pressed={showTable} onClick={() => setShowTable((s) => !s)}>
          {showTable ? 'Show chart' : 'Show table'}
          <span className="sr-only"> for {title}</span>
        </button>
      </div>
      {showTable ? <DataTable {...table} /> : children}
    </section>
  )
}

export function DataTable({ caption, header, rows }: TableData) {
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label={caption}>
      <table className="data num">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {header.map((h) => (
              <th key={h} scope="col">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (j === 0 ? <th key={j} scope="row" style={{ fontWeight: 500 }}>{c}</th> : <td key={j}>{c}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
