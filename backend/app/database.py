import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]

SCHEMA = (
    """CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL CHECK(role IN ('user', 'super_admin')))""",
    """CREATE TABLE IF NOT EXISTS rooms (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
        capacity INTEGER NOT NULL CHECK(capacity > 0), equipment TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)))""",
    """CREATE TABLE IF NOT EXISTS reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL REFERENCES rooms(id),
        booker_id INTEGER NOT NULL REFERENCES users(id),
        subject TEXT NOT NULL CHECK(length(trim(subject)) > 0),
        attendee_count INTEGER NOT NULL CHECK(attendee_count > 0 AND typeof(attendee_count) = 'integer'),
        start_at INTEGER NOT NULL, end_at INTEGER NOT NULL CHECK(end_at > start_at),
        status TEXT NOT NULL CHECK(status IN ('booked', 'cancelled')))""",
    "CREATE INDEX IF NOT EXISTS reservations_room_time ON reservations(room_id, status, start_at, end_at)",
    "CREATE INDEX IF NOT EXISTS reservations_booker_time ON reservations(booker_id, status, start_at, end_at)",
)


class Database:
    def __init__(self, path: str | Path, timeout: float = 5):
        selected = Path(path).expanduser()
        self.path = selected if selected.is_absolute() else PROJECT_ROOT / selected
        self.timeout = timeout

    @contextmanager
    def connect(self, write=False):
        connection = sqlite3.connect(self.path, timeout=self.timeout, isolation_level=None)
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("PRAGMA foreign_keys = ON")
            if write:
                connection.execute("BEGIN IMMEDIATE")
            yield connection
            if write:
                connection.commit()
        except BaseException:
            if connection.in_transaction:
                connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect(write=True) as connection:
            for statement in SCHEMA:
                connection.execute(statement)
            connection.executemany(
                "INSERT INTO users(id, name, role) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING",
                [(1, "张三", "user"), (2, "李四", "user"), (3, "王五", "user"), (4, "超级管理员", "super_admin")],
            )
            for room_id, name, capacity, equipment in [
                (1, "A101", 4, ["电视"]),
                (2, "A102", 8, ["电视", "视频会议"]),
                (3, "B201", 16, ["投影", "电视", "视频会议"]),
            ]:
                connection.execute(
                    "INSERT INTO rooms(id, name, capacity, equipment) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
                    (room_id, name, capacity, json.dumps(equipment, ensure_ascii=False)),
                )
