import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Matcher, reply, type QaEntry } from './match'

/**
 * Neon: the site's guide. A chat window that answers from a local file of questions and answers,
 * with no backend and no API, following the approach of LiteBot (github.com/emiryuksel/LiteBot, MIT).
 */

type Msg =
  | { from: 'user'; text: string }
  | { from: 'neon'; text: string; entry?: QaEntry; chips?: { label: string; ask?: string; topic?: string }[]; chipsLabel?: string }

// questions offered first, by where the visitor is
const STARTERS: [RegExp, string[]][] = [
  [/^\/(new|check)/, ['what-data-needed', 'column-mapper', 'events-library', 'should-i-add-priors', 'is-data-private']],
  [/^\/runs\/|^\/sample|^\/shared/, ['read-results-first', 'what-is-roi', 'accuracy', 'optimiser-how', 'what-to-test-next']],
  [/^\/runs/, ['how-long-run', 'run-status', 'compare-runs', 'share-link']],
  [/^\/lessons/, ['baseline-share', 'outside-factors-help', 'endogeneity']],
  [/.*/, ['what-is-kawkit', 'how-to-start', 'what-data-needed', 'is-it-free', 'what-is-mmm']],
]

/** Answers are plain text: blank lines split paragraphs, "- " lines are bullets, "1. " lines are steps. */
function Body({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  text.split('\n\n').forEach((block, i) => {
    const lines = block.split('\n')
    if (lines.every((l) => l.startsWith('- '))) blocks.push(<ul key={i}>{lines.map((l, j) => <li key={j}>{l.slice(2)}</li>)}</ul>)
    else if (lines.every((l) => /^\d+\. /.test(l))) blocks.push(<ol key={i}>{lines.map((l, j) => <li key={j}>{l.replace(/^\d+\. /, '')}</li>)}</ol>)
    else blocks.push(<p key={i}>{block}</p>)
  })
  return <>{blocks}</>
}

export default function Neon() {
  const [open, setOpen] = useState(false)
  const [matcher, setMatcher] = useState<Matcher | null>(null)
  const [entries, setEntries] = useState<QaEntry[]>([])
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [typing, setTyping] = useState(false)
  const location = useLocation()
  const input = useRef<HTMLInputElement>(null)
  const launcher = useRef<HTMLButtonElement>(null)
  const log = useRef<HTMLDivElement>(null)

  const starters = (m: Matcher) => {
    const ids = STARTERS.find(([re]) => re.test(location.pathname))![1]
    return ids.map((id) => m.get(id)).filter((e): e is QaEntry => !!e).map((e) => ({ label: e.q, ask: e.id }))
  }
  const welcome = (m: Matcher): Msg => ({
    from: 'neon',
    text: 'Hi, I’m Neon, your guide to Kawkit. Ask me anything about the tool or about marketing mix modelling, in your own words.',
    chips: [...starters(m), { label: 'Browse all topics', topic: '' }],
    chipsLabel: 'People often ask',
  })

  // the answers are only fetched when the chat is first opened
  useEffect(() => {
    if (!open || matcher) return
    let off = false
    import('./qa.json').then((qa) => {
      if (off) return
      const list = qa.default.entries as QaEntry[]
      const m = new Matcher(list)
      setEntries(list)
      setMatcher(m)
      setMsgs([welcome(m)])
    })
    return () => {
      off = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, matcher])

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 30)
  }, [open])
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight })
  }, [msgs, typing])

  const close = () => {
    setOpen(false)
    launcher.current?.focus()
  }

  const say = (m: Msg) => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      setMsgs((all) => [...all, m])
      return
    }
    setTyping(true)
    setTimeout(() => {
      setTyping(false)
      setMsgs((all) => [...all, m])
    }, 380)
  }

  const answer = (e: QaEntry, alternatives: QaEntry[] = []): Msg => {
    const related = e.related.map((id) => matcher!.get(id)).filter((x): x is QaEntry => !!x)
    const seen = new Set([e.id])
    const chips = [...alternatives, ...related].filter((x) => !seen.has(x.id) && seen.add(x.id)).slice(0, 4).map((x) => ({ label: x.q, ask: x.id }))
    return { from: 'neon', text: e.a, entry: e, chips, chipsLabel: alternatives.length ? 'Or did you mean' : 'Related questions' }
  }

  const topics = (category: string): Msg => {
    const cats = [...new Set(entries.map((e) => e.category))].filter((c) => c !== 'About Neon')
    if (!category) return { from: 'neon', text: 'Pick a topic and I’ll show its questions.', chips: cats.map((c) => ({ label: c, topic: c })), chipsLabel: 'Topics' }
    return {
      from: 'neon',
      text: `${category}: ${entries.filter((e) => e.category === category).length} questions.`,
      chips: [...entries.filter((e) => e.category === category).map((e) => ({ label: e.q, ask: e.id })), { label: 'All topics', topic: '' }],
      chipsLabel: category,
    }
  }

  const ask = (q: string) => {
    if (!matcher || !q.trim() || typing) return
    setMsgs((all) => [...all, { from: 'user', text: q.trim() }])
    const r = reply(matcher, q)
    if (r.kind === 'answer') say(answer(r.entry, r.alternatives))
    else if (r.kind === 'unsure') say({ from: 'neon', text: 'I’m not certain I have that one. Is it one of these?', chips: [...r.guesses.map((e) => ({ label: e.q, ask: e.id })), { label: 'Browse all topics', topic: '' }], chipsLabel: 'Closest questions' })
    else say({ from: 'neon', text: 'I don’t have an answer for that. I can only answer from my prepared questions about Kawkit and marketing mix modelling. Try different words, or browse the topics.', chips: [{ label: 'Browse all topics', topic: '' }, ...starters(matcher).slice(0, 3)], chipsLabel: 'Try these' })
  }
  const pick = (chip: { label: string; ask?: string; topic?: string }) => {
    if (!matcher || typing) return
    setMsgs((all) => [...all, { from: 'user', text: chip.label }])
    input.current?.focus() // the clicked chip disappears with the next reply; keep focus in the panel
    if (chip.ask) say(answer(matcher.get(chip.ask)!))
    else say(topics(chip.topic ?? ''))
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    ask(text)
    setText('')
  }

  return (
    <div className="neon no-print">
      {open && (
        <section className="neon-panel" role="dialog" aria-label="Neon, Kawkit’s guide" id="neon-panel" onKeyDown={(e) => e.key === 'Escape' && close()}>
          <div className="neon-head">
            <span className="neon-avatar" aria-hidden="true">N</span>
            <div>
              <p className="neon-name">Neon</p>
              <p className="neon-sub">Kawkit’s guide · answers from prepared help, not live AI</p>
            </div>
            <div className="neon-head-actions">
              <button type="button" className="neon-icon" onClick={() => matcher && setMsgs([welcome(matcher)])} aria-label="Clear the conversation">
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4h10M6 4V2.5h4V4M4.5 4l.6 9h5.8l.6-9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <button type="button" className="neon-icon" onClick={close} aria-label="Close Neon">
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
              </button>
            </div>
          </div>
          <div className="neon-log" ref={log} role="log" aria-live="polite" aria-label="Conversation with Neon" tabIndex={0}>
            {!matcher && <p className="neon-typing">Loading…</p>}
            {msgs.map((m, i) =>
              m.from === 'user' ? (
                <div key={i} className="neon-msg neon-user"><span className="sr-only">You asked: </span>{m.text}</div>
              ) : (
                <div key={i} className="neon-msg neon-bot">
                  <span className="sr-only">Neon: </span>
                  {m.entry && <p className="neon-q">{m.entry.q}</p>}
                  <Body text={m.text} />
                  {m.entry && m.entry.links.length > 0 && (
                    <p className="neon-links">
                      {m.entry.links.map((l) => <Link key={l.to} to={l.to} className="neon-link">{l.label} <span aria-hidden="true">→</span></Link>)}
                    </p>
                  )}
                  {m.chips && m.chips.length > 0 && i === msgs.length - 1 && (
                    <div className="neon-chips" role="group" aria-label={m.chipsLabel}>
                      <p className="neon-chips-label">{m.chipsLabel}</p>
                      {m.chips.map((c) => <button key={c.label} type="button" className="neon-chip" onClick={() => pick(c)}>{c.label}</button>)}
                    </div>
                  )}
                </div>
              ),
            )}
            {typing && <p className="neon-typing" aria-hidden="true"><span /><span /><span /></p>}
          </div>
          <form className="neon-form" onSubmit={submit}>
            <label className="sr-only" htmlFor="neon-input">Ask Neon a question</label>
            <input id="neon-input" ref={input} className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask a question…" autoComplete="off" maxLength={300} />
            <button type="submit" className="btn btn-primary" disabled={!text.trim() || !matcher}>Send</button>
          </form>
        </section>
      )}
      <button ref={launcher} type="button" className="neon-launcher" aria-expanded={open} aria-controls="neon-panel" onClick={() => (open ? close() : setOpen(true))}>
        <span className="neon-avatar" aria-hidden="true">N</span>
        <span>{open ? 'Close Neon' : 'Ask Neon'}</span>
      </button>
    </div>
  )
}
