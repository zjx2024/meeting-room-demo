from datetime import time, timedelta

from .errors import BusinessError


def validate_meeting(meeting, now):
    start, end = meeting.start_at, meeting.end_at
    if any(value.minute not in (0, 30) or value.second or value.microsecond for value in (start, end)):
        raise BusinessError(400, "time_grid", "开始和结束时间必须为整点或半点（30 分钟刻度）")
    if start.date() != end.date() or start.time() < time(8) or end.time() > time(20):
        raise BusinessError(400, "business_hours", "会议必须在同一天的 08:00～20:00 内举行")
    if end <= start:
        raise BusinessError(400, "time_order", "结束时间必须晚于开始时间")
    if not timedelta(minutes=30) <= end - start <= timedelta(hours=4):
        raise BusinessError(400, "duration", "会议最短 30 分钟，最长 4 小时")
    if start < now:
        raise BusinessError(400, "past_start", "开始时间已经过去，请选择未来的时间")
    if start > now + timedelta(days=7):
        raise BusinessError(400, "booking_window", "最多提前 7 天预约，请调整开始时间")
