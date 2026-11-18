"""Runs one fit in a child process, so a cancel or a crash never takes the service down."""

from __future__ import annotations

import gzip
import json
import os
import traceback

from .model import Cancelled, ModelError


def run_job(run: dict, conn, cores: int) -> None:
    """Child process entry point. Sends ('progress', p), then ('done', results) or ('error', message)."""
    try:
        from .pipeline import run_pipeline
        from .supa import Supa

        supa = Supa()
        csv_bytes = supa.download("uploads", run["upload_path"])

        parent = os.getppid()

        def on_progress(p: float) -> None:
            if os.getppid() != parent:  # the service died: stop, the queue will retry this run
                os._exit(1)
            conn.send(("progress", float(p)))

        settings = run.get("settings") or {}
        breakdown_bytes = None
        if settings.get("breakdown"):
            breakdown_bytes = supa.download("uploads", f"{run['user_id']}/{run['id']}/breakdown.csv")
        out = run_pipeline(csv_bytes, run.get("priors") or {}, int(run["seed"]), settings,
                           on_progress=on_progress, cores=cores, breakdown_bytes=breakdown_bytes)
        draws_path = f"{run['user_id']}/{run['id']}/draws.json"
        supa.upload("results", draws_path, json.dumps(out.pop("draws"), separators=(",", ":")).encode(),
                    "application/json")
        full = gzip.compress(json.dumps(out, separators=(",", ":")).encode())
        supa.upload("results", f"{run['user_id']}/{run['id']}/summary.json.gz", full, "application/gzip")
        out["draws_path"] = draws_path
        conn.send(("progress", 0.99))
        conn.send(("done", out))
    except ModelError as e:
        conn.send(("error", str(e)))
    except Cancelled:
        conn.send(("error", "cancelled"))
    except Exception as e:  # noqa: BLE001 - report, never crash silently
        conn.send(("error", "The model could not be fitted on this data. "
                            f"({type(e).__name__}: {str(e)[:200]})"))
        conn.send(("trace", traceback.format_exc()))
    finally:
        conn.close()
