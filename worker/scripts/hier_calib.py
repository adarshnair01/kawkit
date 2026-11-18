"""Collect item log-ROI quantiles against the truth, to calibrate how wide item ranges should be.
Run: uv run python -m scripts.hier_calib out.json [seed ...]"""
import json
import sys

import numpy as np

from kawkit_worker import hier as H
from kawkit_worker.synth import make_hier_dataset
from scripts.hier_bench import SCENARIOS

QS = list(range(1, 100))


def main(out, seeds):
    rows = []
    for name, cfg in SCENARIOS.items():
        for seed in seeds:
            ds, items, truth = make_hier_dataset(seed=seed, **cfg)
            hd = H.build_hier_design(ds, items)
            f = H.fit_hier(hd, {}, seed=1, cores=4, retry_on_caution=False)
            item_roi, _ = H.roi_draws(hd, f.post)
            for i in range(items.n):
                if not items.level_of[i]:
                    continue
                rows.append(dict(scenario=name, seed=seed, item=items.names[i], truth=truth.item_roi[items.names[i]],
                                 q=[float(v) for v in np.percentile(np.log(item_roi[:, i]), QS)],
                                 verdict=f.diagnostics["verdict"]))
            json.dump(rows, open(out, "w"))
            print(name, seed, len(rows), flush=True)


if __name__ == "__main__":
    main(sys.argv[1], [int(s) for s in sys.argv[2:]] or list(range(7, 17)))
