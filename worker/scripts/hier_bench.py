"""Known-truth calibration and timing for the hierarchical (breakdown) model.
Run: uv run python -m scripts.hier_bench [scenario-substring ...]"""
import os
import sys
import time

import numpy as np

from kawkit_worker import hier as H
from kawkit_worker.synth import make_hier_dataset

B = lambda mix, dims, items: dict(mix=mix, dims=dims, items=items)  # noqa: E731
SCENARIOS = {
    "A separable platforms": dict(breakdowns={"social": B("varied", ["platform"], [("meta", 2.6), ("tiktok", 1.3), ("youtube", 0.5)])}),
    "B inseparable (fixed mix)": dict(breakdowns={"search": B("fixed", ["term"], [("brand", 2.4), ("nonbrand", 0.9)])}),
    "C platform x region": dict(breakdowns={"display": B("varied", ["platform", "region"], [("a", "uk", 1.6), ("a", "us", 2.4), ("b", "uk", 0.8), ("b", "us", 1.2)])}),
    "D wide (15 items)": dict(breakdowns={
        "tv": B("varied", ["daypart"], [("prime", 1.8), ("day", 0.9)]),
        "search": B("varied", ["term"], [("brand", 2.4), ("generic", 1.2), ("competitor", 0.6)]),
        "social": B("varied", ["platform"], [("meta", 2.2), ("tiktok", 1.1), ("youtube", 0.7), ("x", 0.4)]),
        "display": B("varied", ["type"], [("prog", 1.0), ("direct", 1.8), ("native", 1.3)]),
        "email": B("varied", ["type"], [("promo", 2.8), ("news", 1.4), ("lifecycle", 2.0)])}),
    "E wrong assumption (item lam differs)": dict(lam_spread=0.5, breakdowns={"social": B("varied", ["platform"], [("meta", 2.6), ("tiktok", 1.3), ("youtube", 0.5)])}),
}


def one(cfg, seed, holdout_check=True):
    ds, items, truth = make_hier_dataset(seed=seed, **cfg)
    res = {}
    for label, it in (("hier", items), ("flat", H.single_items(ds.channels, ds.spend))):
        hd = H.build_hier_design(ds, it)
        t0 = time.time()
        f = H.fit_hier(hd, {}, seed=1, cores=4, retry_on_caution=False)
        r = dict(secs=time.time() - t0, diag=f.diagnostics)
        r["item_roi"], r["chan_roi"] = H.roi_draws(hd, f.post)
        r["tau"] = np.median(f.post["tau"], axis=0) if "tau" in f.post else None
        if holdout_check:
            hh = H.build_hier_design(ds, it, holdout=13)
            hf = H.fit_hier(hh, {}, seed=2, draws=500, tune=500, chains=2, cores=4, retry_on_caution=False)
            mu = H.predict_hier(hh, hf.post).mean(axis=0)[hh.n_fit:]
            act = ds.y[hh.n_fit:]
            r["wape"] = float(np.abs(act - mu).sum() / act.sum() * 100)
        res[label] = r
    return ds, items, truth, res


def main(only, seeds):
    for name, cfg in SCENARIOS.items():
        if only and not any(o in name for o in only):
            continue
        s = dict(item_hit=0, item_n=0, chan_hit=0, chan_n=0, order=[], wape_h=[], wape_f=[], secs_h=[], secs_f=[], flat_chan_hit=0, bad=0)
        for seed in seeds:
            ds, items, truth, res = one(cfg, seed)
            h, f = res["hier"], res["flat"]
            idx = [i for i in range(items.n) if items.level_of[i]]
            for i in idx:
                lo, hi = np.percentile(h["item_roi"][:, i], [5, 95])
                s["item_n"] += 1
                s["item_hit"] += lo <= truth.item_roi[items.names[i]] <= hi
            for c, ch in enumerate(ds.channels):
                lo, hi = np.percentile(h["chan_roi"][:, c], [5, 95])
                s["chan_n"] += 1
                s["chan_hit"] += lo <= truth.channel_roi[ch] <= hi
                lo, hi = np.percentile(f["chan_roi"][:, c], [5, 95])
                s["flat_chan_hit"] += lo <= truth.channel_roi[ch] <= hi
            # does the model rank the best item above the worst in each broken-down channel?
            for c in set(items.channel[idx]):
                mem = [i for i in idx if items.channel[i] == c]
                best = max(mem, key=lambda i: truth.item_roi[items.names[i]])
                worst = min(mem, key=lambda i: truth.item_roi[items.names[i]])
                s["order"].append(float((h["item_roi"][:, best] > h["item_roi"][:, worst]).mean()))
            s["wape_h"].append(h["wape"])
            s["wape_f"].append(f["wape"])
            s["secs_h"].append(h["secs"])
            s["secs_f"].append(f["secs"])
            s["bad"] += h["diag"]["verdict"] != "pass"
            print(f"  {name[:22]:22s} seed {seed}: hier {h['secs']:.0f}s {h['diag']['verdict']} div={h['diag']['divergences']} | holdout {h['wape']:.2f}% vs flat {f['wape']:.2f}%",
                  flush=True)
        print(f"== {name}: item intervals {s['item_hit']}/{s['item_n']}, "
              f"channel intervals hier {s['chan_hit']}/{s['chan_n']} vs flat {s['flat_chan_hit']}/{s['chan_n']}, "
              f"P(best>worst) mean {np.mean(s['order']):.2f} (min {np.min(s['order']):.2f}), holdout WAPE hier {np.mean(s['wape_h']):.2f}% vs flat {np.mean(s['wape_f']):.2f}%, "
              f"time hier {np.mean(s['secs_h']):.0f}s vs flat {np.mean(s['secs_f']):.0f}s, non-pass {s['bad']}/{len(seeds)}\n", flush=True)


if __name__ == "__main__":
    H.TAU_SCALE = float(os.environ.get("TAU_SCALE", H.TAU_SCALE))
    main(sys.argv[1:], seeds=(1, 2, 3, 4, 5, 6))
