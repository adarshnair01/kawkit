"""Precompute the real-data guest examples: five anonymised e-commerce brands from the Conjura MMM
dataset (Anderson, 2024, CC BY 4.0, https://doi.org/10.6084/m9.figshare.25314841.v3).

    uv run python scripts/make_real_sample.py path/to/conjura_mmm_data.csv path/to/external_dir

The brands are chosen for their data, not their results. Every "All Territories" series with at
least 104 complete weeks is ranked by its number of channels with steady, varied spend (at least 3%
of spend, active in over 60% of weeks, coefficient of variation above 0.3), then by length of
history; the best-ranked series in each of the first five named verticals is used.
Revenue is merchandise value after discounts; daily rows are summed to weeks starting Monday.

Each brand also gets baseline features (control columns). Which groups are used per brand comes from
the rolling-origin test in scripts/eval_features.py (results in scripts/feature_eval_results.json):
the simplest set within about a point of the lowest error on unseen weeks.
"""

import json
import sys
from pathlib import Path

import pandas as pd

from kawkit_worker.pipeline import run_pipeline

sys.path.insert(0, str(Path(__file__).parent))
from conjura_features import GROUPS, NAMES, SERIES, build, select  # noqa: E402

FEATURES = {
    "home": ["events", "promo"], "beauty": ["events", "promo"],
    "apparel": ["events", "promo", "macro"], "food": ["events", "promo", "macro"], "health": ["events"],
}

df = pd.read_csv(sys.argv[1], parse_dates=["DATE_DAY"])
out_dir = Path(__file__).resolve().parent.parent.parent / "web" / "public" / "sample"
index = []
for slug, series in SERIES.items():
    frame, meta = build(df, slug, Path(sys.argv[2]))
    csv = select(frame, FEATURES[slug])
    out = frame
    keep = [c for c in NAMES if f"spend_{NAMES[c]}" in frame.columns]

    res = run_pipeline(csv.encode(), {}, seed=20261114)
    draws = res.pop("draws")
    summary = res.pop("summary")
    (out_dir / f"real-{slug}.csv").write_text(csv)
    (out_dir / f"real-{slug}-draws.json").write_text(json.dumps(draws, separators=(",", ":")))
    (out_dir / f"real-{slug}.json").write_text(json.dumps({
        "run": {"id": f"real-{slug}", "name": f"Real brand: {meta['vertical']}", "status": "finished", "priors": {}, "data_summary": summary},
        "result": {"run_id": f"real-{slug}", **res, "draws_path": f"sample/real-{slug}-draws.json"},
        "source": {**meta, "series": series, "citation": "Anderson, Anthony (2024). Multi-Region Marketing Mix Modelling (MMM) Dataset for "
                   "Several eCommerce Brands. figshare. Dataset.", "doi": "https://doi.org/10.6084/m9.figshare.25314841.v3",
                   "license": "CC BY 4.0", "license_url": "https://creativecommons.org/licenses/by/4.0/"},
        "features": {"groups": FEATURES[slug], "controls": [c for g in FEATURES[slug] for c in GROUPS[g]]},
    }, separators=(",", ":")))
    index.append({"slug": slug, **meta, "weeks": len(out), "channels": len(summary["channels"])})
    d, f = res["diagnostics"], res["fit"]
    b = f["baseline"]
    print(f"\n== {slug}: {meta} {len(out)} weeks", [NAMES[c] for c in keep])
    print("  ", d["verdict"], d["max_rhat"], d["min_ess_bulk"], d["divergences"], "retried", d["retried"],
          "| r2", f["r2"], "mape", f["mape"], "holdout", f["holdout_mape"], "media", {k: round(v, 2) for k, v in f["media_share"].items()},
          "| baseline min", round(min(b)), "| spend/rev", round(sum(c["total"] for c in summary["channels"]) / summary["revenue_total"], 3))
    print("  ", [w["code"] + ":" + str(w.get("column")) for w in summary["warnings"]])
    for c in res["channels"]:
        print("   ", c["name"], round(c["total_spend"]), round(c["roi"]["low"], 2), round(c["roi"]["median"], 2), round(c["roi"]["high"], 2), c["prior"]["verdict"])
    p = res["default_plan"]
    print("   plan", round(p["prob_better"], 2), {k: round(v, 1) for k, v in p["lift_pct"].items()})
(out_dir / "real-index.json").write_text(json.dumps(index, separators=(",", ":")))
