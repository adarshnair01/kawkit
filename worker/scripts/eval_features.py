"""Which baseline features reduce error on unseen weeks? Rolling-origin test on the real examples.

    uv run python scripts/eval_features.py conjura_mmm_data.csv external_dir out.json [brand ...]

For each brand and feature set, the model is fitted three times, each time hiding a different
13-week block at the end (weeks -39..-27, -26..-14, -13..-1 are predicted in turn from the data
before them), and the error on the hidden block is recorded. WAPE is total absolute error over
total revenue, which is not distorted by weeks with very low sales the way MAPE is.
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from conjura_features import SERIES, build, select  # noqa: E402

from kawkit_worker import model as M  # noqa: E402
from kawkit_worker.summarise import predict  # noqa: E402
from kawkit_worker.validate import validate_csv  # noqa: E402

SETS = {
    "none": [], "events": ["events"], "promo": ["promo"], "weather": ["weather"], "macro": ["macro"],
    "events+promo": ["events", "promo"], "events+promo+macro": ["events", "promo", "macro"],
    "all": ["events", "promo", "weather", "macro"],
}
CHOSEN = {"home": ["events", "promo"], "beauty": ["events", "promo"], "apparel": ["events", "promo", "macro"],
          "food": ["events", "promo", "macro"], "health": ["events"]}
if len(sys.argv) > 4 and sys.argv[4] == "brand_search":
    sys.argv.pop(4)
    SETS = {"chosen": [], "chosen+brand_search": ["brand_search"], "chosen+brand_search_lag": ["brand_search_lag"]}
elif len(sys.argv) > 4 and sys.argv[4] == "category_search":
    sys.argv.pop(4)
    SETS = {"chosen": [], "chosen+category_search": ["category_search"]}
elif len(sys.argv) > 4 and sys.argv[4].startswith("only="):
    SETS = {k: SETS[k] for k in sys.argv.pop(4)[5:].split(",")}

df = pd.read_csv(sys.argv[1], parse_dates=["DATE_DAY"])
external = Path(sys.argv[2])
brands = sys.argv[4:] or list(SERIES)
results = {}
for slug in brands:
    frame, _ = build(df, slug, external)
    results[slug] = {}
    sets = dict(SETS)
    if "chosen" in sets or any(k.startswith("chosen") for k in sets):
        sets = {k: CHOSEN[slug] + v for k, v in sets.items()}
    for name, groups in sets.items():
        ds = validate_csv(select(frame, groups)).dataset
        ape, abs_err, total = [], 0.0, 0.0
        for fold in (3, 2, 1):
            design = M.build_design(ds, holdout=13 * fold)
            fit = M.fit(design, M.clean_priors({}, ds.channels), seed=100 + fold, chains=2, draws=400, tune=600,
                        retry_on_caution=False)
            mu, contrib = predict(design, fit.post)
            media_share = float(np.median(contrib[:, : design.n_fit].sum(axis=(1, 2))) / ds.y[: design.n_fit].sum())
            sl = slice(design.n_fit, design.n_fit + 13)
            actual, pred = ds.y[sl], mu.mean(axis=0)[sl]
            ape.extend(np.abs((actual - pred) / actual))
            abs_err += float(np.abs(actual - pred).sum())
            total += float(actual.sum())
        results[slug][name] = {"mape": round(float(np.mean(ape)) * 100, 1), "wape": round(abs_err / total * 100, 1),
                               "media_share_last_fold": round(media_share, 3), "controls": ds.control_names}
        print(slug, name, results[slug][name], flush=True)
    Path(sys.argv[3]).with_suffix(f".{slug}.json").write_text(json.dumps(results[slug]))
