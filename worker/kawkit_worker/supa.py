"""A small Supabase client for the worker: database functions, tables and storage over HTTPS.

The worker only ever makes outgoing connections. The service key bypasses row-level security,
so it is read from the macOS Keychain (or the environment) and never written to disk by this code.
"""

from __future__ import annotations

import os
import subprocess
from urllib.parse import quote

import httpx

KEYCHAIN_SERVICE = "kawkit-worker"


def load_service_key() -> str:
    key = os.environ.get("KAWKIT_SERVICE_KEY")
    if key:
        return key.strip()
    path = os.environ.get("KAWKIT_SERVICE_KEY_FILE")
    if path:
        with open(path) as f:
            return f.read().strip()
    try:
        out = subprocess.run(
            ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
            capture_output=True, text=True, check=True,
        )
        return out.stdout.strip()
    except (OSError, subprocess.CalledProcessError) as e:
        raise RuntimeError(
            "No service key found. Store it in the Keychain (see worker/launchd/install.sh) "
            "or set KAWKIT_SERVICE_KEY."
        ) from e


def auth_headers(key: str) -> dict[str, str]:
    """Legacy service_role keys are JWTs and go in both headers. New sb_secret_ keys are not JWTs and
    must go in `apikey` only: sent as a Bearer token they are read as no login (the anon role)."""
    headers = {"apikey": key}
    if key.count(".") == 2:
        headers["Authorization"] = f"Bearer {key}"
    return headers


class Supa:
    def __init__(self, url: str | None = None, key: str | None = None):
        self.url = (url or os.environ["KAWKIT_SUPABASE_URL"]).rstrip("/")
        self.key = key or load_service_key()
        self.http = httpx.Client(
            timeout=httpx.Timeout(60.0, connect=15.0),
            headers=auth_headers(self.key),
        )

    def _check(self, r: httpx.Response) -> httpx.Response:
        if r.status_code >= 400:
            raise RuntimeError(f"Supabase {r.request.method} {r.request.url.path} -> {r.status_code}: {r.text[:300]}")
        return r

    # ---- database
    def rpc(self, name: str, params: dict | None = None):
        r = self._check(self.http.post(f"{self.url}/rest/v1/rpc/{name}", json=params or {}))
        return r.json() if r.content else None

    def select(self, table: str, query: str = "select=*"):
        return self._check(self.http.get(f"{self.url}/rest/v1/{table}?{query}")).json()

    def upsert(self, table: str, row: dict) -> None:
        self._check(self.http.post(
            f"{self.url}/rest/v1/{table}", json=row,
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
        ))

    # ---- storage
    def download(self, bucket: str, path: str) -> bytes:
        return self._check(self.http.get(f"{self.url}/storage/v1/object/{bucket}/{quote(path)}")).content

    def upload(self, bucket: str, path: str, data: bytes, content_type: str) -> None:
        self._check(self.http.post(
            f"{self.url}/storage/v1/object/{bucket}/{quote(path)}", content=data,
            headers={"Content-Type": content_type, "x-upsert": "true"},
        ))

    def remove(self, bucket: str, paths: list[str]) -> None:
        if paths:
            self._check(self.http.request(
                "DELETE", f"{self.url}/storage/v1/object/{bucket}", json={"prefixes": paths},
            ))

    def list(self, bucket: str, prefix: str = "") -> list[dict]:
        out: list[dict] = []
        offset = 0
        while True:
            page = self._check(self.http.post(
                f"{self.url}/storage/v1/object/list/{bucket}",
                json={"prefix": prefix, "limit": 1000, "offset": offset},
            )).json()
            out.extend(page)
            if len(page) < 1000:
                return out
            offset += 1000

    # ---- auth admin
    def delete_user(self, user_id: str) -> None:
        r = self.http.delete(f"{self.url}/auth/v1/admin/users/{user_id}")
        if r.status_code not in (200, 204, 404):
            self._check(r)
