# Operating notes

What was built, what was checked, and what is still open. Written 14 Nov 2026.

## Where things run

| Part | Where | Notes |
| --- | --- | --- |
| Web app | GitHub Pages, built by `.github/workflows/deploy.yml` on every push to `main` | Deploys only if web lint, web tests, worker lint and worker unit tests pass |
| Database, auth, storage, queue | Supabase project `kawkit` (`cmjedgyaquekrtixmwbf`, region Tokyo `ap-northeast-1`) | Schema in `supabase/migrations/` |
| Model worker | Mac mini, installed with `worker/launchd/install.sh` | Outgoing HTTPS only |

## Checked

| Check | Result |
| --- | --- |
| Known truth, 4 synthetic datasets (`pytest -m slow`) | Every dataset passes the convergence gates (R-hat ≤ 1.01, ESS ≥ 400, divergences < 0.1%); the 90% ROI interval contains the truth for at least 80% of channels; holdout MAPE under 3%; a correct prior narrows the interval; a wrong prior is flagged as a conflict; same seed gives the same summary |
| Optimiser (web and worker) | Spends exactly the budget, never breaks a limit, never below the current split, matches brute force within 0.1% on two-channel cases |
| Isolation (`pytest -m integration`, live project) | User B cannot read or change user A's runs, results, events or files, by table access, storage or function call; nobody can write rows directly; worker functions are closed to users |
| Limits | 4th active run refused with an explanation |
| Retention | When a 6th run finishes, the oldest run's rows and both files are gone |
| Account deletion | Every row, file and the auth user are removed |
| Queue lifecycle with a real worker | Submit to finished; one run per user at a time; cancel a running run; a killed worker is followed by an automatic retry that finishes (attempt 2) |
| Load (`pytest -m load`) | 10 runs from 5 users all finish, every user's first run starts before anyone's second |
| End to end (`e2e/flow.mjs`) | Guest sample, sign-up, bad file, sample upload, priors, run, results, optimise, downloads, account deletion; zero axe violations on every page in light and dark; no sideways scroll at 360 px |

Timing so far is from a 4-core cloud machine, not the Mac mini: the 156-week, 5-channel sample takes about
55 seconds from submit to results (main fit about 20 seconds).

## Added after the first version

- A plain-language summary at the top of every result (what to do, how sure, how far to trust it).
- A printable report: "Open printable report" stacks every section on one page for print or save as PDF.
- A held-out-weeks chart: what the model predicted for the last 13 weeks when fitted without them.
- Black-and-white theme with one electric-blue accent, Space Grotesk headings, Inter body text, 4 px corners.

- Five guest examples on real data: anonymised brands from the Conjura MMM dataset (Anderson, 2024, CC BY 4.0,
  https://doi.org/10.6084/m9.figshare.25314841.v3), one each from home, beauty, apparel, food and health.
  `worker/scripts/make_real_sample.py` documents the selection rule and rebuilds them from the downloaded
  file. Only the derived weekly files for those five brands are in the repository.
- Fitting them found a crash: a channel with no spend in the fitting window (it only started in the held-out
  weeks) had an invalid prior. Fixed, with a regression test.
- The model now keeps the no-media baseline (intercept, trend, seasonality) at or above zero in every week.
  The first fit on real data credited media with more than 100% of revenue; this constraint fixed that.
  The known-truth tests were re-run and still pass.
- The model expects the baseline to be 50% to 90% of revenue: no preference inside that range, a half-normal
  penalty (sd 2 points of share) outside it. On the five real brands this moved the baseline from 2-25% to
  23-47% for four of them (the fifth was already 64%); the data still pulls below 50% where spend tracks sales.
  `BASELINE_SHARE` and `BASELINE_SHARE_SD` in `worker/kawkit_worker/model.py` set the range and its firmness.

- Outside factors in the baseline. For the five real brands, calendar events, promotion depth, weather and
  economy measures were each tested by predicting 39 unseen weeks (`worker/scripts/eval_features.py`, results in
  `worker/scripts/feature_eval_results.json`). Events helped most (home brand error 19.9% to 16.0%); consumer
  confidence and inflation helped the two US brands; weather helped none. Each example uses the simplest set
  within about a point of its lowest error. Results now include a "baseline drivers" chart of each control's effect.
  Weather came from Open-Meteo and the economic series from FRED; neither is stored in the repository beyond the
  derived weekly control columns in the example CSV files.

- Default channel priors recalibrated. The old default (half-normal scaled to 2x the channel's spend share)
  implied typical ROIs of 3 to 19 with upper ends of 25 to 75 on the real brands, more than all revenue. Every
  channel now starts with the same expected ROI, the one at which media as a whole explains 30% of revenue
  (`MEDIA_SHARE_PRIOR` in `worker/kawkit_worker/model.py`). Priors are not tuned to any brand's results.
  The prior-vs-posterior verdict gained "the data overruled the starting assumption" for results that land
  outside the prior's range. Known-truth tests re-run and passing.
- Search interest tested as a baseline factor. Category interest from Google Trends (one guessed term per brand)
  gave a small gain for the skincare and dental brands and is used there. The brand's own search interest
  (branded-search clicks from the dataset, since the brands are anonymous) made two of three brands worse and
  takes credit from advertising, so it is not used.

- Error review. Every run's held-out check now reports the quarter's total error and compares the model with
  the better of two forecasts that need no model (previous 13 weeks' average; same weeks a year earlier scaled
  for growth). Over three held-out quarters the model beats that benchmark week to week for four brands (home
  15.0% vs 17.4%, skincare 30.8% vs 51.1%, apparel 20.7% vs 38.7%, food 23.3% vs 25.4%) and not for dental
  (30.8% vs 26.9%). Two model changes aimed at the error were tested and rejected because they made it worse:
  noise proportional to sales, and a trend that can change pace each quarter. For skincare, food and dental the
  latest quarter came in 30-41% above forecast and the simple forecasts missed it as badly, which points to an
  event outside the data.

- Landing page. The home page is now a showcase: a dark hero with layered SVG that moves with scroll and the
  pointer, six feature sections each with an illustration that draws in on scroll, the how-it-works diagram, and
  links to the six examples. Motion is off for visitors who ask for reduced motion.

- Wider macroeconomic test. Eight measures per country (consumer confidence, inflation, unemployment, retail
  sales growth, interest rate, fuel price or exchange rate, real income growth, plus all at once and a combined
  index) were tested on top of each brand's events and promotions. A measure is used only if it cuts error on
  unseen weeks by at least 2 points. Unemployment took the apparel brand from 25.2% to 11.2% and replaced
  confidence and inflation there; the food brand keeps confidence and inflation (29.6% to 23.3%); nothing
  qualified for the other three. Adding everything at once made three brands worse.

## Different from the design, on purpose

- **Sign-in is email and password**, with an emailed link as a second option. Google sign-in was dropped on
  request. Email confirmation is switched off (`mailer_autoconfirm`) because Supabase's built-in mailer is
  heavily rate-limited; turn it back on after connecting an SMTP provider (Authentication > Emails).
- **The model is written directly in PyMC**, using the same geometric adstock and logistic saturation as
  PyMC-Marketing rather than its `MMM` class. That keeps one set of expressions for sampling, summaries and
  the optimiser, and makes the ROI prior a single extra term. A unit test checks the transforms against
  `pymc_marketing.mmm.transformers`.
- **Sampling progress is an estimate.** nutpie does not expose a cheap draw counter, so the bar shows stage
  (main fit, holdout fit, summaries) with a time-based estimate inside each stage.
- **Posterior draws are stored as plain JSON** (about 60 KB for 5 channels), not gzip; a gzipped full summary
  is stored next to it.
- **Database tests run with pytest against the live project** rather than pgTAP on a local Supabase.
- **Region is Tokyo**, where the project was created; the requirements say Mumbai. Moving means a new project.

## Not done yet

- **Mac mini**: the worker has not been installed or timed there. Until it is, new runs wait in the queue.
  The 10-minute target for 156 weeks × 10 channels, the port scan and FileVault/dedicated-user setup are
  checks to do on the machine.
- **Emails**: run-finished emails (FR-14) and the owner alert after 10 minutes without a heartbeat need an
  email provider; neither is built. The site does show the offline notice.
- **pg_cron heartbeat check**: not set up, for the same reason.
- **Custom address** `tools.adarshnair.online`: needs DNS. If you add it, update `base` in
  `web/vite.config.ts` and the site URL and redirect list in Supabase (Authentication > URL configuration).
- **Secret rotation**: the Supabase service key and a personal access token were used from a temporary cloud
  machine during the build. Rotate both once the Mac mini is running: create a new secret key for the Mac
  mini (Project Settings > API keys), disable the legacy `service_role` key, and revoke the access token
  (Account > Access tokens).
- Browser coverage: the end-to-end flow ran in Chromium only.
