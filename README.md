# Kawkit

Upload weekly spend and revenue, fit a Bayesian marketing mix model, and get a recommended budget
split, with every estimate shown as a probability range.

Live: https://adarshnair01.github.io/kawkit/

## How it fits together

```
browser (React, GitHub Pages) ──► Supabase (auth, Postgres + RLS, storage, pgmq queue, Realtime) ◄── worker (Python, Mac mini)
```

The browser and the worker each talk only to Supabase. The worker pulls runs from the queue over
outgoing HTTPS, so the machine it runs on opens no ports.

| Folder | What it is |
| --- | --- |
| `web/` | React 19 + Vite + TypeScript + Tailwind. CSV checks, hand-written SVG charts, the browser optimiser. |
| `worker/` | Python 3.12 service: validation, the PyMC model sampled with nutpie, summaries, retention. |
| `supabase/migrations/` | Tables, row-level security, storage policies, the queue and run lifecycle functions. |
| `e2e/` | Playwright flows and axe accessibility checks. |
| `docs/` | Requirements, design and operating notes. |

## Run the worker on the Mac mini

```bash
git clone https://github.com/adarshnair01/kawkit.git && cd kawkit/worker
./launchd/install.sh      # asks once for the Supabase secret key and stores it in the Keychain
```

The service starts at login, restarts if it crashes, and writes JSON logs to `~/Library/Logs/kawkit/`.
Update with `git pull && ./launchd/restart.sh`. Concurrency defaults to 2 runs × 4 chains
(`KAWKIT_CONCURRENCY`, `KAWKIT_CORES_PER_RUN` before `install.sh` to change it).

## Develop

```bash
cd web && npm install && npm run dev          # http://localhost:5173/kawkit/
cd web && npm test && npm run lint            # unit tests: validation parity, optimiser

cd worker && uv sync
uv run pytest                                 # unit tests
uv run pytest -m slow                         # known-truth recovery on 4 synthetic datasets (~5 min)
KAWKIT_SERVICE_KEY=... uv run pytest -m integration   # isolation, limits, retention, queue lifecycle on the live project

SUPABASE_ACCESS_TOKEN=sbp_... supabase/apply.sh supabase/migrations/0001_init.sql   # apply a migration
SUPABASE_ACCESS_TOKEN=sbp_... supabase/deploy-function.sh economy                   # deploy an Edge Function
```

See `docs/operations.md` for what is and is not in this version.

MIT licence.

The real-data examples use five brands from the Conjura MMM dataset: Anderson, Anthony (2024), *Multi-Region
Marketing Mix Modelling (MMM) Dataset for Several eCommerce Brands*, figshare,
https://doi.org/10.6084/m9.figshare.25314841.v3, licensed CC BY 4.0. Weekly totals were derived from the daily data.
The economy controls in two examples come from FRED (University of Michigan consumer sentiment, US CPI). Two examples
use category search interest from Google Trends. Weather from Open-Meteo was tested but is not used.

Neon, the help chat, follows the approach of [LiteBot](https://github.com/emiryuksel/LiteBot) by Emir Yüksel
(MIT licence): a front-end-only bot that answers from a local JSON file. Neon uses its own matcher and question set.
