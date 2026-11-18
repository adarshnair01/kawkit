from kawkit_worker.supa import auth_headers


def test_legacy_jwt_key_is_sent_as_apikey_and_bearer():
    key = "eyJhbGciOi.eyJyb2xlIjoi.c2ln"
    assert auth_headers(key) == {"apikey": key, "Authorization": f"Bearer {key}"}


def test_new_style_secret_key_is_sent_as_apikey_only():
    assert auth_headers("sb_secret_abc123") == {"apikey": "sb_secret_abc123"}
