"""Retention: at most 5 finished runs per user, and the daily clean-up.

Order matters: find candidates, delete their files through the storage API, then delete the rows,
so a crash never leaves rows pointing at missing files.
"""

from __future__ import annotations

import logging

from .supa import Supa

log = logging.getLogger("kawkit.retention")


def results_prefix(user_id: str, run_id: str) -> str:
    return f"{user_id}/{run_id}"


def _delete_run_files(supa: Supa, rows: list[dict]) -> None:
    supa.remove("uploads", [r["upload_path"] for r in rows])
    for r in rows:
        prefix = results_prefix(r["user_id"], r["run_id"])
        files = [f"{prefix}/{f['name']}" for f in supa.list("results", prefix) if f.get("id")]
        supa.remove("results", files)


def enforce_retention(supa: Supa, user_id: str) -> int:
    rows = supa.rpc("retention_candidates", {"p_user_id": user_id}) or []
    if not rows:
        return 0
    _delete_run_files(supa, rows)
    n = supa.rpc("delete_runs", {"p_run_ids": [r["run_id"] for r in rows]})
    log.info("retention", extra={"user": user_id, "deleted": n})
    return n or 0


def _user_files(supa: Supa, bucket: str, user_id: str) -> list[str]:
    out = []
    for entry in supa.list(bucket, user_id):
        path = f"{user_id}/{entry['name']}"
        if entry.get("id"):
            out.append(path)
        else:  # a folder (results/{user}/{run}/)
            out.extend(f"{path}/{f['name']}" for f in supa.list(bucket, path) if f.get("id"))
    return out


def delete_account(supa: Supa, user_id: str) -> None:
    for bucket in ("uploads", "results"):
        supa.remove(bucket, _user_files(supa, bucket, user_id))
    supa.delete_user(user_id)  # rows cascade from auth.users


def housekeeping(supa: Supa) -> dict:
    """Daily: old failed and cancelled runs, old events, requested and inactive accounts, orphan files."""
    out = {"runs": 0, "accounts": 0, "orphans": 0}
    rows = supa.rpc("housekeeping_candidates") or []
    if rows:
        _delete_run_files(supa, rows)
        out["runs"] = supa.rpc("delete_runs", {"p_run_ids": [r["run_id"] for r in rows]}) or 0

    for acc in supa.rpc("accounts_to_delete") or []:
        delete_account(supa, acc["user_id"])
        out["accounts"] += 1

    # files left without a run
    known = {r["id"] for r in supa.select("runs", "select=id")}
    for folder in supa.list("uploads"):
        if folder.get("id"):
            continue
        user = folder["name"]
        stale = [f"{user}/{f['name']}" for f in supa.list("uploads", user)
                 if f.get("id") and f["name"].rsplit(".", 1)[0] not in known and _older_than_a_day(f)]
        supa.remove("uploads", stale)
        out["orphans"] += len(stale)
    for folder in supa.list("results"):
        if folder.get("id"):
            continue
        user = folder["name"]
        for run_folder in supa.list("results", user):
            if run_folder.get("id") or run_folder["name"] in known:
                continue
            files = [f"{user}/{run_folder['name']}/{f['name']}"
                     for f in supa.list("results", f"{user}/{run_folder['name']}") if f.get("id")]
            supa.remove("results", files)
            out["orphans"] += len(files)
    log.info("housekeeping", extra=out)
    return out


def _older_than_a_day(entry: dict) -> bool:
    from datetime import datetime, timedelta, timezone

    stamp = entry.get("created_at")
    if not stamp:
        return False
    try:
        created = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError:
        return False
    return created < datetime.now(timezone.utc) - timedelta(days=1)
