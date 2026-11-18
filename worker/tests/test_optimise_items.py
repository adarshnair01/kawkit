import numpy as np
import pytest

from kawkit_worker.optimise import optimise, optimise_items


def item_draws(spec, d=300, seed=0, noise=0.05):
    """spec: list of channels, each a list of (current spend, beta, beta noise sd). Item-level draws."""
    rng = np.random.default_rng(seed)
    names, chan, cur, betas, xmax = [], [], [], [], []
    for c, items in enumerate(spec):
        cmax = max(v[0] for v in items) * 3
        for k, (spend, beta, sd) in enumerate(items):
            names.append(f"ch{c}/i{k}")
            chan.append(c)
            cur.append(spend)
            betas.append(beta * np.exp(rng.normal(0, sd if sd is not None else noise, d)))
            xmax.append(cmax)
    n = len(names)
    return {
        "channels": names, "ymax": 1000.0, "xmax": np.array(xmax), "max_weekly": np.array(cur) * 2.0, "current": np.array(cur),
        "beta": np.stack(betas, axis=1), "lam": np.full((d, n), 2.5),
        "groups": {"channel_names": [f"ch{c}" for c in range(len(spec))], "channel_of": chan},
    }, np.array(cur, dtype=float)


def test_keep_mode_keeps_every_items_share_and_the_budget():
    dr, cur = item_draws([[(40, 0.30, None), (60, 0.05, None)], [(50, 0.1, None), (50, 0.1, None)]])
    plan = optimise_items(dr, cur, mode="keep")
    rec = np.array(plan["recommended"])
    assert rec.sum() == pytest.approx(cur.sum(), rel=1e-6)
    for m in ([0, 1], [2, 3]):
        assert rec[m] / rec[m].sum() == pytest.approx(cur[m] / cur[m].sum(), rel=1e-6)
    assert plan["expected_recommended"] >= plan["expected_current"]
    assert plan["lift_within"] == pytest.approx(0.0, abs=1e-9)


def test_resplit_moves_money_to_the_clearly_better_item():
    dr, cur = item_draws([[(50, 0.40, 0.03), (50, 0.05, 0.03)], [(50, 0.10, 0.03), (50, 0.10, 0.03)]])
    plan = optimise_items(dr, cur, mode="resplit")
    rec = np.array(plan["recommended"])
    # the better item takes the most the share limit allows: 50% x 1.25 of its channel
    assert rec[0] / (rec[0] + rec[1]) == pytest.approx(0.625, rel=1e-3)
    assert plan["by_channel"][0]["items_resplit"] is True
    assert plan["lift_within"] > 0
    assert rec.sum() == pytest.approx(cur.sum(), rel=1e-6)
    assert plan["prob_better"] > 0.9


def test_resplit_holds_the_mix_when_the_data_cannot_separate_the_items():
    # identical means, very uncertain scales: any move is a coin flip
    dr, cur = item_draws([[(50, 0.20, 0.9), (50, 0.20, 0.9)], [(50, 0.1, 0.03), (50, 0.1, 0.03)]], d=400)
    plan = optimise_items(dr, cur, mode="resplit")
    assert plan["by_channel"][0]["items_resplit"] is False
    assert plan["by_channel"][0]["p_resplit_helps"] < 0.8
    assert any("cannot tell its items apart" in n for n in plan["notes"])
    rec = np.array(plan["recommended"])
    assert rec[0] / (rec[0] + rec[1]) == pytest.approx(0.5, rel=1e-6)


def test_one_item_per_channel_matches_the_channel_optimiser():
    dr, cur = item_draws([[(40, 0.30, None)], [(60, 0.12, None)], [(30, 0.2, None)]])
    flat = optimise({k: dr[k] for k in ("channels", "ymax", "xmax", "max_weekly", "beta", "lam")}, cur)
    hier = optimise_items(dr, cur, mode="keep")
    assert hier["recommended"] == pytest.approx(flat["recommended"], rel=0.02, abs=0.2)


def test_never_recommends_less_than_current_when_current_is_feasible():
    dr, cur = item_draws([[(50, 0.2, None), (50, 0.2, None)], [(50, 0.2, None), (50, 0.2, None)]])
    plan = optimise_items(dr, cur, mode="resplit")
    assert plan["expected_recommended"] >= plan["expected_current"] - 1e-9
