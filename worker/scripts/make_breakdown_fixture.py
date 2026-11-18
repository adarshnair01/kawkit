"""Fixture for the breakdown parity test: main and long CSVs plus what the python parser makes of them.
Run: uv run python -m scripts.make_breakdown_fixture"""
import json
from pathlib import Path

from kawkit_worker.breakdown import build_items
from kawkit_worker.synth import hier_csvs, make_hier_dataset
from kawkit_worker.validate import validate_csv

OUT = Path(__file__).resolve().parent.parent.parent / "web" / "src" / "breakdown" / "fixture.json"
B = {
    "social": dict(mix="varied", dims=["platform"], items=[("meta", 2.6), ("tiktok", 1.3), ("youtube", 0.5)]),
    "display": dict(mix="varied", dims=["platform", "region"], items=[("a", "uk", 1.6), ("a", "us", 2.4), ("b", "uk", 0.8), ("b", "us", 1.2)]),
    "search": dict(mix="fixed", dims=["platform"], items=[("brand", 2.4), ("nonbrand", 0.9)]),
}
SPEC = {"social": {"dims": ["platform"]}, "display": {"dims": ["platform", "region"]}, "search": {"dims": ["platform"]}}


def main():
    ds, items, _ = make_hier_dataset(seed=3, breakdowns=B)
    main_csv, long_csv = hier_csvs(ds, items, {"social": ["platform"], "display": ["platform", "region"], "search": ["platform"]})
    v = validate_csv(main_csv)
    r = build_items(v.dataset, long_csv, SPEC)
    OUT.write_text(json.dumps({
        "main": main_csv.decode(), "long": long_csv.decode(), "spec": SPEC,
        "items": [{"name": n, "channel": int(c), "total": float(r.items.spend[:, i].sum())} for i, (n, c) in enumerate(zip(r.items.names, r.items.channel))],
        "groups": [{"dim": g.dim, "levels": g.levels} for g in r.items.groups],
    }))
    print("wrote", OUT, r.items.n, "items")


if __name__ == "__main__":
    main()
