import { Link } from 'react-router-dom'
import { useAuth } from '../api/auth'
import { ServerNotice } from '../components/ServerNotice'

export default function Home() {
  const { session } = useAuth()
  return (
    <div className="grid gap-6">
      <section className="grid gap-4 py-4 sm:py-8">
        <p className="eyebrow">Bayesian marketing mix modelling, no code</p>
        <h1 style={{ fontSize: 'clamp(1.9rem, 5vw, 2.8rem)', maxWidth: '18em' }}>Find out where your next marketing dollar should go, and how sure you can be.</h1>
        <p className="text-lg muted" style={{ maxWidth: '44em' }}>
          Upload weekly spend and revenue. Kawkit fits a Bayesian marketing mix model and recommends a budget split, with every estimate shown as a range rather than a single number.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link to="/sample" className="btn btn-primary">Try the sample result</Link>
          {session ? <Link to="/new" className="btn">Start a new run</Link> : <Link to="/sign-in" className="btn">Sign in to run your own data</Link>}
        </div>
        <p className="text-sm muted">The sample needs no account.</p>
      </section>
      <ServerNotice />
      <section className="grid gap-4 md:grid-cols-3" aria-label="How it works">
        {[
          ['1. Upload a CSV', 'One row per week: a date, revenue, and one spend column per channel. The file is checked instantly and problems are shown with row numbers.'],
          ['2. Add what you know', 'Optionally give an ROI range from a lift test, or how long a channel’s effect lasts. Leave everything blank to let the data lead.'],
          ['3. Get ranges, not guesses', 'See each channel’s return with a 90% range, how far the data moved your beliefs, and a budget split with the probability that it beats your current one.'],
        ].map(([h, p]) => (
          <div key={h} className="card">
            <h2 className="text-base">{h}</h2>
            <p className="mt-1 muted">{p}</p>
          </div>
        ))}
      </section>
      <section className="card" aria-labelledby="privacy-h">
        <h2 id="privacy-h">How your data is stored and deleted</h2>
        <ul className="list-disc pl-5 mt-2 grid gap-1">
          <li>Your file is sent to and stored on the service (a private storage bucket) so the model server can fit it. Only you can read it.</li>
          <li>Your 5 most recent finished runs are kept. When a 6th finishes, the oldest run and its file are deleted at once.</li>
          <li>Failed and cancelled runs are deleted after 7 days. Accounts with no sign-in for 12 months are deleted.</li>
          <li>You can delete your account and everything in it from the Account page; it is removed within 24 hours.</li>
        </ul>
      </section>
    </div>
  )
}
