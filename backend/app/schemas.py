from datetime import datetime
import re
from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .service import BEIJING


class User(BaseModel):
    id: int
    name: str
    role: Literal["user", "super_admin"]


class Room(BaseModel):
    id: int
    name: str
    capacity: int
    equipment: list[str]
    enabled: bool


class ReservationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    room_id: int = Field(strict=True, gt=0)
    subject: str = Field(strict=True, min_length=1)
    attendee_count: int = Field(strict=True, gt=0)
    start_at: datetime
    end_at: datetime
    booker_id: int | None = Field(default=None, strict=True, gt=0)

    @field_validator("subject", mode="before")
    @classmethod
    def trim_subject(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("start_at", "end_at", mode="before")
    @classmethod
    def require_iso_time(cls, value):
        if not isinstance(value, (str, datetime)):
            raise ValueError("时间必须是带时区的 ISO 日期时间")
        if isinstance(value, str):
            if not re.match(r"^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}", value):
                raise ValueError("时间必须是带时区的 ISO 日期时间")
            fraction = re.search(r"[T ]\d{2}:\d{2}:\d{2}[.,](\d+)", value)
            if fraction and any(digit != "0" for digit in fraction.group(1)):
                raise ValueError("开始和结束时间必须为整点或半点，不能包含非零小数秒")
        return value

    @field_validator("start_at", "end_at")
    @classmethod
    def require_timezone(cls, value):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("时间必须包含时区，例如 +08:00（北京时间）")
        return value.astimezone(BEIJING)


class Reservation(BaseModel):
    id: int
    room_id: int
    room_name: str
    booker_id: int
    booker_name: str
    subject: str
    attendee_count: int
    start_at: datetime
    end_at: datetime
    status: Literal["booked", "cancelled"]
    status_label: Literal["已预约", "已取消"]


class ErrorInfo(BaseModel):
    code: str
    message: str
    details: list[dict] | dict | None = None


class ErrorResponse(BaseModel):
    error: ErrorInfo
    server_time: datetime


T = TypeVar("T")


class Response(BaseModel, Generic[T]):
    data: T
    server_time: datetime
