"""End-to-end calibration of the item ranges the product shows (widening applied), on fresh seeds.
Run: uv run python -m scripts.hier_pipeline_check 31 32 33 ..."""
import sys

from kawkit_worker.pipeline import run_pipeline
from kawkit_worker.synth import hier_csvs, make_hier_dataset
from scripts.hier_bench import B

BREAKDOWNS = {
    "social": B("varied", ["platform"], [("meta", 2.6), ("tiktok", 1.3), ("youtube", 0.5)]),
    "search": B("fixed", ["term"], [("brand", 2.4), ("nonbrand", 0.9)]),
    "display": B("varied", ["platform", "region"], [("a", "uk", 1.6), ("a", "us", 2.4), ("b", "uk", 0.8), ("b", "us", 1.2)]),
}
SPEC = {"social": {"dims": ["platform"]}, "search": {"dims": ["term"]}, "display": {"dims": ["platform", "region"]}}


def main(seeds):
    hit = n = 0
    chan_hit = chan_n = 0
    orders = []
    for seed in seeds:
        ds, items, truth = make_hier_dataset(seed=seed, breakdowns=BREAKDOWNS)
        main_csv, long_csv = hier_csvs(ds, items, {k: v["dims"] for k, v in SPEC.items()})
        out = run_pipeline(main_csv, {}, seed=seed, settings={"breakdown": SPEC}, breakdown_bytes=long_csv)
        # items the parser folded into "Other" or "Not broken down" have no single true ROI: skip them
        got = {i["name"]: i for c in out["breakdown"]["channels"] for i in c["items"] if i["name"] in truth.item_roi}
        h = 0
        for name, it in got.items():
            t = truth.item_roi[name]
            h += it["roi"]["low"] <= t <= it["roi"]["high"]
        hit += h
        n += len(got)
        for c in out["channels"]:
            chan_n += 1
            chan_hit += c["roi"]["low"] <= truth.channel_roi[c["name"]] <= c["roi"]["high"]
        for ch in out["breakdown"]["channels"]:
            names = [i["name"] for i in ch["items"] if i["name"] in truth.item_roi]
            if len(names) < 2:
                continue
            best = max(names, key=lambda x: truth.item_roi[x])
            worst = min(names, key=lambda x: truth.item_roi[x])
            orders.append((ch["name"], got[best]["roi"]["median"] > got[worst]["roi"]["median"]))
        print(f"seed {seed}: items {h}/{len(got)} verdict {out['diagnostics']['verdict']}", flush=True)
    print(f"items {hit}/{n} = {hit / n:.2f}; channels {chan_hit}/{chan_n}; best>worst by median: "
          f"{ {c: sum(o for k, o in orders if k == c) for c in sorted({k for k, _ in orders})} } of {len(seeds)}")


if __name__ == "__main__":
    main([int(s) for s in sys.argv[1:]] or [31, 32, 33, 34, 35, 36])
