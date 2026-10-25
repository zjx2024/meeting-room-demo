from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
import sqlite3
from threading import Event

import pytest
from fastapi.testclient import TestClient

from app.errors import BusinessError
from app.main import create_app
from app.schemas import ReservationInput
from app.service import BEIJING, MeetingService


def cancel(client, reservation_id, user=1):
    return client.post(f"/api/reservations/{reservation_id}/cancel", headers={"X-Demo-User-Id": str(user)})


def disable(client, room=1, user=4):
    return client.post(f"/api/rooms/{room}/disable", headers={"X-Demo-User-Id": str(user)})


def test_cancel_preserves_and_releases_both_conflicts(book, client):
    original = book().json()["data"]
    result = cancel(client, original["id"])
    assert result.status_code == 200
    record = result.json()["data"]
    assert record == {**original, "status": "cancelled", "status_label": "已取消"}
    assert book(room_id=2).status_code == 201
    assert book(user_id=2).status_code == 201
    rows = client.get("/api/reservations?date=2026-10-25").json()["data"]
    assert len(rows) == 3 and rows[0]["status"] == "cancelled"
    assert cancel(client, original["id"]).json()["error"]["code"] == "already_cancelled"


@pytest.mark.parametrize("user", [2, 3, 4])
def test_other_people_including_admin_cannot_cancel(book, client, user):
    record = book().json()["data"]
    response = cancel(client, record["id"], user)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "not_owner"
    assert client.get("/api/reservations?date=2026-10-25").json()["data"][0]["status"] == "booked"


@pytest.mark.parametrize("seconds,expected", [(-1, 200), (0, 409), (1, 409), (3600, 409)])
def test_exact_cancel_boundary(book, client, clock, seconds, expected):
    record = book().json()["data"]
    clock.value = datetime(2026, 10, 25, 9, tzinfo=BEIJING) + timedelta(seconds=seconds)
    assert cancel(client, record["id"]).status_code == expected


def test_query_by_beijing_day_and_after_time_passes(book, client, clock):
    first = book().json()["data"]
    assert book(start_at="2026-10-26T09:00:00+08:00", end_at="2026-10-26T10:00:00+08:00").status_code == 201
    clock.value += timedelta(days=60)
    assert client.get("/api/reservations?date=2026-10-25").json()["data"] == [first]
    assert len(client.get("/api/reservations?date=2026-10-26").json()["data"]) == 1
    assert client.get("/api/reservations?date=2026-12-31").json()["data"] == []
    assert client.get("/api/reservations?date=9999-12-31").json()["data"] == []


@pytest.mark.parametrize("day", ["bad", "2026-02-30", "20261025", "2026-10-25T00:00:00"])
def test_invalid_query_dates(client, day):
    response = client.get("/api/reservations", params={"date": day})
    assert response.status_code == 400
    assert "日期" in response.json()["error"]["message"]


def test_disable_permissions_and_missing_resources(book, client):
    for user in (1, 2, 3):
        assert disable(client, user=user).status_code == 403
    for path in ("/api/rooms/1/disable", "/api/reservations/1/cancel"):
        assert client.post(path).status_code == 400
    assert cancel(client, 999).status_code == 404
    assert disable(client, room=999).status_code == 404
    assert disable(client).status_code == 200
    assert disable(client).json()["data"]["enabled"] is False
    response = book()
    assert response.status_code == 409 and response.json()["error"]["code"] == "room_disabled"
    assert client.post("/api/rooms/1/enable", headers={"X-Demo-User-Id": "1"}).status_code == 403


@pytest.mark.parametrize("user", [1, 2, 3])
def test_only_admin_can_enable(client, user):
    assert disable(client).status_code == 200
    response = client.post("/api/rooms/1/enable", headers={"X-Demo-User-Id": str(user)})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "not_admin"
    assert client.get("/api/rooms").json()["data"][0]["enabled"] is False


def test_enable_requires_valid_identity_and_room(client):
    assert client.post("/api/rooms/1/enable").status_code == 400
    assert client.post("/api/rooms/999/enable", headers={"X-Demo-User-Id": "4"}).status_code == 404


def test_enable_keeps_reservations_and_survives_restart(book, client, app, clock, tmp_path):
    original = book().json()["data"]
    cancelled = book(room_id=2, user_id=2).json()["data"]
    cancel(client, cancelled["id"], user=2)
    disable(client)
    before = client.get("/api/reservations?date=2026-10-25").json()["data"]
    for _ in range(2):
        response = client.post("/api/rooms/1/enable", headers={"X-Demo-User-Id": "4"})
        assert response.status_code == 200 and response.json()["data"]["enabled"] is True
    assert client.get("/api/reservations?date=2026-10-25").json()["data"] == before
    assert book(user_id=3).json()["error"]["code"] == "room_conflict"
    assert book(user_id=3, start_at="2026-10-25T10:00:00+08:00", end_at="2026-10-25T11:00:00+08:00").status_code == 201
    with TestClient(create_app(app.state.database.path, clock=clock, frontend_dir=tmp_path / "dist")) as restarted:
        assert restarted.get("/api/rooms").json()["data"][0]["enabled"] is True
        rows = restarted.get("/api/reservations?date=2026-10-25").json()["data"]
        assert next(row for row in rows if row["id"] == original["id"]) == original
        assert next(row for row in rows if row["id"] == cancelled["id"])["status"] == "cancelled"


def test_enable_commit_failure_keeps_disabled(client, app, monkeypatch):
    disable(client)
    original = sqlite3.connect
    class FailedCommit(sqlite3.Connection):
        def commit(self):
            raise sqlite3.OperationalError("disk I/O error")
    monkeypatch.setattr(sqlite3, "connect", lambda *args, **kwargs: original(*args, **kwargs, factory=FailedCommit))
    response = client.post("/api/rooms/1/enable", headers={"X-Demo-User-Id": "4"})
    assert response.status_code == 500
    assert client.get("/api/rooms").json()["data"][0]["enabled"] is False


def test_disable_keeps_future_records_and_person_conflict(book, client):
    record = book().json()["data"]
    assert disable(client).status_code == 200
    assert client.get("/api/reservations?date=2026-10-25").json()["data"] == [record]
    assert book(room_id=2).json()["error"]["code"] == "booker_conflict"
    assert cancel(client, record["id"]).status_code == 200
    assert book(room_id=2).status_code == 201
    assert client.get("/api/rooms").json()["data"][0]["enabled"] is False


@pytest.mark.parametrize("first_operation", ["create", "disable"])
def test_create_and_disable_have_transaction_order(client, app, payload, first_operation):
    entered, release, second_entered = Event(), Event(), Event()
    first = MeetingService(app.state.database, app.state.service.clock)
    second = MeetingService(app.state.database, app.state.service.clock)
    original_current_user = first.current_user
    def gated(connection, user_id):
        entered.set()
        assert release.wait(5)
        return original_current_user(connection, user_id)
    first.current_user = gated
    meeting = ReservationInput(**payload)
    def run_first():
        return first.create(meeting, 1) if first_operation == "create" else first.disable(1, 4)
    def run_second():
        second_entered.set()
        try:
            return second.disable(1, 4) if first_operation == "create" else second.create(meeting, 1)
        except BusinessError as error:
            return error
    with ThreadPoolExecutor(max_workers=2) as pool:
        first_result = pool.submit(run_first)
        assert entered.wait(5)
        second_result = pool.submit(run_second)
        assert second_entered.wait(5)
        release.set()
        assert isinstance(first_result.result(timeout=5), dict)
        result = second_result.result(timeout=5)
    if first_operation == "disable":
        assert isinstance(result, BusinessError) and result.code == "room_disabled"
    else:
        assert result["enabled"] is False
    with app.state.database.connect() as connection:
        assert connection.execute("SELECT count(*) FROM reservations").fetchone()[0] == (1 if first_operation == "create" else 0)


@pytest.mark.parametrize("operation", ["cancel", "disable"])
def test_commit_failure_keeps_prior_state(book, client, app, monkeypatch, operation):
    reservation = book().json()["data"]
    original = sqlite3.connect
    class FailedCommit(sqlite3.Connection):
        def commit(self):
            raise sqlite3.OperationalError("disk I/O error")
    monkeypatch.setattr(sqlite3, "connect", lambda *args, **kwargs: original(*args, **kwargs, factory=FailedCommit))
    response = cancel(client, reservation["id"]) if operation == "cancel" else disable(client)
    assert response.status_code == 500
    assert client.get("/api/rooms").json()["data"][0]["enabled"] is True
    assert client.get("/api/reservations?date=2026-10-25").json()["data"] == [reservation]


def test_file_persists_create_cancel_disable_and_reinitialize(book, client, app, clock, tmp_path):
    first = book().json()["data"]
    second = book(room_id=2, user_id=2).json()["data"]
    cancel(client, second["id"], user=2)
    disable(client)
    for _ in range(2):
        with TestClient(create_app(app.state.database.path, clock=clock, frontend_dir=tmp_path / "absent")) as restarted:
            rows = restarted.get("/api/reservations?date=2026-10-25").json()["data"]
            assert rows == [first, {**second, "status": "cancelled", "status_label": "已取消"}]
            assert restarted.get("/api/rooms").json()["data"][0]["enabled"] is False
            response = restarted.post("/api/reservations", json={"room_id": 3, "subject": "冲突", "attendee_count": 1,
                "start_at": first["start_at"], "end_at": first["end_at"]}, headers={"X-Demo-User-Id": "1"})
            assert response.json()["error"]["code"] == "booker_conflict"


def test_static_resources_do_not_mask_api_404(tmp_path, clock):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><h1>会议室预约</h1>")
    (dist / "assets/app.js").write_text("console.log('demo')")
    with TestClient(create_app(tmp_path / "app.sqlite3", clock=clock, frontend_dir=dist)) as client:
        assert "会议室预约" in client.get("/").text
        assert client.get("/assets/app.js").status_code == 200
        assert client.get("/api/not-found").status_code == 404
        assert client.get("/api/not-found").headers["content-type"].startswith("application/json")
        assert client.get("/assets/not-found.js").status_code == 404
