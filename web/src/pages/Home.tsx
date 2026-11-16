import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../api/auth'
import { HowItWorks } from '../components/HowItWorks'
import { DriversArt, PriorArt, QueueArt, RangesArt, SplitArt, TrustArt } from '../components/landing/FeatureArt'
import { HeroArt } from '../components/landing/HeroArt'
import { useLandingMotion } from '../components/landing/motion'

interface Feature {
  tag: string
  title: string
  body: string
  points: string[]
  art: ReactNode
  link: { to: string; label: string }
}

const FEATURES: Feature[] = [
  {
    tag: 'Honest numbers',
    title: 'Every answer comes with its range',
    body: 'A single ROI figure hides how sure anyone can be. Kawkit shows each channel’s return as a 90% range, with the chance it pays back more than it costs.',
    points: ['ROI, marginal ROI and contribution per channel', 'A plain high, medium or low confidence label', 'A table behind every chart'],
    art: <RangesArt />,
    link: { to: '/sample', label: 'See the channel ranges' },
  },
  {
    tag: 'Bayesian priors',
    title: 'Bring what you already know',
    body: 'Ran a lift test? Know that TV lingers for a month? Enter it as a range and the model starts from there, then shows how far your data moved that belief.',
    points: ['ROI range and carry-over per channel, all optional', 'Before and after on one chart', 'A warning when the data disagrees with you'],
    art: <PriorArt />,
    link: { to: '/sample', label: 'See prior vs posterior' },
  },
  {
    tag: 'Budget optimiser',
    title: 'A budget split, and the odds it is better',
    body: 'Set a weekly budget and limits per channel. The optimiser finds the best split across 500 versions of the model and tells you how likely it is to beat what you do today.',
    points: ['Re-runs instantly in your browser', 'Minimum, maximum and lock per channel', 'Flags spend beyond anything in your data'],
    art: <SplitArt />,
    link: { to: '/sample', label: 'Try the optimiser' },
  },
  {
    tag: 'Proof, not promises',
    title: 'Tested on weeks it never saw',
    body: 'Each run hides its last quarter, fits again without it, and predicts it. You see the miss next to a simple forecast that needs no model, so you know what the model is worth.',
    points: ['Quarter total and typical week, side by side', 'Convergence check before any result is shown', 'Says so when a simple rule does as well'],
    art: <TrustArt />,
    link: { to: '/sample?example=home', label: 'See it on a real brand' },
  },
  {
    tag: 'Beyond advertising',
    title: 'Black Friday is not your ads working',
    body: 'Add events, promotions or market trends as extra columns and they go into the baseline, so advertising is not credited with sales it did not cause.',
    points: ['Effect of each outside factor, with its range', 'Tested on five real brands: events cut error by up to a quarter', 'Baseline held to a realistic share of revenue'],
    art: <DriversArt />,
    link: { to: '/sample?example=home', label: 'See the baseline drivers' },
  },
  {
    tag: 'Built to be trusted',
    title: 'Submit, close the tab, come back',
    body: 'Runs queue and fit in the background on a dedicated model server, with live status. Your data is yours: nobody else can read it, and you can delete everything.',
    points: ['Live queue position and progress', 'Your last 5 runs kept, compared side by side', 'CSV downloads and a printable report'],
    art: <QueueArt />,
    link: { to: '/methodology', label: 'Read how it works' },
  },
]

const EXAMPLES = [
  { to: '/sample', name: 'Made-up data', note: 'True answers known, so you can check the model' },
  { to: '/sample?example=home', name: 'Home decor', note: 'UK · 155 weeks · quarter forecast within 5%' },
  { to: '/sample?example=beauty', name: 'Skincare', note: 'US · 131 weeks · a hard case, shown honestly' },
  { to: '/sample?example=apparel', name: 'Apparel', note: 'US · 147 weeks · a third of a simple forecast’s miss' },
  { to: '/sample?example=food', name: 'Food and drink', note: 'US · 116 weeks · nine paid channels' },
  { to: '/sample?example=health', name: 'Dental care', note: 'UK · 108 weeks · where a model adds least' },
]

export default function Home() {
  const { session } = useAuth()
  useLandingMotion()
  return (
    <div className="landing">
      <section className="hero bleed" data-parallax>
        <HeroArt />
        <div className="hero-copy">
          <p className="hero-eyebrow">Bayesian marketing mix modelling, no code</p>
          <h1>Find out where your next marketing dollar should go, and how sure you can be.</h1>
          <p className="hero-lead">Upload weekly spend and revenue. Kawkit fits a Bayesian model and recommends a budget split, with every estimate shown as a range instead of a single number.</p>
          <div className="flex flex-wrap gap-3">
            <Link to="/sample" className="btn btn-primary">Try the sample result</Link>
            {session ? <Link to="/new" className="btn">Start a new run</Link> : <Link to="/sign-in" className="btn">Sign in to run your own data</Link>}
          </div>
          <p className="hero-note">The sample needs no account. It includes a made-up example with known answers and <Link to="/sample?example=home">five real e-commerce brands</Link>.</p>
        </div>
      </section>

      <section className="stats reveal" aria-label="At a glance">
        {[
          ['90%', 'ranges on every estimate'],
          ['6', 'worked examples, 5 on real data'],
          ['500', 'model versions behind each budget split'],
          ['0', 'lines of code to write'],
        ].map(([n, t]) => (
          <div key={t}>
            <p className="stat-n">{n}</p>
            <p className="stat-t">{t}</p>
          </div>
        ))}
      </section>

      <div className="features">
        <div className="reveal section-head">
          <p className="eyebrow">What it does</p>
          <h2>Six things a spreadsheet and a last-click report cannot tell you</h2>
        </div>
        {FEATURES.map((f, i) => (
          <section key={f.title} className={`feature reveal ${i % 2 ? 'flip' : ''}`} data-parallax aria-labelledby={`f-${i}`}>
            <div className="feature-copy">
              <p className="feature-n" aria-hidden="true">{String(i + 1).padStart(2, '0')}</p>
              <p className="eyebrow">{f.tag}</p>
              <h3 id={`f-${i}`}>{f.title}</h3>
              <p className="muted">{f.body}</p>
              <ul>
                {f.points.map((p) => <li key={p}>{p}</li>)}
              </ul>
              <Link to={f.link.to} className="feature-link">{f.link.label} <span aria-hidden="true">→</span></Link>
            </div>
            <div className="feature-visual"><div data-speed="0.07">{f.art}</div></div>
          </section>
        ))}
      </div>

      <section className="reveal grid gap-4" aria-labelledby="how-h">
        <div className="section-head">
          <p className="eyebrow">How it works</p>
          <h2 id="how-h">Three steps, a few minutes</h2>
        </div>
        <HowItWorks />
      </section>

      <section className="reveal grid gap-4" aria-labelledby="ex-h">
        <div className="section-head">
          <p className="eyebrow">See it working</p>
          <h2 id="ex-h">Six finished results to explore, no account needed</h2>
        </div>
        <ul className="examples">
          {EXAMPLES.map((e, i) => (
            <li key={e.name}>
              <Link to={e.to} className="example-card">
                <span className="example-n" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                <span className="example-name">{e.name}</span>
                <span className="example-note">{e.note}</span>
                <span className="example-go" aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="card reveal" aria-labelledby="privacy-h">
        <h2 id="privacy-h">How your data is stored and deleted</h2>
        <ul className="list-disc pl-5 mt-2 grid gap-1">
          <li>Your file is sent to and stored on the service (a private storage bucket) so the model server can fit it. Only you can read it.</li>
          <li>Your 5 most recent finished runs are kept. When a 6th finishes, the oldest run and its file are deleted at once.</li>
          <li>Failed and cancelled runs are deleted after 7 days. Accounts with no sign-in for 12 months are deleted.</li>
          <li>You can delete your account and everything in it from the Account page; it is removed within 24 hours.</li>
        </ul>
      </section>

      <section className="cta bleed reveal" aria-labelledby="cta-h">
        <h2 id="cta-h">See what your own numbers say</h2>
        <p>Start with the sample, or upload a CSV and have a result in minutes.</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link to="/sample" className="btn hero-btn">Explore the sample</Link>
          <Link to={session ? '/new' : '/sign-in'} className="btn hero-btn-ghost">{session ? 'Start a new run' : 'Create a free account'}</Link>
        </div>
      </section>
    </div>
  )
}
