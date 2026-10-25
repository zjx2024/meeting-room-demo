from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.service import BEIJING


class Clock:
    def __init__(self, value=None):
        self.value = value or datetime(2026, 10, 25, 8, 0, tzinfo=BEIJING)

    def __call__(self):
        return self.value


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def app(tmp_path, clock):
    return create_app(tmp_path / "demo.sqlite3", clock=clock, frontend_dir=tmp_path / "dist")


@pytest.fixture
def client(app):
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client


@pytest.fixture
def payload():
    return {"room_id": 1, "subject": "项目讨论", "attendee_count": 4,
            "start_at": "2026-10-25T09:00:00+08:00", "end_at": "2026-10-25T10:00:00+08:00"}


@pytest.fixture
def book(client, payload):
    def submit(user_id="1", **changes):
        headers = {} if user_id is None else {"X-Demo-User-Id": str(user_id)}
        return client.post("/api/reservations", json={**payload, **changes}, headers=headers)
    return submit
