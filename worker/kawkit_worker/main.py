"""The worker service: pull runs from the queue, fit them, write results back.

Outgoing connections only. Run with:  uv run python -m kawkit_worker.main
"""

from __future__ import annotations

import json
import logging
import logging.handlers
import multiprocessing as mp
import os
import signal
import socket
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from . import __version__
from .retention import enforce_retention, housekeeping
from .supa import Supa

log = logging.getLogger("kawkit.worker")

POLL_SECONDS = 4
TICK_SECONDS = 8
HEARTBEAT_SECONDS = 30
HOUSEKEEPING_SECONDS = 24 * 3600


class JsonFormatter(logging.Formatter):
    SKIP = set(logging.LogRecord("", 0, "", 0, "", (), None).__dict__) | {"message", "asctime"}

    def format(self, record: logging.LogRecord) -> str:
        row = {"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "level": record.levelname,
               "logger": record.name, "msg": record.getMessage()}
        row.update({k: v for k, v in record.__dict__.items() if k not in self.SKIP})
        if record.exc_info:
            row["error"] = self.formatException(record.exc_info)
        return json.dumps(row, default=str)


def setup_logging() -> None:
    log_dir = Path(os.environ.get("KAWKIT_LOG_DIR", Path.home() / "Library" / "Logs" / "kawkit"))
    log_dir.mkdir(parents=True, exist_ok=True)
    handler = logging.handlers.TimedRotatingFileHandler(log_dir / "worker.jsonl", when="midnight", backupCount=14)
    handler.setFormatter(JsonFormatter())
    stream = logging.StreamHandler()
    stream.setFormatter(JsonFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[handler, stream])
    logging.getLogger("httpx").setLevel(logging.WARNING)


@dataclass
class Job:
    run: dict
    process: mp.Process
    conn: object
    progress: float = 0.0
    last_tick: float = 0.0
    started: float = field(default_factory=time.time)
    outcome: tuple | None = None
    cancelling: bool = False


class Worker:
    def __init__(self) -> None:
        self.supa = Supa()
        self.worker_id = os.environ.get("KAWKIT_WORKER_ID", socket.gethostname())
        self.concurrency = int(os.environ.get("KAWKIT_CONCURRENCY", "2"))
        self.cores_per_run = int(os.environ.get("KAWKIT_CORES_PER_RUN", "4"))
        self.jobs: dict[str, Job] = {}
        self.stopping = False
        self.last_heartbeat = 0.0
        self.last_housekeeping = 0.0
        self.last_poll = 0.0
        self.ctx = mp.get_context("spawn")

    # ---- lifecycle
    def stop(self, *_: object) -> None:
        self.stopping = True

    def heartbeat(self) -> None:
        if time.time() - self.last_heartbeat < HEARTBEAT_SECONDS:
            return
        self.last_heartbeat = time.time()
        try:
            self.supa.upsert("worker_heartbeat", {
                "worker_id": self.worker_id, "last_seen": datetime.now(timezone.utc).isoformat(),
                "version": __version__, "running_runs": len(self.jobs), "max_concurrency": self.concurrency,
            })
        except Exception:  # noqa: BLE001
            log.exception("heartbeat failed")

    def claim(self) -> None:
        if len(self.jobs) >= self.concurrency or time.time() - self.last_poll < POLL_SECONDS:
            return
        self.last_poll = time.time()
        rows = self.supa.rpc("claim_next_run", {"p_worker_id": self.worker_id}) or []
        for run in rows:
            parent, child = self.ctx.Pipe(duplex=False)
            from .job import run_job

            p = self.ctx.Process(target=run_job, args=(run, child, self.cores_per_run), daemon=True)
            p.start()
            child.close()
            self.jobs[run["id"]] = Job(run=run, process=p, conn=parent, last_tick=time.time())
            self.last_poll = 0.0  # look for another run straight away
            log.info("run started", extra={"run": run["id"], "user": run["user_id"], "attempt": run["attempts"]})

    def pump(self, job: Job) -> None:
        try:
            while job.conn.poll():
                kind, payload = job.conn.recv()
                if kind == "progress":
                    job.progress = max(job.progress, payload)
                elif kind == "trace":
                    log.error("run traceback", extra={"run": job.run["id"], "trace": payload})
                else:
                    job.outcome = (kind, payload)
        except (EOFError, OSError):
            pass

    def tick(self, job: Job) -> None:
        if time.time() - job.last_tick < TICK_SECONDS or job.cancelling:
            return
        job.last_tick = time.time()
        cancel = self.supa.rpc("run_tick", {"p_run_id": job.run["id"], "p_progress": round(job.progress, 3)})
        if cancel:
            job.cancelling = True
            job.process.terminate()

    def settle(self, run_id: str, job: Job) -> None:
        """The child has exited: record the outcome."""
        self.pump(job)
        run, seconds = job.run, round(time.time() - job.started, 1)
        extra = {"run": run_id, "user": run["user_id"], "seconds": seconds}
        try:
            if job.cancelling:
                self.supa.rpc("end_run", {"p_run_id": run_id, "p_status": "cancelled"})
                self._drop_results(run)
                log.info("run cancelled", extra=extra)
            elif job.outcome and job.outcome[0] == "done":
                out = job.outcome[1]
                ok = self.supa.rpc("finish_run", {
                    "p_run_id": run_id, "p_diagnostics": out["diagnostics"], "p_fit": out["fit"],
                    "p_channels": out["channels"], "p_curves": out["curves"],
                    "p_default_plan": out["default_plan"], "p_draws_path": out["draws_path"],
                })
                if ok:
                    enforce_retention(self.supa, run["user_id"])
                else:
                    self._drop_results(run)
                log.info("run finished", extra={**extra, "verdict": out["diagnostics"].get("verdict"), "recorded": ok})
            else:
                reason = job.outcome[1] if job.outcome else (
                    "The model process stopped unexpectedly (it may have run out of memory)."
                )
                self.supa.rpc("end_run", {"p_run_id": run_id, "p_status": "failed", "p_error": reason})
                self._drop_results(run)
                log.warning("run failed", extra={**extra, "reason": reason})
        except Exception:  # noqa: BLE001
            log.exception("could not record outcome", extra=extra)
        finally:
            job.conn.close()
            del self.jobs[run_id]

    def _drop_results(self, run: dict) -> None:
        prefix = f"{run['user_id']}/{run['id']}"
        try:
            self.supa.remove("results", [f"{prefix}/draws.json", f"{prefix}/summary.json.gz"])
        except Exception:  # noqa: BLE001
            log.exception("could not remove partial results", extra={"run": run["id"]})

    def maybe_housekeeping(self) -> None:
        if time.time() - self.last_housekeeping < HOUSEKEEPING_SECONDS:
            return
        self.last_housekeeping = time.time()
        try:
            housekeeping(self.supa)
        except Exception:  # noqa: BLE001
            log.exception("housekeeping failed")

    def run_forever(self) -> None:
        signal.signal(signal.SIGTERM, self.stop)
        signal.signal(signal.SIGINT, self.stop)
        log.info("worker starting", extra={"worker": self.worker_id, "concurrency": self.concurrency,
                                            "version": __version__})
        try:
            n = self.supa.rpc("requeue_worker_runs", {"p_worker_id": self.worker_id})
            if n:
                log.info("requeued interrupted runs", extra={"count": n})
        except Exception:  # noqa: BLE001
            log.exception("requeue failed")

        while not self.stopping:
            try:
                self.heartbeat()
                for run_id, job in list(self.jobs.items()):
                    self.pump(job)
                    if job.process.is_alive():
                        self.tick(job)
                    else:
                        job.process.join()
                        self.settle(run_id, job)
                self.claim()
                self.maybe_housekeeping()
            except Exception:  # noqa: BLE001
                log.exception("loop error")
                time.sleep(5)
            time.sleep(0.5)

        # shutting down: stop children and hand their runs back to the queue for a retry
        for job in self.jobs.values():
            job.process.terminate()
        try:
            self.supa.rpc("requeue_worker_runs", {"p_worker_id": self.worker_id})
        except Exception:  # noqa: BLE001
            log.exception("requeue on shutdown failed")
        log.info("worker stopped")


def main() -> None:
    setup_logging()
    Worker().run_forever()


if __name__ == "__main__":
    main()
