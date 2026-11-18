"""Fixture for the item optimiser parity test: item-level draws and the python plans for both modes.
Run: uv run python -m scripts.make_item_fixture"""
import json
from pathlib import Path

import numpy as np

from kawkit_worker.optimise import optimise_items

OUT = Path(__file__).resolve().parent.parent.parent / "web" / "src" / "optimizer" / "items.fixture.json"


def build(d=120, seed=3):
    rng = np.random.default_rng(seed)
    spec = [[(40, 0.35, 0.03), (60, 0.05, 0.03)], [(50, 0.1, 0.9), (50, 0.1, 0.9)], [(30, 0.2, 0.05), (20, 0.2, 0.05), (10, 0.1, 0.05)]]
    names, chan, cur, betas, xmax = [], [], [], [], []
    for c, items in enumerate(spec):
        cmax = max(v[0] for v in items) * 3
        for k, (spend, beta, sd) in enumerate(items):
            names.append(f"ch{c}/i{k}")
            chan.append(c)
            cur.append(spend)
            betas.append(beta * np.exp(rng.normal(0, sd, d)))
            xmax.append(cmax)
    n = len(names)
    return {
        "channels": names, "ymax": 1000.0, "xmax": np.array(xmax, dtype=float), "max_weekly": np.array(cur) * 2.0,
        "current": np.array(cur, dtype=float), "beta": np.round(np.stack(betas, axis=1), 6),
        "lam": np.round(np.full((d, n), 2.5) * np.exp(rng.normal(0, 0.05, (d, n))), 6), "alpha": np.full((d, n), 0.3),
        "groups": {"channel_names": [f"ch{c}" for c in range(len(spec))], "channel_of": chan},
    }


def main():
    draws = build()
    cur = draws["current"]
    plans = {m: optimise_items(draws, cur, m) for m in ("keep", "resplit")}

    def plain(o):
        if isinstance(o, np.ndarray):
            return o.tolist()
        raise TypeError(type(o))

    OUT.write_text(json.dumps({"draws": draws, "plans": plans}, default=plain))
    print("wrote", OUT, {m: round(p["lift"]["mean"], 3) for m, p in plans.items()})


if __name__ == "__main__":
    main()
