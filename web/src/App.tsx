import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './api/auth'
import { supabase } from './api/supabase'
import Account from './pages/Account'
import Compare from './pages/Compare'
import Home from './pages/Home'
import Methodology from './pages/Methodology'
import MyRuns from './pages/MyRuns'
import NewRun from './pages/NewRun'
import RunPage from './pages/RunPage'
import Sample from './pages/Sample'
import SignIn from './pages/SignIn'

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const location = useLocation()
  if (loading) return <p className="muted" role="status">Loading…</p>
  if (!session) return <Navigate to="/sign-in" state={{ from: location.pathname + location.search }} replace />
  return children
}

type Theme = 'system' | 'light' | 'dark'

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('kawkit-theme') as Theme) || 'system')
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('kawkit-theme', theme)
  }, [theme])
  const next: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }
  return (
    <button type="button" className="btn btn-small" onClick={() => setTheme(next[theme])} aria-label={`Colour theme: ${theme}. Change theme`}>
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6.5" fill={theme === 'dark' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" />
        {theme === 'system' && <path d="M8 1.5a6.5 6.5 0 0 1 0 13z" fill="currentColor" />}
      </svg>
      {theme[0].toUpperCase() + theme.slice(1)}
    </button>
  )
}

export default function App() {
  const { session } = useAuth()
  const location = useLocation()
  useEffect(() => {
    document.getElementById('main')?.focus({ preventScroll: true })
    window.scrollTo(0, 0)
  }, [location.pathname])
  const nav = ({ isActive }: { isActive: boolean }) =>
    `px-2 py-1.5 rounded-md text-sm font-semibold no-underline ${isActive ? 'bg-[var(--accent-soft)] text-[var(--accent-ink)]' : 'text-[var(--text)]'}`
  return (
    <div className="min-h-screen flex flex-col">
      <a href="#main" className="skip-link" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus() }}>Skip to content</a>
      <header className="site border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="max-w-6xl mx-auto px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link to="/" className="flex items-center gap-2 no-underline text-[var(--text)] font-bold text-lg display">
            <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
              <rect width="32" height="32" fill="var(--accent)" />
              <path d="M7 22c4 0 5-12 9-12s5 8 9 8" fill="none" stroke="var(--accent-text)" strokeWidth="3" strokeLinecap="round" />
            </svg>
            Kawkit
          </Link>
          <nav aria-label="Main" className="flex flex-wrap items-center gap-1 flex-1">
            <NavLink to="/sample" className={nav}>Sample result</NavLink>
            {session && <NavLink to="/runs" className={nav}>My runs</NavLink>}
            {session && <NavLink to="/new" className={nav}>New run</NavLink>}
            <NavLink to="/methodology" className={nav}>How it works</NavLink>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {session ? (
              <>
                <NavLink to="/account" className={nav}>Account</NavLink>
                <button type="button" className="btn btn-small" onClick={() => supabase.auth.signOut()}>Sign out</button>
              </>
            ) : (
              <Link to="/sign-in" className="btn btn-small btn-primary">Sign in</Link>
            )}
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="flex-1 max-w-6xl w-full mx-auto px-4 py-6 outline-none">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/sample" element={<Sample />} />
          <Route path="/sign-in" element={<SignIn />} />
          <Route path="/methodology" element={<Methodology />} />
          <Route path="/runs" element={<RequireAuth><MyRuns /></RequireAuth>} />
          <Route path="/new" element={<RequireAuth><NewRun /></RequireAuth>} />
          <Route path="/runs/:id" element={<RequireAuth><RunPage /></RequireAuth>} />
          <Route path="/compare" element={<RequireAuth><Compare /></RequireAuth>} />
          <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />
          <Route path="*" element={<div><h1>Page not found</h1><p className="mt-2"><Link to="/">Back to the start</Link></p></div>} />
        </Routes>
      </main>
      <footer className="border-t border-[var(--border)] text-sm muted">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap gap-x-5 gap-y-1">
          <span>Kawkit · Bayesian marketing mix modelling</span>
          <Link to="/methodology">Methodology and glossary</Link>
        </div>
      </footer>
    </div>
  )
}
