import { useState } from 'react'
import { useAuth } from '../api/auth'
import { friendlyError, requestAccountDeletion } from '../api/runs'
import { supabase } from '../api/supabase'

export default function Account() {
  const { session } = useAuth()
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const del = async () => {
    setBusy(true)
    setError(null)
    try {
      await requestAccountDeletion()
      await supabase.auth.signOut()
    } catch (e) {
      setError(friendlyError(e))
      setBusy(false)
    }
  }
  return (
    <div className="grid gap-4 max-w-2xl">
      <h1>Account</h1>
      <div className="card">
        <h2>Signed in as</h2>
        <p className="mt-1">{session?.user.email}</p>
      </div>
      <div className="card">
        <h2>Delete my account</h2>
        <p className="mt-1">This cancels anything queued or running, signs you out, and deletes your account with every run, uploaded file, result and log within 24 hours. It cannot be undone.</p>
        <label className="field mt-3" htmlFor="confirm">Type DELETE to confirm</label>
        <input id="confirm" className="input" style={{ maxWidth: '16rem' }} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
        {error && <div className="notice notice-bad mt-3" role="alert">{error}</div>}
        <div className="mt-3">
          <button type="button" className="btn btn-danger" disabled={confirm !== 'DELETE' || busy} onClick={del}>{busy ? 'Deleting…' : 'Delete my account and all my data'}</button>
        </div>
      </div>
    </div>
  )
}
