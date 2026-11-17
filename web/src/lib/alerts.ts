import { useEffect, useState } from 'react'
import type { Run } from '../api/types'

const seen = new Map<string, Run['status']>()
let baseTitle: string | null = null
let restoreBound = false

const live = (s?: Run['status']) => s === 'queued' || s === 'running'

function restoreTitle() {
  if (baseTitle !== null && !document.hidden) {
    document.title = baseTitle
    baseTitle = null
  }
}

/** Remember each run's status; when a run we saw waiting or running has ended, flag the tab and (if allowed) notify. */
export function announceFinished(runs: Run[]) {
  for (const r of runs) {
    const before = seen.get(r.id)
    seen.set(r.id, r.status)
    if (!live(before) || live(r.status) || (r.status !== 'finished' && r.status !== 'failed')) continue
    const done = r.status === 'finished'
    const text = done ? `Finished: ${r.name}` : `Failed: ${r.name}`
    if (document.hidden) {
      if (baseTitle === null) baseTitle = document.title
      document.title = `${done ? '✓' : '✕'} ${text}`
      if (!restoreBound) {
        restoreBound = true
        document.addEventListener('visibilitychange', restoreTitle)
        window.addEventListener('focus', restoreTitle)
      }
      try {
        if ('Notification' in window && Notification.permission === 'granted') new Notification('Kawkit', { body: text, tag: r.id })
      } catch {
        // some browsers only allow notifications from a service worker; the tab title is enough
      }
    }
  }
}

export const canNotify = () => typeof window !== 'undefined' && 'Notification' in window

/** "Notify me" state: whether the browser can, and whether the user has already chosen. */
export function useNotifyPermission() {
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(() => (canNotify() ? Notification.permission : 'unsupported'))
  useEffect(() => {
    if (!canNotify()) return
    setPerm(Notification.permission)
  }, [])
  const ask = async () => {
    try {
      setPerm(await Notification.requestPermission())
    } catch {
      setPerm('denied')
    }
  }
  return { perm, ask }
}
