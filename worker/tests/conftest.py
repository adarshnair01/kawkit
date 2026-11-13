import os
import uuid

import httpx
import pytest

URL = os.environ.get("KAWKIT_SUPABASE_URL", "https://cmjedgyaquekrtixmwbf.supabase.co")
ANON = os.environ.get("KAWKIT_ANON_KEY", "sb_publishable_kP_VJHd-mbNFdzrxxGBcqg_NGMCneAq")


class User:
    """A signed-in test user talking to Supabase exactly as the browser does (anon key + own token)."""

    def __init__(self, supa):
        self.email = f"test-{uuid.uuid4().hex[:12]}@kawkit-tests.example.com"
        password = uuid.uuid4().hex
        r = supa.http.post(f"{URL}/auth/v1/admin/users",
                           json={"email": self.email, "password": password, "email_confirm": True})
        r.raise_for_status()
        self.id = r.json()["id"]
        t = httpx.post(f"{URL}/auth/v1/token?grant_type=password", headers={"apikey": ANON},
                       json={"email": self.email, "password": password})
        t.raise_for_status()
        self.http = httpx.Client(timeout=60, headers={"apikey": ANON,
                                                      "Authorization": f"Bearer {t.json()['access_token']}"})

    def rpc(self, name, params=None):
        return self.http.post(f"{URL}/rest/v1/rpc/{name}", json=params or {})

    def get(self, table, query="select=*"):
        return self.http.get(f"{URL}/rest/v1/{table}?{query}")

    def upload(self, path, data: bytes, bucket="uploads"):
        return self.http.post(f"{URL}/storage/v1/object/{bucket}/{path}", content=data,
                              headers={"Content-Type": "text/csv"})

    def download(self, bucket, path):
        return self.http.get(f"{URL}/storage/v1/object/{bucket}/{path}")

    def submit(self, csv: bytes, name="test run", priors=None, settings=None):
        run_id = str(uuid.uuid4())
        path = f"{self.id}/{run_id}.csv"
        assert self.upload(path, csv).status_code == 200
        r = self.rpc("submit_run", {"p_name": name, "p_upload_path": path, "p_summary": {"test": True},
                                    "p_priors": priors or {}, "p_settings": settings or {}})
        return run_id, r


@pytest.fixture(scope="session")
def supa():
    os.environ.setdefault("KAWKIT_SUPABASE_URL", URL)
    from kawkit_worker.supa import Supa

    return Supa()


@pytest.fixture
def make_user(supa):
    from kawkit_worker.retention import delete_account

    users = []

    def make():
        u = User(supa)
        users.append(u)
        return u

    yield make
    for u in users:
        delete_account(supa, u.id)


@pytest.fixture(scope="session")
def sample_csv():
    from kawkit_worker.synth import make_dataset

    return make_dataset(seed=7)[0].encode()
