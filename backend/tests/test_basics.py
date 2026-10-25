import sqlite3

import pytest
from fastapi.testclient import TestClient

from app.database import Database, PROJECT_ROOT
from app.main import create_app


def test_factory_without_frontend(client, app, clock):
    response = client.get("/api/users")
    assert response.status_code == 200
    assert response.json()["server_time"] == clock.value.isoformat()
    assert app.state.database.path.is_file()
    assert client.get("/docs").status_code == 200
    assert client.get("/openapi.json").status_code == 200
    assert "先在 frontend" in client.get("/").text
    unknown = client.get("/api/missing")
    assert unknown.status_code == 404
    assert unknown.json()["error"]["message"] == "请求的资源不存在"


def test_exact_seeds(client):
    users = client.get("/api/users").json()["data"]
    assert [(u["name"], u["role"]) for u in users] == [
        ("张三", "user"), ("李四", "user"), ("王五", "user"), ("超级管理员", "super_admin"),
    ]
    rooms = client.get("/api/rooms").json()["data"]
    assert [(r["name"], r["capacity"], r["equipment"], r["enabled"]) for r in rooms] == [
        ("A101", 4, ["电视"], True), ("A102", 8, ["电视", "视频会议"], True),
        ("B201", 16, ["投影", "电视", "视频会议"], True),
    ]


def test_initialization_preserves_existing_data(client, app, clock, tmp_path):
    db = app.state.database
    with db.connect(write=True) as connection:
        connection.execute("UPDATE rooms SET enabled = 0 WHERE id = 1")
        connection.execute("INSERT INTO reservations(room_id, booker_id, subject, attendee_count, start_at, end_at, status) VALUES (1,1,'保留',1,100,200,'cancelled')")
    with TestClient(create_app(db.path, clock=clock, frontend_dir=tmp_path / "dist")) as second:
        assert second.get("/api/rooms").json()["data"][0]["enabled"] is False
        assert len(second.get("/api/users").json()["data"]) == 4
    db.initialize()
    with db.connect() as connection:
        assert connection.execute("SELECT count(*) FROM rooms").fetchone()[0] == 3
        assert connection.execute("SELECT status FROM reservations").fetchone()[0] == "cancelled"


def test_paths_are_independent_of_working_directory(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("MEETING_ROOM_DB_PATH", raising=False)
    assert create_app().state.database.path == PROJECT_ROOT / "instance/meeting-room.sqlite3"
    monkeypatch.setenv("MEETING_ROOM_DB_PATH", "instance/selected.sqlite3")
    assert create_app().state.database.path == PROJECT_ROOT / "instance/selected.sqlite3"
    assert Database(tmp_path / "explicit.sqlite3").path == tmp_path / "explicit.sqlite3"


@pytest.mark.parametrize("statement", [
    "INSERT INTO rooms VALUES (9,'bad',0,'[]',1)",
    "INSERT INTO users VALUES (9,'bad','owner')",
    "INSERT INTO reservations VALUES (9,999,1,'bad',1,100,200,'booked')",
    "INSERT INTO reservations VALUES (9,1,1,'bad',0,100,200,'booked')",
    "INSERT INTO reservations VALUES (9,1,1,'bad',1,200,100,'booked')",
    "INSERT INTO reservations VALUES (9,1,1,'bad',1,100,200,'free')",
])
def test_database_constraints(client, app, statement):
    with pytest.raises(sqlite3.IntegrityError):
        with app.state.database.connect(write=True) as connection:
            connection.execute(statement)
