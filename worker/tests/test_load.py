"""Load: 10 runs submitted at once by 5 users all finish, and no user gets ahead of the others by
more than one run. Needs a worker already running against the project (the Mac mini, or a local one).
    KAWKIT_SERVICE_KEY=... uv run pytest -m load -s
"""

import time

import pytest

pytestmark = pytest.mark.load

SMALL = {"draws": 300, "tune": 400, "chains": 2}


def test_ten_runs_from_five_users_finish_in_fair_order(make_user, sample_csv):
    users = [make_user() for _ in range(5)]
    runs = []
    for round_ in range(2):
        for u in users:
            run_id, r = u.submit(sample_csv, f"load {round_}", settings=SMALL)
            assert r.status_code == 200, r.text
            runs.append((u, run_id, round_))

    started = time.time()
    rows = {}
    while time.time() - started < 1800:
        rows = {rid: u.get("runs", f"select=status,started_at,finished_at,error&id=eq.{rid}").json()[0] for u, rid, _ in runs}
        if all(r["status"] in ("finished", "failed") for r in rows.values()):
            break
        time.sleep(10)
    assert all(r["status"] == "finished" for r in rows.values()), [r for r in rows.values() if r["status"] != "finished"]

    first = [rows[rid]["started_at"] for _, rid, rnd in runs if rnd == 0]
    second = [rows[rid]["started_at"] for _, rid, rnd in runs if rnd == 1]
    # every user's first run starts before anyone's second run
    assert max(first) <= min(second), (sorted(first), sorted(second))
    print(f"\n10 runs finished in {time.time() - started:.0f} s")
