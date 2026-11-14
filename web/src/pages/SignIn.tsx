import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../api/auth'
import { friendlyError } from '../api/runs'
import { siteUrl, supabase } from '../api/supabase'

type Mode = 'in' | 'up' | 'link'

export default function SignIn() {
  const { session } = useAuth()
  const location = useLocation()
  const [mode, setMode] = useState<Mode>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  if (session) return <Navigate to={(location.state as { from?: string } | null)?.from ?? '/runs'} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      if (mode === 'link') {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: siteUrl() } })
        if (error) throw error
        setInfo('Check your inbox for a sign-in link. It can take a minute to arrive.')
      } else if (mode === 'up') {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: siteUrl() } })
        if (error) throw error
        if (!data.session) setInfo('Account created. Check your inbox to confirm your email, then sign in.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (err) {
      const msg = friendlyError(err)
      setError(/invalid login credentials/i.test(msg) ? 'That email and password do not match an account. Check them, or create an account.' : /rate limit/i.test(msg) ? 'Too many emails were requested. Wait a few minutes, or sign in with a password instead.' : msg)
    } finally {
      setBusy(false)
    }
  }

  const modes: [Mode, string][] = [['in', 'Sign in'], ['up', 'Create account'], ['link', 'Email me a link']]
  return (
    <div className="max-w-md mx-auto grid gap-4">
      <h1>{mode === 'up' ? 'Create your account' : 'Sign in'}</h1>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Sign-in method">
        {modes.map(([m, label]) => (
          <button key={m} type="button" className={`btn btn-small ${mode === m ? 'btn-primary' : ''}`} aria-pressed={mode === m} onClick={() => { setMode(m); setError(null); setInfo(null) }}>{label}</button>
        ))}
      </div>
      <form className="card grid gap-3" onSubmit={submit}>
        <div>
          <label className="field" htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {mode !== 'link' && (
          <div>
            <label className="field" htmlFor="password">Password{mode === 'up' ? ' (at least 8 characters)' : ''}</label>
            <input id="password" className="input" type="password" autoComplete={mode === 'up' ? 'new-password' : 'current-password'} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        )}
        {mode === 'link' && <p className="text-sm muted">We email you a one-time link; no password needed.</p>}
        {error && <div className="notice notice-bad" role="alert">{error}</div>}
        {info && <div className="notice notice-ok" role="status">{info}</div>}
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Working…' : mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send link'}</button>
      </form>
      <p className="text-sm muted">You stay signed in on this device. Your uploads and results are visible only to you.</p>
    </div>
  )
}
