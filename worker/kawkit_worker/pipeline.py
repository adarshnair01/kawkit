"""One run from CSV bytes to results: validate, check priors, fit, holdout fit, summarise."""

from __future__ import annotations

from typing import Callable

import numpy as np

from . import model as M
from .summarise import mape, predict, summarise
from .validate import validate_csv

HOLDOUT_WEEKS = 13


def run_pipeline(csv_bytes: bytes, priors: dict | None, seed: int, settings: dict | None = None,
                 on_progress: Callable[[float], None] | None = None,
                 should_stop: Callable[[], bool] | None = None, cores: int | None = None) -> dict:
    settings = settings or {}
    draws = int(min(max(settings.get("draws", 1000), 100), 2000))
    tune = int(min(max(settings.get("tune", 1000), 100), 2000))
    chains = int(min(max(settings.get("chains", 4), 2), 4))

    def progress(lo: float, hi: float) -> Callable[[float], None] | None:
        if on_progress is None:
            return None
        return lambda p: on_progress(lo + (hi - lo) * p)

    v = validate_csv(csv_bytes)
    if not v.ok:
        raise M.ModelError("The file did not pass the server's checks: " + " ".join(e["message"] for e in v.errors[:3]))
    ds = v.dataset
    clean = M.clean_priors(priors, ds.channels)
    design = M.build_design(ds)
    prior_check = M.check_priors_plausible(design, clean)
    if on_progress:
        on_progress(0.03)

    fit = M.fit(design, clean, seed=seed, chains=chains, draws=draws, tune=tune, cores=cores,
                on_progress=progress(0.03, 0.75), should_stop=should_stop)
    if on_progress:
        on_progress(0.75)

    # out-of-sample error: fit again without the last 13 weeks, predict them
    holdout_mape = None
    holdout = None
    if len(ds.y) - HOLDOUT_WEEKS >= 52:
        hd = M.build_design(ds, holdout=HOLDOUT_WEEKS)
        hfit = M.fit(hd, clean, seed=seed + 7, chains=2, draws=max(draws // 2, 100), tune=max(tune // 2, 100),
                     cores=cores, retry_on_caution=False, on_progress=progress(0.75, 0.93), should_stop=should_stop)
        mu, _ = predict(hd, hfit.post)
        holdout_mape = mape(ds.y[hd.n_fit:], mu.mean(axis=0)[hd.n_fit:])
        # what the model, fitted without these weeks, predicted for them
        tail = mu[:, hd.n_fit:]
        rng = np.random.default_rng(seed + 11)
        noisy = tail + rng.normal(0, 1, tail.shape) * hfit.post["sigma"][:, None] * hd.ymax
        lo, hi = np.percentile(noisy, [5, 95], axis=0)
        actual = ds.y[hd.n_fit:]
        holdout = {
            "dates": ds.dates[hd.n_fit:],
            "actual": [float(v) for v in actual],
            "predicted": [float(v) for v in tail.mean(axis=0)],
            "low": [float(v) for v in lo],
            "high": [float(v) for v in hi],
            "inside": int(np.sum((actual >= lo) & (actual <= hi))),
            "total_error_pct": float((tail.mean(axis=0).sum() - actual.sum()) / actual.sum() * 100),
        }
    if on_progress:
        on_progress(0.94)

    out = summarise(fit, holdout_mape, seed)
    out["diagnostics"]["prior_check"] = prior_check
    out["fit"]["holdout"] = holdout
    out["summary"] = v.summary
    assert np.isfinite(out["fit"]["r2"])
    return out
