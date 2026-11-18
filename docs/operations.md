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
- Navy, coral and lavender theme (navy headings and actions, coral accents, lavender tints on a near-white background; a light hero and a navy closing band on the home page), Space Grotesk headings, Inter body text, 4 px corners.

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

- Data connectors, first set (none needs credentials). A column mapper lets any spreadsheet layout and common
  date formats be used: roles are guessed from names and values and can be changed. Import from a link reads a
  Google Sheet shared by link, or any address that serves CSV to the browser. The event library works out Black
  Friday, Cyber week, the run-up to Christmas, Christmas and New Year, and Easter from the dates and adds them
  to the baseline. Tested by unit tests and the end-to-end flow; the link import is tested against a stubbed
  sheet, not a real Google Sheet.

- Economy connector. A Supabase Edge Function (`supabase/functions/economy`, deployed with
  `supabase/deploy-function.sh economy`) fetches monthly indicators for the US or UK from FRED: unemployment,
  inflation, consumer confidence, interest rate and retail sales growth. The FRED key is a Supabase secret
  (`FRED_API_KEY`) and never reaches the browser. The function checks the caller's token against Supabase Auth
  itself, because the gateway alone also lets the public key through. The browser gives each week the previous
  month's figure and leaves out any series that starts too late, ends more than 3 months before the data does,
  or never changes. FRED's UK inflation series stops at March 2025, so it is left out for later data.

- Seven additions that needed no outside accounts. In results: "what to test next" (the channel where the most
  money rides on the least certain return), a scenario planner (type any split, see the expected change with its
  range) and target mode (smallest budget expected to add a given weekly revenue, by bisection). Sharing:
  read-only links to a finished run (`supabase/migrations/0003_shares.sql`), valid 30 days, revocable, exposing
  results only. Reach: link-preview tags and image (`web/public/og.png`), a lessons page on what the five real
  brands changed, and a free data check at `/check` that runs entirely in the browser and carries the checked
  data over to New run after sign-in.

### Neon, the help chat

- A chat button on every page ("Ask Neon"). It answers from `web/src/neon/qa.json` (137 questions, tagged for
  new, everyday and expert users) in the browser; nothing is sent to a server and it is not live AI. The panel
  says so. The JSON is loaded only when someone opens the chat.
- Matching (`web/src/neon/match.ts`) scores each question against the entry's question, alternate wordings,
  keywords and answer text, with rarer words counting for more, a synonym list and a light stemmer. Low
  scores get "is it one of these?" or an honest "I don't have an answer for that" with a topic browser.
- Measured once on 40 questions written after tuning stopped: right answer first 31/40 (78%), in the top
  three 35/40 (88%). Off-topic questions (weather, recipes) get the fallback.
- To add or change answers, edit `qa.json` (fields: `id`, `level`, `category`, `q`, `alt`, `keywords`, `a`,
  `links`, `related`) and run `npm test`; the tests check every question finds its own answer.
- Based on the approach of LiteBot (MIT, Emir Yüksel); the notification sound was left out.

### Quick wins (notes, scenarios, Excel, alerts, tour, compare summary)

- **Run notes and tags** (migration `0004`): up to 500 characters and 5 tags per run, set from the run page
  through `set_run_notes`; shown on My runs. Realtime sends Postgres arrays as text, so `normaliseTags` accepts both.
- **Saved scenarios**: named what-if splits on a run (`scenarios` table, 10 per run, `save_scenario` and
  `delete_scenario`), listed under "Try your own split" with their expected change and 90% range.
- **Excel workbook** on the Download tab: summary, channels, weekly fit, recommended split and response curves.
  Written in the browser by `lib/xlsx.ts` (no styling or formulas) using `fflate` for the zip.
- **Run-finished alerts**: when a run ends while the tab is in the background the tab title changes, and a browser
  notification is shown if the user allowed it. Not the same as email, which still needs a provider.
- **Compare: "What changed"** (`lib/changes.ts`): channels ranked by how far ROI moved, marked as a real shift
  when the 90% ranges do not overlap.
- **Guided tour** on the sample result: opt-in, five steps, Esc to leave.
- **Duplicate and re-run** already existed as "Re-run with different priors" on a run.
- **Neon log of unanswered questions**: `neon_misses` holds the lower-cased text (max 200 characters), a count and
  first and last time. No user id or address. Nobody but the service key can read it, and Neon tells people it
  keeps these. Skipped in automated browsers. To read it, run in the SQL editor:
  `select question, asked, last_at from public.neon_misses order by asked desc limit 50;`
  then add answers to `web/src/neon/qa.json`.

### Friendlier and more interactive (second round)

- **First run:** an empty My runs page shows a three-step welcome; "Try a real brand" opens New run with one of the
  five real brands already loaded (`/new?brand=home`). New run also lists the brands under "No data yet?".
- **One-click fixes** (`validation/fix.ts`): day-first or written dates, repeated dates, blank or "n/a" spend and
  control cells (set to 0, never revenue) and negative spend. They change the browser copy only and re-run the check.
- **Waiting screen** (`components/RunProgress.tsx`): named stages, elapsed time and a rotating tip. The tip list
  is `TIPS` in that file.
- **Glossary** (`lib/glossary.ts`, `components/Term.tsx`): dotted terms with a hover or tap definition and a
  "Tell me more in Neon" link. Anything can ask Neon a question with
  `window.dispatchEvent(new CustomEvent('neon:ask', { detail: { id: '<qa id>' } }))`.
- **Drag sliders** in "Try your own split" (total can be kept fixed) and a **try-a-spend slider** on each response curve.
- **Beat the model** (`/play`, `lib/game.ts`): score = share of the optimiser's expected gain captured at the same
  total spend, each channel limited to 50% to 150% of now. Best scores are kept in the browser (localStorage).
- **Sample page:** "Try moving the budget" switches to the planner for guests (`kawkit:tab` event); the open tab is
  remembered per page for the session.
- **Toasts, confetti, skeletons:** confirmations for copy/save/download, a short confetti burst when a run you were
  watching finishes (off for reduced motion), and grey placeholders while pages load.
- **Jump bar and shortcuts** (`components/CommandBar.tsx`): Ctrl/⌘+K, ?, /, N, G then R. My runs gets a search box
  once there are three or more runs.

### Breakdown: channels split into items (platform, campaign, region)

Users upload a second file next to the main one and choose, per channel, which dimensions to break it down by.
The model estimates the items together with their channel.

**Files**
- Main file: unchanged. A channel's `spend_<channel>` column is its total.
- Breakdown file, long form: `date, channel, spend` plus any other columns, each offered as a dimension. Daily rows are
  added into the main file's weeks. Stored at `uploads/{user}/{run}/breakdown.csv`; the run's `settings.breakdown` holds
  `{channel: {dims: [...]}}`. Retention, orphan clean-up and account deletion remove it with the run.
- Checks (browser `web/src/breakdown/parse.ts` mirrors worker `breakdown.py`; the server's verdict wins): at most 12 items per channel; levels
  under 2% of the channel's spend, or beyond the top 7 per dimension, fold into "Other"; spelling and case variants merge; items
  covering under 98% of the main file's channel total leave the rest as "Not broken down"; items adding up to more than 2% over
  are an error; items active in under 20% of weeks are flagged. The browser also rates how separable items are from how their
  spend shares move over time (before any run).

**Model** (`worker/kawkit_worker/hier.py`): item scale = channel scale x exp(sum of per-dimension effects). Effects are
partially pooled (sum-to-zero, tau ~ HalfNormal(0.5), non-centred). Items in a channel share carry-over and saturation speed.
Several dimensions combine additively, so each effect is learned from many items. No effect is shared across channels. One item
per channel and no dimensions is the channel-only model (tested). Sampled with `target_accept` 0.98: the pooling can form a funnel
when items cannot be separated, and 0.9 gave divergences there. A run with a breakdown also fits the channel-only model on the same
data, so the Breakdown tab can show channel ROI with and without it (about 15 s more).

**Results** (`breakdown` in the result JSON): per item ROI with 90% range, share of spend and of the channel's revenue,
chance above the channel average, and "can the data tell it apart?" (from how far the item's scale moved from its prior);
per dimension value, a multiplicative effect with range. `draws.json` is then item-level: every item is a "channel" with
`groups.channel_of` saying which channel it is in, so the scenario planner works on items unchanged.

**Optimiser** (`optimise_items` in `optimise.py`, mirrored by `optimiseItems` in `optimize.ts`, parity fixture
`web/src/optimizer/items.fixture.json`, regenerate with `uv run python -m scripts.make_item_fixture`):
1. Per channel, the expected response is built on a grid of channel totals. Mode "keep" spreads each total over the items in
   today's proportions. Mode "resplit" lets each item's share move by at most 25%.
2. Resplit is used for a channel only if it helps in at least 80% of the posterior draws at today's spend. Otherwise the mix
   is kept and the plan says the data cannot tell the items apart.
3. The existing channel optimiser then runs on those curves, and item spends are filled in.
4. The plan reports the gain from moving money between channels and the extra gain from re-splitting inside them separately.
The default plan (`default_plan`) is "keep"; `default_plan_resplit` is also stored for shared links.

**Measured** (made-up data with known answers, 156 weeks, 5 channels, 4 cores; `worker/scripts/hier_bench.py`, 6 seeds each):

| Scenario | item 90% ranges holding the truth | channel ranges: breakdown vs channel-only | holdout error: breakdown vs channel-only | time |
|---|---|---|---|---|
| A: 3 separable platforms | 14/18 | 26/30 vs 23/30 | 1.59% vs 2.01% | 25 s vs 16 s |
| B: 2 items, constant mix (cannot be separated) | 10/12 | 29/30 vs 28/30 | 1.96% vs 2.07% | 24 s vs 16 s |
| C: platform x region, additive | 19/24 | 24/30 vs 25/30 | 1.98% vs 2.07% | 27 s vs 15 s |
| D: all 5 channels split, 15 items | 78/90 | 28/30 vs 18/30 | 2.10% vs 3.67% | 46 s vs 15 s |
| E: items saturate at different speeds (assumption broken) | 14/18 | 26/30 vs 25/30 | 1.79% vs 1.90% | 25 s vs 16 s |

- Inseparable items are not ranked confidently (P(best beats worst) 0.47 in B, 0.84 to 0.87 when separable).
- **Calibration** (`scripts/hier_calib.py`, 10 fresh seeds, 270 items): item ranges held the truth 83% of the time at nominal 90%.
  Widening log-ROI ranges about their median by 1.2 gave 91.9% on seeds 7 to 11 and 90.4% on seeds 12 to 16 (held out), so
  `hier.ITEM_RANGE_WIDEN = 1.2` is applied to item ROI ranges and to the item scales the optimiser sees. Channel ranges needed
  none (89%). A looser pooling prior (tau 0.8) did not help; a tighter one (0.25) made the inseparable case confidently wrong.
  Scenario E (assumption broken) stays at about 83% even widened.
- **End to end, as the product shows it** (`scripts/hier_pipeline_check.py`, 6 fresh seeds, a dataset with social, search and display
  broken down): item ranges held the truth in 49 of 53 cases (92%) and channel ranges in 27 of 30 (90%). The best item beat the
  worst by median in 6/6 (social), 5/6 (display) and 5/6 (search, where the ranges overlap almost completely).
- Of the 50 calibration fits, 48 passed the sampler checks first time. Production runs retry once with a longer warm-up.
- Not yet measured: time on the Mac mini; real brands (the five Conjura examples have no natural breakdown in the weekly files).
- Example for visitors: Sample result > "Made-up data, channels broken down" (`worker/scripts/make_breakdown_sample.py`).
- **After deploying, update the worker on the Mac** (`git pull && ./launchd/restart.sh`). An older worker ignores the breakdown;
  the run page then says "This run was fitted without its breakdown".
- Studies: `uv run python -m scripts.hier_bench [scenario]`, `scripts.hier_calib out.json`, `scripts.hier_pipeline_check`;
  slow tests: `uv run pytest -m slow tests/test_hier.py`.

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
