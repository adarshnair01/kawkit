"""Precompute the second guest example from real data: one anonymised e-commerce brand from the
Conjura MMM dataset (Anderson, 2024, CC BY 4.0, https://doi.org/10.6084/m9.figshare.25314841.v3).

    uv run python scripts/make_real_sample.py path/to/conjura_mmm_data.csv

The brand is chosen for its data, not its results: the "All Territories" series with at least
104 complete weeks that has the most channels with steady, varied spend (ties: longest history).
Revenue is merchandise value after discounts; daily rows are summed to weeks starting Monday.
"""

import json
import sys
from pathlib import Path

import pandas as pd

from kawkit_worker.pipeline import run_pipeline

SERIES = "826fd57057c52458a1f77cae4e3e6c67"  # Home & Garden > Home & Interior Decor, UK, GBP
NAMES = {
    "GOOGLE_PAID_SEARCH_SPEND": "google_search", "GOOGLE_SHOPPING_SPEND": "google_shopping",
    "GOOGLE_PMAX_SPEND": "google_pmax", "GOOGLE_DISPLAY_SPEND": "google_display",
    "GOOGLE_VIDEO_SPEND": "google_video", "META_FACEBOOK_SPEND": "facebook",
    "META_INSTAGRAM_SPEND": "instagram", "META_OTHER_SPEND": "meta_other", "TIKTOK_SPEND": "tiktok",
}

df = pd.read_csv(sys.argv[1], parse_dates=["DATE_DAY"])
g = df[df.MMM_TIMESERIES_ID == SERIES].set_index("DATE_DAY").sort_index()
meta = {k: str(g[c].iloc[0]) for k, c in [("vertical", "ORGANISATION_VERTICAL"), ("subvertical", "ORGANISATION_SUBVERTICAL"),
                                           ("territory", "ORGANISATION_PRIMARY_TERRITORY_NAME"), ("currency", "CURRENCY_CODE")]}
g = g[list(NAMES)].fillna(0).assign(revenue=g.ALL_PURCHASES_ORIGINAL_PRICE.fillna(0) - g.ALL_PURCHASES_GROSS_DISCOUNT.fillna(0))
weekly = g.resample("W-MON", label="left", closed="left").sum()
weekly = weekly[g.revenue.resample("W-MON", label="left", closed="left").count() == 7]
keep = [c for c in NAMES if weekly[c].sum() > 0]
out = pd.DataFrame({"date": weekly.index.strftime("%Y-%m-%d"), "revenue": weekly.revenue.round(2)})
for c in keep:
    out[f"spend_{NAMES[c]}"] = weekly[c].round(2).values
csv = out.to_csv(index=False)

res = run_pipeline(csv.encode(), {}, seed=20261114)
draws = res.pop("draws")
summary = res.pop("summary")
out_dir = Path(__file__).resolve().parent.parent.parent / "web" / "public" / "sample"
(out_dir / "real.csv").write_text(csv)
(out_dir / "real-draws.json").write_text(json.dumps(draws, separators=(",", ":")))
(out_dir / "real.json").write_text(json.dumps({
    "run": {"id": "real", "name": "Real e-commerce brand", "status": "finished", "priors": {}, "data_summary": summary},
    "result": {"run_id": "real", **res, "draws_path": "sample/real-draws.json"},
    "source": {**meta, "series": SERIES, "citation": "Anderson, Anthony (2024). Multi-Region Marketing Mix Modelling (MMM) Dataset for "
               "Several eCommerce Brands. figshare. Dataset.", "doi": "https://doi.org/10.6084/m9.figshare.25314841.v3",
               "license": "CC BY 4.0", "license_url": "https://creativecommons.org/licenses/by/4.0/"},
}, separators=(",", ":")))
print(meta, len(out), "weeks", [NAMES[c] for c in keep])
print(res["diagnostics"])
print({k: res["fit"][k] for k in ("r2", "mape", "holdout_mape", "media_share")}, res["fit"]["holdout"]["inside"])
print([w["code"] + ":" + str(w.get("column")) for w in summary["warnings"]])
for c in res["channels"]:
    print(c["name"], round(c["total_spend"]), {k: round(v, 2) if isinstance(v, float) else v for k, v in c["roi"].items()}, c["prior"]["verdict"], c["prior"]["shrink"])
p = res["default_plan"]
print(round(p["prob_better"], 2), p["lift_pct"], [round(v) for v in p["current"]], [round(v) for v in p["recommended"]])
