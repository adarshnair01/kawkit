import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { GLOSSARY } from '../lib/glossary'

/** A word with a dotted underline: tap or hover for a one-line meaning, and a way to ask Neon more. */
export function Term({ k, children }: { k: keyof typeof GLOSSARY; children?: ReactNode }) {
  const g = GLOSSARY[k]
  const [pinned, setPinned] = useState(false)
  const [hover, setHover] = useState(false)
  const open = pinned || hover
  const setOpen = (v: boolean) => {
    setPinned(v)
    if (!v) setHover(false)
  }
  const id = useId()
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <span className="term" ref={box} onMouseLeave={() => setHover(false)}>
      <button type="button" className="term-btn" aria-expanded={open} aria-controls={id} onClick={() => setPinned((p) => !p)} onMouseEnter={() => setHover(true)}>
        {children ?? g.name}
      </button>
      {open && (
        <span id={id} className="term-pop" role="note">
          <strong>{g.name}</strong>
          <span className="block">{g.short}</span>
          <button type="button" className="term-more" onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent('neon:ask', { detail: { id: g.ask } })) }}>Tell me more in Neon →</button>
        </span>
      )}
    </span>
  )
}
