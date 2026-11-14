"""Known-truth recovery on synthetic datasets (slow). Run with:  uv run pytest -m slow

Acceptance: convergence gates pass on every dataset, the 90% interval contains the true ROI for
at least 80% of channels across all datasets, held-out error stays under 3%, a correct informative
prior narrows the interval, and a wrong prior shows up as a conflict.
"""

import numpy as np
import pytest

from kawkit_worker.pipeline import run_pipeline
from kawkit_worker.synth import make_dataset

pytestmark = pytest.mark.slow

DATASETS = [
    dict(seed=7, weeks=156, n_channels=5),   # the sample
    dict(seed=21, weeks=156, n_channels=4),
    dict(seed=33, weeks=130, n_channels=6, noise=0.015),
    # a larger baseline, so that media stays under half of revenue as the model's prior expects
    dict(seed=48, weeks=156, n_channels=10, noise=0.02, base_level=800_000.0),
]


@pytest.fixture(scope="module")
def fits():
    out = []
    for cfg in DATASETS:
        csv, truth = make_dataset(**cfg)
        out.append((cfg, truth, run_pipeline(csv.encode(), {}, seed=1234)))
    return out


def test_datasets_have_a_realistic_baseline():
    """The model expects the baseline to be 50% to 90% of revenue; the test data must respect that."""
    import io

    import pandas as pd

    for cfg in DATASETS:
        csv, truth = make_dataset(**cfg)
        share = 1 - sum(truth.contribution.values()) / pd.read_csv(io.StringIO(csv)).revenue.sum()
        assert 0.5 <= share <= 0.9, (cfg, share)


def test_convergence_gates(fits):
    for cfg, _, res in fits:
        d = res["diagnostics"]
        assert d["max_rhat"] <= 1.01, (cfg, d)
        assert d["min_ess_bulk"] >= 400, (cfg, d)
        assert d["divergence_pct"] < 0.1, (cfg, d)
        assert d["verdict"] == "pass"


def test_intervals_contain_the_true_roi_for_most_channels(fits):
    hit = total = 0
    for _, truth, res in fits:
        for c in res["channels"]:
            total += 1
            hit += c["roi"]["low"] <= truth.roi[c["name"]] <= c["roi"]["high"]
    assert hit / total >= 0.8, f"{hit}/{total}"


def test_out_of_sample_error(fits):
    for cfg, _, res in fits:
        assert res["fit"]["holdout_mape"] < 3.0, (cfg, res["fit"]["holdout_mape"])
        assert res["fit"]["r2"] > 0.9


def test_optimiser_never_worse_than_current(fits):
    for _, _, res in fits:
        p = res["default_plan"]
        assert p["expected_recommended"] >= p["expected_current"]
        assert sum(p["recommended"]) == pytest.approx(p["budget"], rel=1e-9)


def test_same_seed_gives_same_posterior_summary():
    csv, _ = make_dataset(seed=21, weeks=104, n_channels=3)
    settings = {"draws": 400, "tune": 400}
    a = run_pipeline(csv.encode(), {}, seed=99, settings=settings)
    b = run_pipeline(csv.encode(), {}, seed=99, settings=settings)
    assert [c["roi"] for c in a["channels"]] == [c["roi"] for c in b["channels"]]


def test_correct_prior_narrows_and_wrong_prior_conflicts(fits):
    cfg, truth, base = fits[0]
    csv, _ = make_dataset(**cfg)
    ch = "search"  # the widest interval in the sample
    t = truth.roi[ch]
    width = lambda res: next(c["roi"]["high"] - c["roi"]["low"] for c in res["channels"] if c["name"] == ch)  # noqa: E731

    good = run_pipeline(csv.encode(), {ch: {"roi_low": t * 0.85, "roi_high": t * 1.15}}, seed=1234)
    assert width(good) < 0.8 * width(base)
    g = next(c for c in good["channels"] if c["name"] == ch)
    assert g["roi"]["low"] <= t <= g["roi"]["high"] and not g["prior"]["conflict"]

    wrong = run_pipeline(csv.encode(), {"email": {"roi_low": 0.2, "roi_high": 0.4}}, seed=1234)
    w = next(c for c in wrong["channels"] if c["name"] == "email")
    assert w["prior"]["source"] == "yours"
    assert w["prior"]["conflict"], w["roi"]
    assert np.isfinite(w["roi"]["median"])
