from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import sqlite3
from threading import Barrier

import pytest

from app.errors import BusinessError
from app.schemas import ReservationInput
from app.service import BEIJING


def assert_error(response, status, code=None):
    assert response.status_code == status, response.text
    body = response.json()
    assert body["error"]["message"]
    assert body["server_time"].endswith("+08:00")
    if code:
        assert body["error"]["code"] == code


def test_success_and_identity(book, client):
    response = book(user_id=2, subject="  项目讨论  ")
    assert response.status_code == 201, response.text
    data = response.json()["data"]
    assert (data["subject"], data["booker_id"], data["booker_name"], data["status_label"]) == ("项目讨论", 2, "李四", "已预约")
    assert client.get("/api/reservations?date=2026-10-25").json()["data"] == [data]


@pytest.mark.parametrize("user", [None, "", "nobody", "999"])
def test_invalid_user(book, user):
    assert_error(book(user_id=user), 400, "invalid_user")


def test_cannot_book_for_someone_else(book):
    assert_error(book(booker_id=2), 403, "different_booker")


@pytest.mark.parametrize("field,value", [
    ("subject", "  "), ("subject", 5), ("attendee_count", 0), ("attendee_count", -1),
    ("attendee_count", 1.5), ("attendee_count", True), ("attendee_count", "4"),
    ("start_at", "bad"), ("start_at", "2026-10-25T09:00:00"),
    ("start_at", "2026-10-25T09:00:00.0000001+08:00"), ("start_at", 1234567890),
    ("end_at", None), ("room_id", None),
])
def test_invalid_fields_never_write(book, client, field, value):
    assert_error(book(**{field: value}), 400, "invalid_input")
    assert client.get("/api/reservations?date=2026-10-25").json()["data"] == []


@pytest.mark.parametrize("field", ["subject", "room_id", "attendee_count", "start_at", "end_at"])
def test_missing_fields(client, payload, field):
    payload.pop(field)
    response = client.post("/api/reservations", json=payload, headers={"X-Demo-User-Id": "1"})
    assert_error(response, 400, "invalid_input")
    assert "请填写" in response.json()["error"]["message"]


@pytest.mark.parametrize("start,end,code", [
    ("07:30", "08:30", "business_hours"), ("19:30", "20:30", "business_hours"),
    ("09:00", "09:00", "time_order"), ("10:00", "09:00", "time_order"),
    ("09:00", "13:30", "duration"), ("09:10", "10:00", "time_grid"),
    ("09:00:01", "10:00", "time_grid"), ("09:00", "10:00:01", "time_grid"),
    ("09:00", "09:15", "time_grid"),
])
def test_time_rejections(book, start, end, code):
    assert_error(book(start_at=f"2026-10-25T{start}+08:00", end_at=f"2026-10-25T{end}+08:00"), 400, code)


def test_cross_day_rejected(book):
    assert_error(book(end_at="2026-10-26T09:30:00+08:00"), 400, "business_hours")


@pytest.mark.parametrize("start,end", [("08:00", "08:30"), ("19:30", "20:00"), ("09:00", "13:00")])
def test_time_boundaries(book, start, end):
    assert book(start_at=f"2026-10-25T{start}:00+08:00", end_at=f"2026-10-25T{end}:00+08:00").status_code == 201


@pytest.mark.parametrize("days,expected", [(0, 201), (7, 201), (-1, 400), (8, 400)])
def test_booking_window_inclusive(book, clock, days, expected):
    clock.value = datetime(2026, 10, 25, 9, tzinfo=BEIJING)
    start = clock.value + timedelta(days=days)
    response = book(start_at=start.isoformat(), end_at=(start + timedelta(minutes=30)).isoformat())
    assert response.status_code == expected, response.text


def test_window_does_not_round_now(book, clock):
    clock.value = datetime(2026, 10, 25, 9, 0, 1, tzinfo=BEIJING)
    assert_error(book(), 400, "past_start")


def test_thirty_minutes_beyond_window(book, clock):
    clock.value = datetime(2026, 10, 25, 9, tzinfo=BEIJING)
    assert_error(book(start_at="2026-11-01T09:30:00+08:00", end_at="2026-11-01T10:00:00+08:00"), 400, "booking_window")


def test_other_offset_is_normalized(book, clock, monkeypatch):
    monkeypatch.setenv("TZ", "America/Los_Angeles")
    clock.value = clock.value.astimezone(timezone.utc)
    response = book(start_at="2026-10-25T01:00:00Z", end_at="2026-10-25T02:00:00Z")
    assert response.status_code == 201, response.text
    assert response.json()["data"]["start_at"] == "2026-10-25T09:00:00+08:00"


def test_capacity_and_missing_room(book):
    assert_error(book(attendee_count=5), 400, "capacity")
    assert_error(book(room_id=999), 404, "room_missing")
    assert book(attendee_count=4).status_code == 201


@pytest.mark.parametrize("start,end", [("09:30", "10:30"), ("09:00", "10:00"), ("08:30", "10:30"), ("09:00", "09:30")])
def test_room_conflict_shapes(book, client, start, end):
    original = book(user_id=2).json()["data"]
    response = book(start_at=f"2026-10-25T{start}:00+08:00", end_at=f"2026-10-25T{end}:00+08:00")
    assert_error(response, 409, "room_conflict")
    assert "A101 在 09:00～10:00 已被预约" == response.json()["error"]["message"]
    assert "李四" not in response.text
    assert client.get("/api/reservations?date=2026-10-25").json()["data"] == [original]


@pytest.mark.parametrize("start,end", [("08:30", "09:00"), ("10:00", "11:00")])
def test_adjacent_intervals_allowed(book, start, end):
    assert book().status_code == 201
    assert book(start_at=f"2026-10-25T{start}:00+08:00", end_at=f"2026-10-25T{end}:00+08:00").status_code == 201


def test_person_conflicts_across_rooms(book):
    assert book().status_code == 201
    assert_error(book(room_id=3), 409, "booker_conflict")
    assert book(room_id=3, user_id=2).status_code == 201


@pytest.mark.parametrize("same_person", [False, True])
def test_simultaneous_creations_have_one_winner(client, app, payload, same_person):
    barrier = Barrier(2)
    def submit(index):
        meeting = ReservationInput(**{**payload, "room_id": index + 1 if same_person else 1})
        barrier.wait(timeout=5)
        try:
            return app.state.service.create(meeting, 1 if same_person else index + 1)
        except BusinessError as error:
            return error
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(submit, [0, 1]))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert sum(isinstance(result, BusinessError) and result.status == 409 for result in results) == 1
    with app.state.database.connect() as connection:
        assert connection.execute("SELECT count(*) FROM reservations").fetchone()[0] == 1


def test_creation_commit_failure_rolls_back(book, app, monkeypatch):
    original = sqlite3.connect
    class FailedCommit(sqlite3.Connection):
        def commit(self):
            raise sqlite3.OperationalError("disk I/O error")
    monkeypatch.setattr(sqlite3, "connect", lambda *args, **kwargs: original(*args, **kwargs, factory=FailedCommit))
    assert_error(book(), 500, "storage_failed")
    with app.state.database.connect() as connection:
        assert connection.execute("SELECT count(*) FROM reservations").fetchone()[0] == 0


def test_database_busy_does_not_save(book, app):
    app.state.database.timeout = 0.02
    with app.state.database.connect(write=True):
        assert_error(book(), 503, "storage_busy")
    with app.state.database.connect() as connection:
        assert connection.execute("SELECT count(*) FROM reservations").fetchone()[0] == 0


def test_openapi_matches_error_contract(client):
    operation = client.get("/openapi.json").json()["paths"]["/api/reservations"]["post"]
    assert "400" in operation["responses"] and "422" not in operation["responses"]
