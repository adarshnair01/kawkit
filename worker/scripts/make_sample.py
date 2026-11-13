"""Precompute the guest sample run shipped with the web app:  uv run python scripts/make_sample.py"""

import json
from pathlib import Path

from kawkit_worker.pipeline import run_pipeline
from kawkit_worker.synth import make_dataset

out_dir = Path(__file__).resolve().parent.parent.parent / "web" / "public" / "sample"
out_dir.mkdir(parents=True, exist_ok=True)
csv, truth = make_dataset(seed=7)
priors = {"tv": {"roi_low": 0.8, "roi_high": 2.0, "carryover_weeks": 4, "note": "Geo test, Q2 2025"}}
out = run_pipeline(csv.encode(), priors, seed=20261113)
draws = out.pop("draws")
summary = out.pop("summary")
(out_dir / "sample.csv").write_text(csv)
(out_dir / "draws.json").write_text(json.dumps(draws, separators=(",", ":")))
(out_dir / "sample.json").write_text(json.dumps({
    "run": {"id": "sample", "name": "Sample: 3 years, 5 channels", "status": "finished", "priors": priors,
            "data_summary": summary, "seed": 20261113, "created_at": "2026-11-13T00:00:00Z",
            "finished_at": "2026-11-13T00:01:00Z"},
    "result": {"run_id": "sample", **out, "draws_path": "sample/draws.json"},
    "truth": truth.roi,
}, separators=(",", ":")))
(out_dir / "template.csv").write_text(
    "date,revenue,spend_tv,spend_search,spend_social,control_promo\n"
    "2024-01-01,512340,45000,21000,15500,0\n2024-01-08,498120,0,19800,16200,0\n2024-01-15,530900,52000,22400,14100,1\n"
)
print(out["diagnostics"], {k: out["fit"][k] for k in ("r2", "mape", "holdout_mape")})
