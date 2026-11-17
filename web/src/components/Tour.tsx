import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

interface Step {
  title: string
  text: string
  find: () => HTMLElement | null
}

const byHeading = (id: string) => () => document.getElementById(id)?.closest('section') ?? null
const tab = (label: string) => () => Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).find((t) => t.textContent?.trim() === label) ?? null

const STEPS: Step[] = [
  { title: 'Start with “In short”', text: 'Three plain sentences: what to do with your budget, how sure the model is, and how far to trust it. If you read nothing else, read this box.', find: byHeading('summary-h') },
  { title: 'Check it converged', text: 'This says whether the model’s calculation settled. Green means the ranges below can be read as a fair picture. Amber or red means treat them with care.', find: byHeading('conv-h') },
  { title: 'Ranges, not single numbers', text: 'Every figure comes with a 90% range. A narrow range means the data was clear. A wide one means the model is honest about not knowing.', find: () => document.querySelector<HTMLElement>('[role="tablist"]') },
  { title: 'Test it on weeks it never saw', text: 'The Fit tab shows the model predicting weeks it was not allowed to see, against a simple forecast. This is the fairest test of whether to trust it.', find: tab('Fit') },
  { title: 'Then move the budget', text: 'The Optimise budget tab suggests a split at the same total spend, and lets you try your own. Nothing is refitted, so it answers instantly.', find: tab('Optimise budget') },
]

/** An opt-in walkthrough of the sample result: highlights one part of the page at a time. */
export function Tour() {
  const [step, setStep] = useState<number | null>(null)
  const open = step !== null
  useEffect(() => {
    if (step === null) return
    const el = STEPS[step].find()
    if (!el) return
    el.classList.add('tour-target')
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
    return () => el.classList.remove('tour-target')
  }, [step])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setStep(null)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])
  if (step === null)
    return <button type="button" className="btn btn-small" onClick={() => setStep(0)}>Take the 1-minute tour</button>
  const s = STEPS[step]
  const last = step === STEPS.length - 1
  return (
    <>
      <span className="sr-only" role="status">Tour step {step + 1} of {STEPS.length}</span>
      <div className="tour no-print" role="region" aria-label="Guided tour">
        <p className="eyebrow">Step {step + 1} of {STEPS.length}</p>
        <h2 className="text-base">{s.title}</h2>
        <p className="text-sm mt-1">{s.text}</p>
        <div className="flex flex-wrap gap-2 mt-3">
          {step > 0 && <button type="button" className="btn btn-small" onClick={() => setStep(step - 1)}>Back</button>}
          {!last && <button type="button" className="btn btn-small btn-primary" autoFocus onClick={() => setStep(step + 1)}>Next</button>}
          {last && <Link to="/sign-in" className="btn btn-small btn-primary">Try it on your data</Link>}
          <button type="button" className="btn btn-small" onClick={() => setStep(null)}>{last ? 'Finish' : 'Close tour'}</button>
        </div>
      </div>
    </>
  )
}
