import { useId, type KeyboardEvent, type ReactNode } from 'react'

export interface TabDef {
  id: string
  label: string
}

export function Tabs({ tabs, active, onChange, label, children }: { tabs: TabDef[]; active: string; onChange: (id: string) => void; label: string; children: ReactNode }) {
  const base = useId()
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.id === active)
    let j: number
    if (e.key === 'ArrowRight') j = (i + 1) % tabs.length
    else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') j = 0
    else if (e.key === 'End') j = tabs.length - 1
    else return
    e.preventDefault()
    onChange(tabs[j].id)
    document.getElementById(`${base}-${tabs[j].id}`)?.focus()
  }
  return (
    <div>
      <div role="tablist" aria-label={label} className="tabs" onKeyDown={onKey}>
        {tabs.map((t) => (
          <button key={t.id} id={`${base}-${t.id}`} type="button" role="tab" className="tab" aria-selected={t.id === active} aria-controls={`${base}-panel`} tabIndex={t.id === active ? 0 : -1} onClick={() => onChange(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-${active}`} className="pt-4">
        {children}
      </div>
    </div>
  )
}
