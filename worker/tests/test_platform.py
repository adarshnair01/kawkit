"""Integration tests against a live Supabase project: isolation, limits, cancel, retention, deletion.

These talk to the database the way the browser does, so they prove row-level security holds
even for direct database calls. Run with:  uv run pytest -m integration
"""

import uuid

import pytest

from kawkit_worker.retention import delete_account, enforce_retention

pytestmark = pytest.mark.integration


def test_submit_requires_own_folder_and_existing_file(make_user, sample_csv):
    a, b = make_user(), make_user()
    run_id = str(uuid.uuid4())
    # cannot upload into someone else's folder
    assert a.upload(f"{b.id}/{run_id}.csv", sample_csv).status_code in (400, 403)
    # cannot submit a path in someone else's folder, or a file that does not exist
    r = a.rpc("submit_run", {"p_name": "x", "p_upload_path": f"{b.id}/{run_id}.csv", "p_summary": {}})
    assert r.status_code >= 400 and "own folder" in r.text
    r = a.rpc("submit_run", {"p_name": "x", "p_upload_path": f"{a.id}/{run_id}.csv", "p_summary": {}})
    assert r.status_code >= 400 and "not found" in r.text


def test_users_cannot_see_or_change_each_others_data(make_user, supa, sample_csv):
    a, b = make_user(), make_user()
    run_id, r = a.submit(sample_csv)
    assert r.status_code == 200, r.text

    # A sees the run; B sees nothing
    assert [x["id"] for x in a.get("runs").json()] == [run_id]
    assert b.get("runs").json() == []
    assert b.get("runs", f"select=*&id=eq.{run_id}").json() == []
    assert b.get("run_events").json() == []
    assert b.get("profiles").json()[0]["user_id"] == b.id and len(b.get("profiles").json()) == 1

    # B cannot read A's file
    assert b.download("uploads", f"{a.id}/{run_id}.csv").status_code in (400, 403, 404)
    assert a.download("uploads", f"{a.id}/{run_id}.csv").status_code == 200

    # B cannot cancel or rename A's run
    assert b.rpc("cancel_run", {"p_run_id": run_id}).status_code >= 400
    assert b.rpc("rename_run", {"p_run_id": run_id, "p_name": "hacked"}).status_code >= 400
    assert b.rpc("queue_position", {"p_run_id": run_id}).json() is None

    # nobody can write rows directly, not even their own
    from conftest import URL

    for u in (a, b):
        r = u.http.patch(f"{URL}/rest/v1/runs?id=eq.{run_id}", json={"status": "finished"})
        assert r.status_code in (401, 403), r.text
        r = u.http.delete(f"{URL}/rest/v1/runs?id=eq.{run_id}")
        assert r.status_code in (401, 403), r.text
        r = u.http.post(f"{URL}/rest/v1/run_results", json={"run_id": run_id, "user_id": u.id})
        assert r.status_code in (401, 403), r.text
        r = u.http.post(f"{URL}/rest/v1/worker_heartbeat", json={"worker_id": "x", "last_seen": "2026-01-01",
                                                                  "version": "x", "running_runs": 0, "max_concurrency": 1})
        assert r.status_code in (401, 403), r.text
    assert supa.select("runs", f"select=status,name&id=eq.{run_id}")[0] == {"status": "queued", "name": "test run"}

    # worker-only functions are closed to signed-in users
    for fn, params in [("claim_next_run", {"p_worker_id": "evil"}), ("delete_runs", {"p_run_ids": [run_id]}),
                       ("retention_candidates", {"p_user_id": a.id}), ("accounts_to_delete", {}),
                       ("end_run", {"p_run_id": run_id, "p_status": "failed"}),
                       ("run_tick", {"p_run_id": run_id, "p_progress": 0.5}),
                       ("requeue_worker_runs", {"p_worker_id": "x"}), ("housekeeping_candidates", {})]:
        assert b.rpc(fn, params).status_code in (401, 403, 404), fn

    # A can cancel their own queued run
    assert a.rpc("cancel_run", {"p_run_id": run_id}).json() == "cancelled"
    assert a.get("runs").json()[0]["status"] == "cancelled"


def test_submit_limit_is_three_active_runs(make_user, sample_csv):
    a = make_user()
    ids = []
    for _ in range(3):
        run_id, r = a.submit(sample_csv)
        assert r.status_code == 200, r.text
        ids.append(run_id)
    _, r = a.submit(sample_csv)
    assert r.status_code >= 400 and "1 running and 2 queued" in r.text
    assert a.rpc("queue_position", {"p_run_id": ids[0]}).json() <= a.rpc("queue_position", {"p_run_id": ids[2]}).json() - 2
    for run_id in ids:
        a.rpc("cancel_run", {"p_run_id": run_id})


def _finished_run(supa, user, sample_csv, n):
    """Insert a finished run with files, as the worker would leave it."""
    run_id = str(uuid.uuid4())
    path = f"{user.id}/{run_id}.csv"
    assert user.upload(path, sample_csv).status_code == 200
    supa.upload("results", f"{user.id}/{run_id}/draws.json", b"{}", "application/json")
    supa.http.post(f"{supa.url}/rest/v1/runs", json={
        "id": run_id, "user_id": user.id, "name": f"run {n}", "status": "finished", "upload_path": path,
        "data_summary": {}, "seed": 1, "finished_at": f"2026-01-{n + 1:02d}T00:00:00Z",
    }).raise_for_status()
    supa.http.post(f"{supa.url}/rest/v1/run_results", json={
        "run_id": run_id, "user_id": user.id, "diagnostics": {}, "fit": {}, "channels": [], "curves": [],
        "draws_path": f"{user.id}/{run_id}/draws.json",
    }).raise_for_status()
    return run_id


def test_sixth_finished_run_removes_the_oldest_rows_and_files(make_user, supa, sample_csv):
    a = make_user()
    ids = [_finished_run(supa, a, sample_csv, n) for n in range(6)]
    assert enforce_retention(supa, a.id) == 1
    kept = {r["id"] for r in a.get("runs").json()}
    assert kept == set(ids[1:])
    assert supa.select("run_results", f"select=run_id&run_id=eq.{ids[0]}") == []
    assert {f["name"] for f in supa.list("uploads", a.id)} == {f"{i}.csv" for i in ids[1:]}
    assert {f["name"] for f in supa.list("results", a.id)} == set(ids[1:])
    # the user can read their own results file, nobody else's
    assert a.download("results", f"{a.id}/{ids[1]}/draws.json").status_code == 200
    assert enforce_retention(supa, a.id) == 0


def test_account_deletion_removes_every_row_and_file(supa, sample_csv):
    from conftest import User

    a = User(supa)
    _finished_run(supa, a, sample_csv, 0)
    run_id, r = a.submit(sample_csv)
    assert r.status_code == 200
    assert a.rpc("request_account_deletion").status_code == 200
    assert a.get("runs", f"select=status&id=eq.{run_id}").json()[0]["status"] == "cancelled"
    pending = [x["user_id"] for x in supa.rpc("accounts_to_delete")]
    assert a.id in pending
    delete_account(supa, a.id)
    for table in ("runs", "run_results", "run_events", "profiles"):
        assert supa.select(table, f"select=user_id&user_id=eq.{a.id}") == [], table
    assert supa.list("uploads", a.id) == [] and supa.list("results", a.id) == []
    assert supa.http.get(f"{supa.url}/auth/v1/admin/users/{a.id}").status_code == 404


def test_share_links_are_read_only_scoped_and_revocable(make_user, supa, sample_csv):
    import httpx

    from conftest import ANON, URL

    a, b = make_user(), make_user()
    run_id = _finished_run(supa, a, sample_csv, 0)
    supa.http.patch(f"{supa.url}/rest/v1/run_results?run_id=eq.{run_id}", json={"fit": {"r2": 0.9}}).raise_for_status()
    queued, r = a.submit(sample_csv)
    assert r.status_code == 200

    # only the owner, and only for a finished run
    assert b.rpc("create_share", {"p_run_id": run_id}).status_code >= 400
    assert a.rpc("create_share", {"p_run_id": queued}).status_code >= 400
    share = a.rpc("create_share", {"p_run_id": run_id})
    assert share.status_code == 200, share.text
    token = share.json()["token"]
    assert a.rpc("create_share", {"p_run_id": run_id}).json()["token"] == token  # reused, not duplicated

    # anyone with the link reads the results, with nothing about the owner or the file
    anon = httpx.Client(timeout=60, headers={"apikey": ANON})
    got = anon.post(f"{URL}/rest/v1/rpc/get_shared_run", json={"p_token": token})
    assert got.status_code == 200 and got.json()["name"] == "run 0" and got.json()["result"]["fit"] == {"r2": 0.9}
    assert "user_id" not in got.text and "upload_path" not in got.text and a.id not in got.text
    assert anon.post(f"{URL}/rest/v1/rpc/get_shared_run", json={"p_token": str(uuid.uuid4())}).json() is None

    # the link opens nothing else: no tables, no files, and tokens cannot be listed
    assert anon.get(f"{URL}/rest/v1/shares?select=*").status_code in (401, 403)
    assert anon.get(f"{URL}/rest/v1/runs?select=*").status_code in (401, 403)
    assert b.get("shares").json() == []
    assert anon.get(f"{URL}/storage/v1/object/uploads/{a.id}/{run_id}.csv").status_code in (400, 401, 403, 404)
    r = a.http.post(f"{URL}/rest/v1/shares", json={"run_id": run_id, "user_id": a.id})
    assert r.status_code in (401, 403), r.text

    # others cannot revoke it; the owner can, and it stops working at once
    assert b.rpc("revoke_share", {"p_run_id": run_id}).json() == 0
    assert got.status_code == 200 and anon.post(f"{URL}/rest/v1/rpc/get_shared_run", json={"p_token": token}).json() is not None
    assert a.rpc("revoke_share", {"p_run_id": run_id}).json() == 1
    assert anon.post(f"{URL}/rest/v1/rpc/get_shared_run", json={"p_token": token}).json() is None

    # an expired link stops working, and a deleted run takes its links with it
    token2 = a.rpc("create_share", {"p_run_id": run_id}).json()["token"]
    assert token2 != token
    supa.http.patch(f"{supa.url}/rest/v1/shares?token=eq.{token2}", json={"expires_at": "2020-01-01T00:00:00Z"}).raise_for_status()
    assert anon.post(f"{URL}/rest/v1/rpc/get_shared_run", json={"p_token": token2}).json() is None
    a.rpc("create_share", {"p_run_id": run_id})
    supa.rpc("delete_runs", {"p_run_ids": [run_id]})
    assert supa.select("shares", f"select=token&run_id=eq.{run_id}") == []
    a.rpc("cancel_run", {"p_run_id": queued})
