from fastapi.testclient import TestClient

from nox_api.main import app


def test_healthz():
    res = TestClient(app).get("/healthz")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}
