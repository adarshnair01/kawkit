"""Precompute the real-data guest examples: five anonymised e-commerce brands from the Conjura MMM
dataset (Anderson, 2024, CC BY 4.0, https://doi.org/10.6084/m9.figshare.25314841.v3).

    uv run python scripts/make_real_sample.py path/to/conjura_mmm_data.csv

The brands are chosen for their data, not their results. Every "All Territories" series with at
least 104 complete weeks is ranked by its number of channels with steady, varied spend (at least 3%
of spend, active in over 60% of weeks, coefficient of variation above 0.3), then by length of
history; the best-ranked series in each of the first five named verticals is used.
Revenue is merchandise value after discounts; daily rows are summed to weeks starting Monday.
"""

import json
import sys
from pathlib import Path

import pandas as pd

from kawkit_worker.pipeline import run_pipeline

SERIES = {
    "home": "826fd57057c52458a1f77cae4e3e6c67",     # Home & Garden > Home & Interior Decor, UK
    "beauty": "3340d86d751fe8213235565e69512aa2",   # Beauty & Fitness > Face & Body Care, US
    "apparel": "f7493de0a760f84888105af70245bed3",  # Apparel > Undergarments, US
    "food": "ac9965a4cc73306fa9e4fcc0ac581eb5",     # Food & Drink, US
    "health": "acfe71e0c8a49dbe6f3f6e97d0370339",   # Health > Oral & Dental Care, UK
}
NAMES = {
    "GOOGLE_PAID_SEARCH_SPEND": "google_search", "GOOGLE_SHOPPING_SPEND": "google_shopping",
    "GOOGLE_PMAX_SPEND": "google_pmax", "GOOGLE_DISPLAY_SPEND": "google_display",
    "GOOGLE_VIDEO_SPEND": "google_video", "META_FACEBOOK_SPEND": "facebook",
    "META_INSTAGRAM_SPEND": "instagram", "META_OTHER_SPEND": "meta_other", "TIKTOK_SPEND": "tiktok",
}

df = pd.read_csv(sys.argv[1], parse_dates=["DATE_DAY"])
out_dir = Path(__file__).resolve().parent.parent.parent / "web" / "public" / "sample"
index = []
for slug, series in SERIES.items():
    g = df[df.MMM_TIMESERIES_ID == series].set_index("DATE_DAY").sort_index()
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
    (out_dir / f"real-{slug}.csv").write_text(csv)
    (out_dir / f"real-{slug}-draws.json").write_text(json.dumps(draws, separators=(",", ":")))
    (out_dir / f"real-{slug}.json").write_text(json.dumps({
        "run": {"id": f"real-{slug}", "name": f"Real brand: {meta['vertical']}", "status": "finished", "priors": {}, "data_summary": summary},
        "result": {"run_id": f"real-{slug}", **res, "draws_path": f"sample/real-{slug}-draws.json"},
        "source": {**meta, "series": series, "citation": "Anderson, Anthony (2024). Multi-Region Marketing Mix Modelling (MMM) Dataset for "
                   "Several eCommerce Brands. figshare. Dataset.", "doi": "https://doi.org/10.6084/m9.figshare.25314841.v3",
                   "license": "CC BY 4.0", "license_url": "https://creativecommons.org/licenses/by/4.0/"},
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
