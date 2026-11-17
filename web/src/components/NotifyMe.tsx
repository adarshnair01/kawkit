import { useNotifyPermission } from '../lib/alerts'

/** Offers a browser notification for when a waiting run finishes. Hidden when unsupported or already decided. */
export function NotifyMe() {
  const { perm, ask } = useNotifyPermission()
  if (perm === 'unsupported') return null
  if (perm === 'granted') return <p className="text-sm muted">We’ll show a notification when a run finishes while you’re on another tab.</p>
  if (perm === 'denied') return <p className="text-sm muted">The tab title will change when a run finishes. Notifications are blocked in this browser.</p>
  return (
    <p className="text-sm muted">
      The tab title changes when a run finishes. <button type="button" className="btn btn-small" onClick={ask}>Also notify me</button>
    </p>
  )
}
