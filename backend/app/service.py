import json
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from .database import Database
from .errors import BusinessError
from .validation import validate_meeting

BEIJING = ZoneInfo("Asia/Shanghai")

RESERVATION_QUERY = """SELECT r.*, rooms.name AS room_name, users.name AS booker_name
    FROM reservations r JOIN rooms ON rooms.id = r.room_id JOIN users ON users.id = r.booker_id"""


def system_clock():
    return datetime.now(BEIJING)


class MeetingService:
    def __init__(self, database: Database, clock=system_clock):
        self.database = database
        self.clock = clock

    def now(self):
        return self.clock().astimezone(BEIJING)

    def users(self):
        with self.database.connect() as connection:
            return [dict(row) for row in connection.execute("SELECT * FROM users ORDER BY id")]

    def rooms(self):
        with self.database.connect() as connection:
            return [self.room_dict(row) for row in connection.execute("SELECT * FROM rooms ORDER BY id")]

    @staticmethod
    def room_dict(row):
        return {**dict(row), "equipment": json.loads(row["equipment"]), "enabled": bool(row["enabled"])}

    @staticmethod
    def current_user(connection, user_id):
        try:
            parsed = int(user_id)
        except (ValueError, TypeError):
            parsed = None
        user = connection.execute("SELECT * FROM users WHERE id = ?", (parsed,)).fetchone()
        if user is None:
            raise BusinessError(400, "invalid_user", "请选择有效的当前用户")
        return user

    @staticmethod
    def reservation_dict(row):
        return {
            **dict(row),
            "start_at": datetime.fromtimestamp(row["start_at"], BEIJING),
            "end_at": datetime.fromtimestamp(row["end_at"], BEIJING),
            "status_label": "已预约" if row["status"] == "booked" else "已取消",
        }

    def reservations(self, selected_date):
        try:
            day = date.fromisoformat(selected_date)
            if day.isoformat() != selected_date:
                raise ValueError()
        except (ValueError, TypeError):
            raise BusinessError(400, "invalid_date", "查询日期格式不正确，请使用 YYYY-MM-DD")
        start = datetime.combine(day, time.min, BEIJING)
        with self.database.connect() as connection:
            rows = connection.execute(
                RESERVATION_QUERY + " WHERE r.start_at >= ? AND r.start_at < ? ORDER BY r.start_at, rooms.name, r.id",
                (int(start.timestamp()), int(start.timestamp()) + 86400),
            )
            return [self.reservation_dict(row) for row in rows]

    def create(self, meeting, user_id):
        with self.database.connect(write=True) as connection:
            user = self.current_user(connection, user_id)
            now = self.now()
            if meeting.booker_id is not None and meeting.booker_id != user["id"]:
                raise BusinessError(403, "different_booker", "预约人必须是当前用户，不能代他人预约")
            validate_meeting(meeting, now)
            room = connection.execute("SELECT * FROM rooms WHERE id = ?", (meeting.room_id,)).fetchone()
            if room is None:
                raise BusinessError(404, "room_missing", "会议室不存在，请重新选择")
            if not room["enabled"]:
                raise BusinessError(409, "room_disabled", f"{room['name']} 已停用，不能创建新预约")
            if meeting.attendee_count > room["capacity"]:
                raise BusinessError(400, "capacity", f"{room['name']} 最多容纳 {room['capacity']} 人，请调整人数或选择其他会议室")
            start, end = int(meeting.start_at.timestamp()), int(meeting.end_at.timestamp())
            for column, value, code in (("room_id", room["id"], "room_conflict"), ("booker_id", user["id"], "booker_conflict")):
                # The column names above are constants, never request input.
                conflict = connection.execute(
                    RESERVATION_QUERY + f" WHERE r.{column} = ? AND r.status = 'booked' AND r.start_at < ? AND r.end_at > ? ORDER BY r.start_at LIMIT 1",
                    (value, end, start),
                ).fetchone()
                if conflict is not None:
                    interval = f"{datetime.fromtimestamp(conflict['start_at'], BEIJING):%H:%M}～{datetime.fromtimestamp(conflict['end_at'], BEIJING):%H:%M}"
                    message = (f"{room['name']} 在 {interval} 已被预约" if code == "room_conflict"
                               else f"{user['name']} 在 {interval} 已有 {conflict['room_name']} 的预约，不能同时参加两个会议")
                    raise BusinessError(409, code, message, {"reservation_id": conflict["id"]})
            cursor = connection.execute(
                "INSERT INTO reservations(room_id, booker_id, subject, attendee_count, start_at, end_at, status) VALUES (?, ?, ?, ?, ?, ?, 'booked')",
                (room["id"], user["id"], meeting.subject, meeting.attendee_count, start, end),
            )
            result = self.reservation_dict(connection.execute(RESERVATION_QUERY + " WHERE r.id = ?", (cursor.lastrowid,)).fetchone())
        return result

    def cancel(self, reservation_id, user_id):
        with self.database.connect(write=True) as connection:
            user = self.current_user(connection, user_id)
            now = self.now()
            reservation = connection.execute(RESERVATION_QUERY + " WHERE r.id = ?", (reservation_id,)).fetchone()
            if reservation is None:
                raise BusinessError(404, "reservation_missing", "预约不存在")
            if reservation["booker_id"] != user["id"]:
                raise BusinessError(403, "not_owner", "只能取消自己的预约")
            if reservation["status"] != "booked":
                raise BusinessError(409, "already_cancelled", "该预约已取消，无需重复操作")
            if now >= datetime.fromtimestamp(reservation["start_at"], BEIJING):
                raise BusinessError(409, "already_started", "会议已经开始，不能取消")
            connection.execute("UPDATE reservations SET status = 'cancelled' WHERE id = ?", (reservation_id,))
            result = self.reservation_dict(connection.execute(RESERVATION_QUERY + " WHERE r.id = ?", (reservation_id,)).fetchone())
        return result

    def disable(self, room_id, user_id):
        return self.set_enabled(room_id, user_id, False)

    def enable(self, room_id, user_id):
        return self.set_enabled(room_id, user_id, True)

    def set_enabled(self, room_id, user_id, enabled):
        with self.database.connect(write=True) as connection:
            user = self.current_user(connection, user_id)
            if user["role"] != "super_admin":
                action = "启用" if enabled else "停用"
                raise BusinessError(403, "not_admin", f"只有超级管理员可以{action}会议室")
            room = connection.execute("SELECT * FROM rooms WHERE id = ?", (room_id,)).fetchone()
            if room is None:
                raise BusinessError(404, "room_missing", "会议室不存在")
            connection.execute("UPDATE rooms SET enabled = ? WHERE id = ?", (int(enabled), room_id))
            result = self.room_dict(connection.execute("SELECT * FROM rooms WHERE id = ?", (room_id,)).fetchone())
        return result
