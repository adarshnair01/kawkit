"""Precompute the breakdown example shipped with the web app (made-up data, known item effects).
Run: uv run python -m scripts.make_breakdown_sample"""
import json
from pathlib import Path

from kawkit_worker.pipeline import run_pipeline
from kawkit_worker.synth import hier_csvs, make_hier_dataset
from scripts.hier_bench import B

out_dir = Path(__file__).resolve().parent.parent.parent / "web" / "public" / "sample"
BREAKDOWNS = {
    "social": B("varied", ["platform"], [("meta", 2.6), ("tiktok", 1.3), ("youtube", 0.5)]),
    "search": B("fixed", ["term"], [("brand", 2.4), ("nonbrand", 0.9)]),
    "display": B("varied", ["platform", "region"], [("a", "uk", 1.6), ("a", "us", 2.4), ("b", "uk", 0.8), ("b", "us", 1.2)]),
}
SPEC = {"social": {"dims": ["platform"]}, "search": {"dims": ["term"]}, "display": {"dims": ["platform", "region"]}}
SEED = 20261118

ds, items, truth = make_hier_dataset(seed=21, breakdowns=BREAKDOWNS)
main, long = hier_csvs(ds, items, {k: v["dims"] for k, v in SPEC.items()})
out = run_pipeline(main, {}, seed=SEED, settings={"breakdown": SPEC}, breakdown_bytes=long)
draws = out.pop("draws")
summary = out.pop("summary")
(out_dir / "breakdown-main.csv").write_bytes(main)
(out_dir / "breakdown-long.csv").write_bytes(long)
(out_dir / "breakdown-draws.json").write_text(json.dumps(draws, separators=(",", ":")))
(out_dir / "breakdown.json").write_text(json.dumps({
    "run": {"id": "sample", "name": "Breakdown example: channels split into platforms and regions", "status": "finished", "priors": {},
            "data_summary": summary, "seed": SEED, "created_at": "2026-11-18T00:00:00Z", "finished_at": "2026-11-18T00:01:00Z"},
    "result": {"run_id": "sample", **out, "draws_path": "sample/breakdown-draws.json"},
    "truth": truth.channel_roi,
    "item_truth": truth.item_roi,
}, separators=(",", ":")))
print(out["diagnostics"], {k: out["fit"][k] for k in ("r2", "mape", "holdout_mape")})
