import { useServerStatus } from '../api/runs'

/** Shown when the model server's heartbeat is over 2 minutes old. */
export function ServerNotice({ waiting }: { waiting?: boolean }) {
  const { known, online } = useServerStatus()
  if (!known || online) return null
  return (
    <div className="notice notice-warn" role="status">
      <strong>The model server is offline.</strong> {waiting ? 'Your run is safe in the queue and will start when the server is back.' : 'You can still submit: runs wait in the queue and start when it is back. Past results stay available.'}
    </div>
  )
}
