import math

import numpy as np
import pytest

from kawkit_worker import model as M
from kawkit_worker.optimise import Curves, current_split, optimise, response_draws
from kawkit_worker.summarise import confidence_label, data_verdict, density, thin
from kawkit_worker.synth import make_dataset
from kawkit_worker.validate import validate_csv

# ---- priors

def test_roi_range_becomes_lognormal_with_matching_90_percent_interval():
    mu, sigma = M.roi_prior_params(0.8, 2.0)
    assert math.exp(mu - M.Z90 * sigma) == pytest.approx(0.8)
    assert math.exp(mu + M.Z90 * sigma) == pytest.approx(2.0)
    assert math.exp(mu) == pytest.approx(math.sqrt(0.8 * 2.0))
    for bad in [(0, 1), (2, 1), (-1, 2), (1, 1)]:
        with pytest.raises(M.ModelError):
            M.roi_prior_params(*bad)


def test_weeks_become_beta_with_ten_percent_left_after_n_weeks():
    assert M.carryover_prior_params(None) == (1.0, 3.0)
    a, b = M.carryover_prior_params(4)
    assert a + b == pytest.approx(20)
    mean = a / (a + b)
    assert mean**4 == pytest.approx(0.1)
    with pytest.raises(M.ModelError):
        M.carryover_prior_params(40)


def test_clean_priors_keeps_only_known_channels_and_valid_entries():
    out = M.clean_priors({"tv": {"roi_low": 0.8, "roi_high": 2, "note": "geo"}, "ghost": {"roi_low": 1, "roi_high": 2},
                          "search": {"carryover_weeks": 2}}, ["tv", "search", "social"])
    assert out == {"tv": {"roi_low": 0.8, "roi_high": 2.0, "note": "geo"}, "search": {"carryover_weeks": 2.0}, "social": {}}
    with pytest.raises(M.ModelError):
        M.clean_priors({"tv": {"roi_low": 0.8}}, ["tv"])


def test_impossible_roi_priors_are_rejected_before_sampling():
    ds = validate_csv(make_dataset(seed=3, weeks=80, n_channels=3)[0]).dataset
    design = M.build_design(ds)
    ok = M.check_priors_plausible(design, M.clean_priors({"tv": {"roi_low": 0.5, "roi_high": 2}}, ds.channels))
    assert 0 < ok["media_share_low"] < ok["media_share_high"]
    with pytest.raises(M.ModelError, match="impossible"):
        M.check_priors_plausible(design, M.clean_priors({c: {"roi_low": 50, "roi_high": 90} for c in ds.channels}, ds.channels))


# ---- transforms

def test_adstock_is_normalised_and_matches_definition():
    x = np.array([1.0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    a = M.adstock_np(x, 0.5)
    w = 0.5 ** np.arange(8)
    assert a[:8] == pytest.approx(w / w.sum())
    assert a[8] == 0
    steady = M.adstock_np(np.full(30, 0.7), 0.6)
    assert steady[10:] == pytest.approx(0.7)  # steady spend settles at the spend level


def test_transforms_match_pymc_marketing():
    from pymc_marketing.mmm import transformers as t

    rng = np.random.default_rng(0)
    x = rng.random(40)
    try:
        import pytensor.xtensor as px

        xt = px.as_xtensor(x, dims=("date",))
        ref_ad = t.geometric_adstock(xt, alpha=0.6, l_max=8, normalize=True, dim="date").eval()
        ref_sat = t.logistic_saturation(xt, lam=2.5).eval()
    except Exception as e:  # noqa: BLE001 - the library's calling convention changed between releases
        pytest.skip(f"pymc-marketing transformer API differs: {e}")
    assert M.adstock_np(x, 0.6) == pytest.approx(np.asarray(ref_ad), rel=1e-6, abs=1e-9)
    assert M.saturation_np(x, 2.5) == pytest.approx(np.asarray(ref_sat), rel=1e-6, abs=1e-9)


def test_design_scales_and_adds_seasonality_only_with_enough_weeks():
    short = M.build_design(validate_csv(make_dataset(seed=1, weeks=60, n_channels=2)[0]).dataset)
    long = M.build_design(validate_csv(make_dataset(seed=1, weeks=120, n_channels=2)[0]).dataset)
    assert short.fourier.shape[1] == 0 and long.fourier.shape[1] == 4
    assert long.xs.max(axis=0) == pytest.approx(1.0) and long.share.sum() == pytest.approx(1.0)
    held = M.build_design(validate_csv(make_dataset(seed=1, weeks=120, n_channels=2)[0]).dataset, holdout=13)
    assert held.n_fit == 107 and held.T == 120


def test_rhat_and_ess_behave():
    rng = np.random.default_rng(1)
    good = rng.normal(size=(4, 1000))
    r, e = M.rhat_ess(good)
    assert r < 1.01 and e > 2500
    bad = good + np.arange(4)[:, None] * 3  # chains that disagree
    r, e = M.rhat_ess(bad)
    assert r > 1.5 and e < 50
    sticky = np.cumsum(rng.normal(size=(4, 1000)), axis=1) * 0.05
    assert M.rhat_ess(sticky)[1] < 200


# ---- summaries

def test_labels():
    assert data_verdict(0.7) == "The data was decisive"
    assert data_verdict(0.3) == "The data refined the belief"
    assert data_verdict(0.1) == "This mostly reflects the prior"
    assert data_verdict(0.1, moved=True) == "The data overruled the starting assumption"
    assert confidence_label(0.9, 1.0, 1.3) == "high"
    assert confidence_label(0.6, 1.0, 1.4) == "medium"
    assert confidence_label(0.2, 1.0, 2.0) == "low"


def test_thin_and_density():
    post = {"sigma": np.arange(4000.0), "beta": np.zeros((4000, 3))}
    t = thin(post)
    assert len(t["sigma"]) == 500 and t["beta"].shape == (500, 3) and t["sigma"][-1] == 3999
    grid = np.exp(np.linspace(-2, 2, 60))
    d = density(np.random.default_rng(0).lognormal(0, 0.3, 2000), grid)
    assert d.max() == pytest.approx(1.0) and 0.8 < grid[d.argmax()] < 1.25


# ---- optimiser

def fixed_draws(beta, lam, xmax, ymax=1000.0):
    return {"channels": [f"c{i}" for i in range(len(beta))], "ymax": ymax, "xmax": np.array(xmax, float),
            "beta": np.array([beta], float), "lam": np.array([lam], float)}


def test_optimiser_spends_exactly_the_budget_and_respects_limits():
    rng = np.random.default_rng(2)
    draws = {"channels": list("abcde"), "ymax": 5e5, "xmax": rng.uniform(1e4, 5e4, 5),
             "beta": np.abs(rng.normal(0.2, 0.08, (300, 5))), "lam": rng.gamma(3, 1, (300, 5))}
    current = rng.uniform(5e3, 3e4, 5)
    for budget in (None, current.sum() * 0.8, current.sum() * 1.3):
        plan = optimise(draws, current, budget)
        rec = np.array(plan["recommended"])
        assert rec.sum() == pytest.approx(plan["budget"], rel=1e-9)
        assert np.all(rec >= np.array(plan["lower"]) - 1e-6) and np.all(rec <= np.array(plan["upper"]) + 1e-6)
    plan = optimise(draws, current)
    assert plan["expected_recommended"] >= plan["expected_current"] - 1e-9
    assert 0 <= plan["prob_better"] <= 1 and plan["lift"]["low"] <= plan["lift"]["mean"] <= plan["lift"]["high"]


def test_optimiser_matches_brute_force_on_two_channels():
    for beta, lam, xmax, budget in [((0.5, 0.3), (3.0, 1.5), (100.0, 80.0), 120.0),
                                    ((0.2, 0.6), (5.0, 2.0), (50.0, 200.0), 160.0),
                                    ((0.4, 0.4), (1.0, 6.0), (100.0, 100.0), 90.0)]:
        draws = fixed_draws(beta, lam, xmax)
        lower, upper = np.array([10.0, 10.0]), np.array([150.0, 150.0])
        plan = optimise(draws, np.array([budget / 2, budget / 2]), budget, lower, upper)

        def value(x0):
            return float(response_draws(draws, 0, x0)[0, 0] + response_draws(draws, 1, budget - x0)[0, 0])

        grid = np.linspace(max(lower[0], budget - upper[1]), min(upper[0], budget - lower[1]), 200001)
        best = max(value(x) for x in grid[::20])
        got = value(plan["recommended"][0])
        assert got >= best * (1 - 1e-3), (got, best)
        assert got <= best * (1 + 1e-6) + 1e-9


def test_optimiser_explains_impossible_budgets_and_flags_extrapolation():
    draws = fixed_draws((0.5, 0.3), (3.0, 1.5), (100.0, 80.0))
    cur = np.array([60.0, 40.0])
    low = optimise(draws, cur, 10.0)
    assert low["budget"] == pytest.approx(50.0) and "below" in low["notes"][0]
    high = optimise(draws, cur, 1000.0)
    assert high["budget"] == pytest.approx(150.0) and "above" in high["notes"][0]
    big = optimise(draws, cur, 300.0, np.array([0.0, 0.0]), np.array([250.0, 250.0]), max_weekly=np.array([100.0, 80.0]))
    assert any(big["extrapolated"])
    locked = optimise(draws, cur, 100.0, np.array([60.0, 0.0]), np.array([60.0, 100.0]))
    assert locked["recommended"][0] == pytest.approx(60.0) and locked["recommended"][1] == pytest.approx(40.0)


def test_current_split_is_last_13_weeks_and_curves_interpolate():
    spend = np.arange(40.0).reshape(20, 2)
    assert current_split(spend) == pytest.approx(spend[-13:].mean(axis=0))
    draws = fixed_draws((0.5,), (3.0,), (100.0,))
    c = Curves(draws, np.array([200.0]))
    assert c.value(0, 77.0) == pytest.approx(float(response_draws(draws, 0, 77.0)[0, 0]), rel=1e-4)


def test_channel_with_no_spend_in_the_fitting_window_still_fits():
    """Found on real data: a channel that only starts spending in the held-out weeks."""
    import io

    import pandas as pd

    df = pd.read_csv(io.StringIO(make_dataset(seed=5, weeks=70, n_channels=2)[0]))
    df["spend_late"] = 0.0
    df.loc[df.index[-6:], "spend_late"] = 5000.0
    ds = validate_csv(df.to_csv(index=False)).dataset
    held = M.build_design(ds, holdout=13)
    assert held.share[2] == 0 and held.beta_scale[2] > 0
    fit = M.fit(held, M.clean_priors({}, ds.channels), seed=3, chains=2, draws=100, tune=150, retry_on_caution=False)
    assert np.isfinite(fit.post["beta"]).all()


def test_default_prior_gives_every_channel_the_same_plausible_roi():
    """The default prior centres each channel's ROI where media as a whole explains 30% of revenue."""
    from kawkit_worker.summarise import prior_roi_draws

    ds = validate_csv(make_dataset(seed=7)[0]).dataset
    design = M.build_design(ds)
    assert design.roi_centre == pytest.approx(0.3 * ds.y.sum() / ds.spend.sum())
    rng = np.random.default_rng(0)
    medians = [np.median(prior_roi_draws(design, {}, c, 3000, rng)) for c in range(len(ds.channels))]
    highs = [np.percentile(prior_roi_draws(design, {}, c, 3000, rng), 95) for c in range(len(ds.channels))]
    assert max(medians) / min(medians) < 1.6  # same starting point for every channel
    assert all(0.5 * design.roi_centre < m < 1.6 * design.roi_centre for m in medians)
    # no single channel's prior should plausibly exceed all revenue
    assert all(h * ds.spend[:, c].sum() < ds.y.sum() for c, h in enumerate(highs))


def test_benchmark_picks_the_better_simple_forecast():
    from kawkit_worker.pipeline import benchmark, wape

    y = np.tile(np.r_[np.full(26, 100.0), np.full(26, 200.0)], 2)  # a strong yearly cycle
    b = benchmark(y, 78)  # held-out weeks are high, the 13 before them low: only last year gets it right
    assert b["method"].startswith("the same weeks a year earlier") and b["wape"] < 1
    flat = np.full(70, 50.0)
    assert benchmark(flat, 57)["method"] == "the average of the previous 13 weeks"
    assert wape(np.array([100.0, 100.0]), np.array([90.0, 120.0])) == pytest.approx(15.0)
