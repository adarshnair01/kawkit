"""Integration: the real queue and a real worker process. Submit to finished, fairness, cancel,
and a worker killed mid-run followed by an automatic retry. Uses small model settings."""

import os
import signal
import subprocess
import sys
import time
import uuid

import pytest

pytestmark = pytest.mark.integration

SMALL = {"draws": 200, "tune": 300, "chains": 2}
LONG = {"draws": 2000, "tune": 2000, "chains": 4}


def start_worker(worker_id, tmp_path):
    env = {**os.environ, "KAWKIT_WORKER_ID": worker_id, "KAWKIT_CONCURRENCY": "2", "KAWKIT_CORES_PER_RUN": "2",
           "KAWKIT_LOG_DIR": str(tmp_path)}
    return subprocess.Popen([sys.executable, "-m", "kawkit_worker.main"], env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def wait_for(fn, timeout, every=2.0):
    end = time.time() + timeout
    while time.time() < end:
        v = fn()
        if v:
            return v
        time.sleep(every)
    raise AssertionError("timed out")


def status(user, run_id):
    return user.get("runs", f"select=*&id=eq.{run_id}").json()[0]


@pytest.fixture
def worker(tmp_path):
    wid = f"test-{uuid.uuid4().hex[:8]}"
    procs = [start_worker(wid, tmp_path)]
    yield wid, procs, tmp_path
    for p in procs:
        if p.poll() is None:
            p.send_signal(signal.SIGTERM)
            p.wait(timeout=30)


def test_submit_to_finished_is_fair_between_users(make_user, worker, sample_csv, supa):
    a, b = make_user(), make_user()
    a1, r = a.submit(sample_csv, "a1", settings=SMALL)
    assert r.status_code == 200, r.text
    a2, _ = a.submit(sample_csv, "a2", priors={"tv": {"roi_low": 0.8, "roi_high": 2.0, "carryover_weeks": 4}},
                     settings=SMALL)
    b1, _ = b.submit(sample_csv, "b1", settings=SMALL)

    wait_for(lambda: all(status(u, r)["status"] in ("finished", "failed") for u, r in ((a, a1), (a, a2), (b, b1))), 600)
    ra1, ra2, rb1 = status(a, a1), status(a, a2), status(b, b1)
    assert (ra1["status"], ra2["status"], rb1["status"]) == ("finished",) * 3, (ra1["error"], ra2["error"], rb1["error"])
    # one run per user at a time: A's second starts only after A's first has finished
    assert ra2["started_at"] >= ra1["finished_at"]
    # B was not kept waiting behind both of A's runs
    assert rb1["started_at"] < ra2["started_at"]

    res = a.get("run_results", f"select=*&run_id=eq.{a2}").json()[0]
    assert res["diagnostics"]["verdict"] in ("pass", "caution", "fail")
    assert len(res["channels"]) == 5 and len(res["curves"]) == 5
    assert res["channels"][0]["prior"]["source"] == "yours"
    assert res["default_plan"]["prob_better"] >= 0.5
    draws = a.download("results", res["draws_path"])
    assert draws.status_code == 200 and len(draws.json()["beta"]) > 100
    assert b.download("results", res["draws_path"]).status_code in (400, 403, 404)
    assert b.get("run_results", f"select=run_id&run_id=eq.{a2}").json() == []
    events = [e["type"] for e in a.get("run_events", f"select=type&run_id=eq.{a1}&order=id").json()]
    assert events == ["submitted", "started", "finished"]
    hb = a.get("worker_heartbeat", f"select=*&worker_id=eq.{worker[0]}").json()
    assert len(hb) == 1
    supa.http.delete(f"{supa.url}/rest/v1/worker_heartbeat?worker_id=eq.{worker[0]}")


def test_cancel_a_running_run(make_user, worker, sample_csv, supa):
    a = make_user()
    run_id, _ = a.submit(sample_csv, "to cancel", settings=LONG)
    wait_for(lambda: status(a, run_id)["status"] == "running", 120)
    assert a.rpc("cancel_run", {"p_run_id": run_id}).json() == "running"
    wait_for(lambda: status(a, run_id)["status"] == "cancelled", 45)
    assert supa.list("results", f"{a.id}/{run_id}") == []
    supa.http.delete(f"{supa.url}/rest/v1/worker_heartbeat?worker_id=eq.{worker[0]}")


def test_killed_worker_leads_to_a_retry_that_finishes(make_user, worker, sample_csv, supa):
    wid, procs, tmp_path = worker
    a = make_user()
    run_id, _ = a.submit(sample_csv, "survives a restart", settings=SMALL)
    wait_for(lambda: status(a, run_id)["status"] == "running", 120)
    procs[0].kill()  # as if the Mac mini lost power
    procs[0].wait()
    time.sleep(3)
    assert status(a, run_id)["status"] == "running"
    procs.append(start_worker(wid, tmp_path))
    wait_for(lambda: status(a, run_id)["status"] in ("finished", "failed"), 600)
    run = status(a, run_id)
    assert run["status"] == "finished", run["error"]
    assert run["attempts"] == 2
    events = [e["type"] for e in a.get("run_events", f"select=type&run_id=eq.{run_id}&order=id").json()]
    assert events == ["submitted", "started", "retried", "finished"]
    supa.http.delete(f"{supa.url}/rest/v1/worker_heartbeat?worker_id=eq.{wid}")
