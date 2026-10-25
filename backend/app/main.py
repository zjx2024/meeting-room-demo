import logging
import os
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Header
from fastapi.exceptions import RequestValidationError
from fastapi.openapi.utils import get_openapi
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException

from .database import Database, PROJECT_ROOT
from .errors import BusinessError
from .schemas import ErrorResponse, Reservation, ReservationInput, Response, Room, User
from .service import MeetingService, system_clock


def create_app(database_path=None, clock=system_clock, frontend_dir=None, database=None):
    db = database or Database(database_path or os.getenv("MEETING_ROOM_DB_PATH") or PROJECT_ROOT / "instance/meeting-room.sqlite3")
    service = MeetingService(db, clock)
    dist = Path(frontend_dir) if frontend_dir is not None else PROJECT_ROOT / "frontend/dist"

    @asynccontextmanager
    async def lifespan(app):
        db.initialize()
        yield

    errors = {status: {"model": ErrorResponse, "description": description} for status, description in {
        400: "输入或当前用户无效", 403: "没有操作权限", 404: "资源不存在",
        409: "预约冲突或状态不允许", 500: "存储失败", 503: "系统繁忙",
    }.items()}
    app = FastAPI(title="会议室预约 Demo", version="1.0.0", lifespan=lifespan, responses=errors)
    app.state.service = service
    app.state.database = db

    def ok(data):
        return {"data": data, "server_time": service.now()}

    def failure(status, code, message, details=None):
        return JSONResponse(status_code=status, content={
            "error": {"code": code, "message": message, "details": details},
            "server_time": service.now().isoformat(),
        })

    @app.exception_handler(BusinessError)
    async def business_error(request, exc):
        return failure(exc.status, exc.code, exc.message, exc.details)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        labels = {"room_id": "会议室", "subject": "会议主题", "attendee_count": "参会人数",
                  "start_at": "开始时间", "end_at": "结束时间", "date": "查询日期", "booker_id": "预约人"}
        details = []
        for error in exc.errors():
            field = str(error["loc"][-1])
            label = labels.get(field, "请求内容")
            if error["type"] == "missing":
                message = f"请填写{label}"
            elif field == "attendee_count":
                message = "参会人数必须为正整数"
            elif field == "subject":
                message = "会议主题不能为空，且必须是文字"
            elif error["type"] == "value_error":
                message = str(error.get("ctx", {}).get("error", f"{label}格式不正确"))
            else:
                message = f"{label}格式不正确，请检查后重试"
            details.append({"field": field, "message": message})
        return failure(400, "invalid_input", details[0]["message"], details)

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        return failure(exc.status_code, "http_error", "请求的资源不存在" if exc.status_code == 404 else "该请求方式不被支持")

    @app.exception_handler(sqlite3.Error)
    async def storage_error(request, exc):
        if "locked" in str(exc).lower() or "busy" in str(exc).lower():
            return failure(503, "storage_busy", "系统正忙，请稍后重试")
        logging.getLogger(__name__).exception("Database operation failed")
        return failure(500, "storage_failed", "暂时无法读取或保存数据，请稍后重试")

    @app.exception_handler(Exception)
    async def unexpected_error(request, exc):
        logging.getLogger(__name__).exception("Request failed")
        return failure(500, "request_failed", "操作暂时无法完成，请稍后重试")

    @app.get("/api/users", response_model=Response[list[User]])
    def users():
        return ok(service.users())

    @app.get("/api/rooms", response_model=Response[list[Room]])
    def rooms():
        return ok(service.rooms())

    @app.get("/api/reservations", response_model=Response[list[Reservation]])
    def reservations(date: str):
        return ok(service.reservations(date))

    @app.post("/api/reservations", response_model=Response[Reservation], status_code=201)
    def create(meeting: ReservationInput, user_id: str | None = Header(default=None, alias="X-Demo-User-Id")):
        return ok(service.create(meeting, user_id))

    @app.post("/api/reservations/{reservation_id}/cancel", response_model=Response[Reservation])
    def cancel(reservation_id: int, user_id: str | None = Header(default=None, alias="X-Demo-User-Id")):
        return ok(service.cancel(reservation_id, user_id))

    @app.post("/api/rooms/{room_id}/disable", response_model=Response[Room])
    def disable(room_id: int, user_id: str | None = Header(default=None, alias="X-Demo-User-Id")):
        return ok(service.disable(room_id, user_id))

    @app.post("/api/rooms/{room_id}/enable", response_model=Response[Room])
    def enable(room_id: int, user_id: str | None = Header(default=None, alias="X-Demo-User-Id")):
        return ok(service.enable(room_id, user_id))

    @app.get("/", include_in_schema=False)
    def index():
        if (dist / "index.html").is_file():
            return FileResponse(dist / "index.html")
        return HTMLResponse("<html lang='zh-CN'><meta charset='utf-8'><title>会议室预约</title><p>请先在 frontend 执行 npm ci 和 npm run build，再打开此页面。开发时可使用 Vite 页面，后端 API 已可用。</p></html>", status_code=503)

    app.mount("/assets", StaticFiles(directory=dist / "assets", check_dir=False), name="assets")

    def openapi():
        if app.openapi_schema is None:
            schema = get_openapi(title=app.title, version=app.version, routes=app.routes)
            for path in schema["paths"].values():
                for operation in path.values():
                    if isinstance(operation, dict):
                        operation.get("responses", {}).pop("422", None)
            app.openapi_schema = schema
        return app.openapi_schema

    app.openapi = openapi
    return app
