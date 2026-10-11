import os
import tempfile

os.environ.setdefault("AKEVA_ENV", "test")
os.environ.setdefault("AKEVA_STORAGE_DIR", tempfile.mkdtemp(prefix="akeva-test-"))
os.environ.setdefault("AKEVA_SMS_PROVIDER", "console")

import pytest  # noqa: E402

try:  # API tests need the full dependency set; domain tests don't.
    from fastapi.testclient import TestClient
    from mongomock_motor import AsyncMongoMockClient

    from app.core import db
    from app.core.db import new_id, utcnow
    from app.main import app

    HAVE_API_DEPS = True
except ImportError:  # pragma: no cover
    HAVE_API_DEPS = False

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 200
PDF = b"%PDF-1.7\n" + b"0" * 200


if HAVE_API_DEPS:

    @pytest.fixture()
    def client():
        db.set_db(AsyncMongoMockClient(tz_aware=True)[f"akeva_test_{new_id()[:8]}"])
        with TestClient(app) as c:
            yield c
        db.set_db(None)

    @pytest.fixture()
    def login(client):
        """Sign in through the real OTP flow and return auth headers."""

        def _login(phone: str, app_name: str) -> dict:
            r = client.post("/api/v1/auth/otp/request", json={"phone": phone, "app": app_name})
            assert r.status_code == 200, r.text
            code = r.json()["dev_code"]
            r = client.post("/api/v1/auth/otp/verify",
                            json={"phone": phone, "app": app_name, "code": code})
            assert r.status_code == 200, r.text
            return {"Authorization": f"Bearer {r.json()['access_token']}"}

        return _login

    @pytest.fixture()
    def admin_headers(client, login):
        import asyncio

        user = {
            "_id": new_id(), "phone": "+237690000001", "role": "super_admin",
            "status": "approved", "full_name": "Root Admin", "token_version": 0,
            "created_at": utcnow(), "deleted_at": None,
        }
        asyncio.run(db.get_db().users.insert_one(user))
        return login("+237690000001", "admin")
