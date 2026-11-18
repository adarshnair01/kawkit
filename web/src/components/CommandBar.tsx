import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../api/auth'
import { listRuns } from '../api/runs'
import type { Run } from '../api/types'

interface Item {
  label: string
  hint: string
  to: string
}

const SHORTCUTS: [string, string][] = [
  ['Ctrl or ⌘ + K', 'Jump to any page or run'],
  ['?', 'Show this list'],
  ['/', 'Search your runs (on My runs)'],
  ['N', 'Start a new run (signed in)'],
  ['G then R', 'Go to My runs (signed in)'],
  ['Esc', 'Close a panel, tour or pop-up'],
]

const typing = (el: EventTarget | null) => {
  const t = el as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
}

/** Ctrl/⌘+K to jump anywhere, "?" for the shortcut list. Runs are fetched only when the bar opens. */
export function CommandBar() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'closed' | 'jump' | 'help'>('closed')
  const [q, setQ] = useState('')
  const [runs, setRuns] = useState<Run[]>([])
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const gPressed = useRef(0)
  const signed = !!session

  const close = () => {
    setMode('closed')
    opener.current?.focus()
  }
  const open = (m: 'jump' | 'help') => {
    opener.current = document.activeElement as HTMLElement | null
    setQ('')
    setSel(0)
    setMode(m)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        open('jump')
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return
      if (e.key === '?') {
        e.preventDefault()
        open('help')
      } else if (e.key === '/') {
        const box = document.getElementById('runs-search')
        if (box) {
          e.preventDefault()
          box.focus()
        }
      } else if (e.key.toLowerCase() === 'n' && signed) navigate('/new')
      else if (e.key.toLowerCase() === 'g') gPressed.current = Date.now()
      else if (e.key.toLowerCase() === 'r' && signed && Date.now() - gPressed.current < 900) navigate('/runs')
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signed])

  useEffect(() => {
    if (mode === 'closed') return
    setTimeout(() => input.current?.focus(), 20)
    if (mode === 'jump' && signed) listRuns().then(setRuns).catch(() => undefined)
  }, [mode, signed])

  const items = useMemo<Item[]>(() => {
    const pages: Item[] = [
      { label: 'Home', hint: 'Page', to: '/' },
      { label: 'Sample result', hint: 'Page', to: '/sample' },
      { label: 'Beat the model (game)', hint: 'Page', to: '/play' },
      { label: 'What five real brands taught the model', hint: 'Page', to: '/lessons' },
      { label: 'Check my data (free)', hint: 'Page', to: '/check' },
      ...(signed
        ? [
            { label: 'My runs', hint: 'Page', to: '/runs' },
            { label: 'New run', hint: 'Page', to: '/new' },
            { label: 'Compare two runs', hint: 'Page', to: '/compare' },
            { label: 'Account', hint: 'Page', to: '/account' },
          ]
        : [{ label: 'Sign in', hint: 'Page', to: '/sign-in' }]),
    ]
    const r: Item[] = runs.map((x) => ({ label: x.name, hint: `Run · ${x.status}`, to: `/runs/${x.id}` }))
    const needle = q.trim().toLowerCase()
    return [...pages, ...r].filter((i) => !needle || i.label.toLowerCase().includes(needle)).slice(0, 12)
  }, [q, runs, signed])

  const go = (i: Item | undefined) => {
    if (!i) return
    setMode('closed')
    navigate(i.to)
  }

  if (mode === 'closed') return null
  return (
    <div className="cmd-overlay no-print" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="cmd" role="dialog" aria-modal="true" aria-label={mode === 'help' ? 'Keyboard shortcuts' : 'Jump to a page or run'} onKeyDown={(e) => e.key === 'Escape' && close()}>
        {mode === 'help' ? (
          <>
            <h2 className="text-base">Keyboard shortcuts</h2>
            <dl className="cmd-keys">{SHORTCUTS.map(([k, d]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{d}</dd></div>)}</dl>
            <button ref={input as never} type="button" className="btn btn-small" onClick={close}>Close</button>
          </>
        ) : (
          <>
            <label className="sr-only" htmlFor="cmd-input">Jump to</label>
            <input
              id="cmd-input"
              ref={input}
              className="input"
              placeholder="Jump to a page or one of your runs…"
              value={q}
              autoComplete="off"
              role="combobox"
              aria-expanded="true"
              aria-controls="cmd-list"
              aria-activedescendant={items[sel] ? `cmd-${sel}` : undefined}
              onChange={(e) => { setQ(e.target.value); setSel(0) }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
                else if (e.key === 'Enter') { e.preventDefault(); go(items[sel]) }
              }}
            />
            <ul id="cmd-list" role="listbox" aria-label="Results" className="cmd-list">
              {items.map((i, n) => (
                <li key={i.to + i.label} id={`cmd-${n}`} role="option" aria-selected={n === sel} className={n === sel ? 'on' : ''} onMouseEnter={() => setSel(n)} onClick={() => go(i)}>
                  <span>{i.label}</span><span className="muted text-sm">{i.hint}</span>
                </li>
              ))}
              {items.length === 0 && <li className="muted" role="presentation">Nothing matches. Try another word.</li>}
            </ul>
            <p className="text-xs muted">↑ ↓ to move, Enter to go, Esc to close. Press ? any time for all shortcuts.</p>
          </>
        )}
      </div>
    </div>
  )
}
