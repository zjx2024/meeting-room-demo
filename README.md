# 轻量级会议室预约系统 Demo

FastAPI + React + Vite + TypeScript + SQLite。本项目按原始 DOCX、用户确认及 OpenSpec 规格开发，用于本机演示。

## 当前功能

| 页面区域 | 功能 |
| --- | --- |
| 当前用户 | 切换张三、李四、王五或超级管理员，预约人自动使用当前用户 |
| 会议室概况 | 展示容量、设备、启用状态和当前北京时间的空闲/使用中；支持选择会议室 |
| 当日预约 | 标题下拉框切换会议室，按所选日期展示 08:00～20:00 时间轴及精简明细 |
| 创建预约 | 与卡片及当日预约共享会议室选择，根据已有预约和业务规则禁用不可用时间 |
| 取消与管理 | 本人可在会议开始前取消；超级管理员可启用/停用会议室，原有记录保留 |

使用步骤、演示流程和常见问题见 [使用指南](docs/usage.md)；安装与启动见下文；实际测试结果见 [验证记录](docs/verification.md)。

## 环境与安装

在项目根目录执行。需要 Python 3.10+ 和 Node.js 24（本次使用 24.11.0）。Python 依赖固定在 `backend/requirements.txt`，前端依赖和锁文件在 `frontend` 中。

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
cd frontend
npm ci
cd ..
```

如果精简 Linux 环境没有 pip/ensurepip，可改用以下虚拟环境初始化步骤，然后执行上面的依赖安装：

```bash
python3 -m venv --without-pip .venv
curl -fsSL https://bootstrap.pypa.io/get-pip.py -o /tmp/meeting-room-get-pip.py
.venv/bin/python /tmp/meeting-room-get-pip.py
source .venv/bin/activate
```

Windows PowerShell 可使用 `py -3 -m venv .venv` 和 `.venv\Scripts\Activate.ps1`。下文命令均在已激活虚拟环境后执行；前后端应使用同一个选定运行环境中的工具。

## 开发模式

终端一，在项目根目录启动后端：

```bash
python -m uvicorn app.main:create_app --factory --app-dir backend --host 127.0.0.1 --port 8000 --reload
```

终端二启动前端：

```bash
cd frontend
npm run dev
```

打开 http://127.0.0.1:5173 。Vite 将 `/api` 请求原路径代理到 8000，并传递 `X-Demo-User-Id`。接口文档位于 http://127.0.0.1:8000/docs ，原始 OpenAPI 位于 `/openapi.json`。未构建前端时，后端 API 与测试也可正常使用。

## 单服务演示

先构建前端：

```bash
cd frontend
npm run typecheck
npm run build
cd ..
python -m uvicorn app.main:create_app --factory --app-dir backend --host 127.0.0.1 --port 8000
```

打开 http://127.0.0.1:8000 。此时页面与 API 都由后端提供，可关闭 Vite。首次安装后再次复现依赖时使用 `npm ci`。未生成 `frontend/dist` 时，根页面会明确提示先构建，不会阻止后端 API 启动。

修改前端源码后，8000 页面需要在 `frontend` 目录重新执行 `npm run build`，然后刷新浏览器才能看到新版本。开发期间使用 5173 页面可直接查看 Vite 更新；两种入口访问的是同一后端与数据库。

## 停止与重新启动

上述启动命令均在当前终端前台运行。停止时，在运行服务的终端按 **Ctrl+C**（键盘快捷键，无需输入命令），等待进程退出、终端恢复命令提示符。

| 运行方式 | 停止方法 |
| --- | --- |
| 单服务演示（8000） | 在运行 `python -m uvicorn ...` 的终端按 Ctrl+C |
| 开发模式后端（8000） | 在运行 Uvicorn 的终端按 Ctrl+C，使用 `--reload` 时也这样停止 |
| 开发模式前端（5173） | 在运行 `npm run dev` 的终端按 Ctrl+C；若终端询问是否终止批处理，输入 `Y` 并回车 |

开发模式需要分别停止前后端两个终端。关闭网页不会停止服务。停止后预约数据仍保存在原数据库中。

重新启动单服务演示时，在项目根目录、已激活虚拟环境的终端执行：

```bash
python -m uvicorn app.main:create_app --factory --app-dir backend --host 127.0.0.1 --port 8000
```

前端源码没有变化时，无需再次构建；修改了前端源码时，先按“单服务演示”中的步骤重新构建。执行自动浏览器验收前，也应先按上述方法停止占用 8000、5173 的服务。

## 数据与身份

- 默认数据库为项目根目录的 `instance/meeting-room.sqlite3`，不随启动工作目录改变，前端重新构建不会清除数据。
- 可在启动前设置 `MEETING_ROOM_DB_PATH` 指向独立演示文件，例如 `export MEETING_ROOM_DB_PATH=/tmp/meeting-room-demo.sqlite3`。相对路径按项目根目录解析。
- 首次启动预置 A101（4 人、电视）、A102（8 人、电视/视频会议）、B201（16 人、投影/电视/视频会议），均启用，不预置预约。
- 用户选择器包含张三、李四、王五和一个超级管理员。当前选择即模拟操作身份，不是登录认证；预约人固定为当前用户。
- 普通用户只能取消自己的未开始预约。超级管理员额外可以启用或停用会议室，也不能取消别人的预约。本 Demo 没有用户管理或其他会议室管理功能。
- 已取消记录保留；启用或停用不会改变既有预约状态，也不会解除有效预约人的时间占用。重启初始化不会覆盖这些状态。

## 页面操作

1. 选择当前用户，再选择查询日期。创建预约也使用这个日期。
2. 点击会议室卡片，或切换当日预约标题/创建表单的会议室下拉框；三处选择同步，选中卡片有边框高亮。停用会议室可从卡片或标题下拉框选中查看。
3. 查看全天时间轴：08:00～20:00 每格半小时，绿色色块对应有效预约的起止位置和时长，其余留白。下方明细展示主题、预约人、时间、人数、状态和取消操作；已取消记录仅保留在明细中。
4. 在创建表单填写主题和人数，选择可用开始/结束时间，提交后时间轴、明细和可用选项一起更新。原选择变为不可用时会保留输入，需要重新选时。
5. 本人在会议开始前可通过明细中的“取消”释放时段。超级管理员可在概况卡片启用/停用房间，管理按钮不会改变当前选房。

概况显示的是当前时刻的使用状态，时间轴显示的是所选日期的预约安排。时间轴留白表示该房间没有有效预约，创建是否可选还受本人跨房间冲突、时间窗口和启用状态等规则限制。加载、读取失败和未选择日期时不显示空闲时间轴。手机保留完整营业时间与半小时分隔，减少文字刻度密度。

## 业务规则

所有日期、时间和取消截止均按北京时间（Asia/Shanghai）解释，浏览器默认时区不参与计算。

1. 会议同日举行，完整时间范围在 08:00～20:00 内；开始必须早于结束。
2. 时长 30～240 分钟，包含上下限。两端只能是整点或半点，秒与小数秒均为零。
3. 服务端当前时刻 ≤ 开始时间 ≤ 当前时刻 + 7×24 小时，包含两端；只限制开始时间。当前时间不会舍入：现在是 09:00:01，就不能预约当天 09:00。
4. 人数为正整数且不超过房间容量；空白主题不能提交。
5. 同一会议室、同一预约人的有效预约均不能重叠，预约人规则跨会议室生效。09:00～10:00 与 10:00～11:00 可首尾相接。
6. 取消要求当前用户是预约人，且服务端当前时刻严格早于开始时间。开始时刻及之后均不能取消。
7. 取消只改变状态，不删除记录，并释放会议室和预约人的时段。
8. 会议室按当前北京时间显示“空闲／使用中”：有效预约满足开始 ≤ 当前时间 < 结束时显示“使用中”，与查询日期和表单时段无关。预约记录仍显示“已预约／已取消”；会议结束后记录状态不会自动改变。
9. 查询日期没有过去或七天限制，可查询所选会议室的历史及取消记录。

开始和结束时间下拉框根据现有有效预约禁用不可用选项，并显示灰色和“不可用”标识；已取消记录不占用时间。计算同时考虑所选会议室和当前用户在其他会议室的预约。开始时间须留出至少 30 分钟；结束时间会检查整个会议区间，不能跨过中途已被预约的时间。例如 09:00～10:00 已预约，08:30 开始可选 09:00 结束，也可从 10:00 开始，但不能从 08:30 跨到 10:30。过去时间、超出七天窗口及不满足时长的选项也不可选；读取失败时暂停创建。

服务端在写事务中再次执行校验，页面显示的空闲不代表提交时一定成功。失败信息说明具体原因；数据库繁忙提示稍后重试，存储失败不会宣告成功。

会议室时间冲突使用居中弹窗提示，例如“A101 在 09:00～10:00 已被预约”，不显示原预约人姓名。它用于其他用户在本页刷新前提交预约等并发情况。点击“知道了”或按 Esc 关闭后，原表单输入仍保留，并重新读取预约、更新不可用选项，可调整会议室或时间后重试。其他校验错误继续显示在页面中。

概况中的时间边界每秒更新；概况及所选日期预约每 30 秒、页面重新可见时及本页面成功操作后刷新。时间选项按最新数据和当前时间更新，原选择变为不可用时保留输入并禁止提交。概况读取失败显示状态暂不可用。桌面上的当日预约与创建预约卡片等高，窄屏自然堆叠。

## API

成功响应为 `{ "data": ..., "server_time": "...+08:00" }`；失败响应为 `{ "error": { "code": "...", "message": "中文原因", "details": null }, "server_time": "...+08:00" }`。

| 方法与路径 | 用途 |
| --- | --- |
| GET /api/users | 示例用户与角色 |
| GET /api/rooms | 会议室、容量、设备与启用状态 |
| GET /api/reservations?date=YYYY-MM-DD | 该北京日期的全部预约，包含取消及停用会议室的记录 |
| POST /api/reservations | 创建本人的预约 |
| POST /api/reservations/{id}/cancel | 取消本人的未开始预约 |
| POST /api/rooms/{id}/disable | 超级管理员停用会议室 |
| POST /api/rooms/{id}/enable | 超级管理员恢复启用会议室 |

日期查询 API 返回当天所有会议室的记录，页面按当前选房过滤时间轴和明细；完整结果用于判断当前用户在其他会议室的时间冲突。

写接口必须携带 `X-Demo-User-Id`（1=张三，2=李四，3=王五，4=超级管理员）。创建 JSON 为 `room_id`、`subject`、`attendee_count`、`start_at`、`end_at`；时间使用带偏移的 ISO 字符串。服务端不允许指定其他人为预约人。

以下 Bash 示例计算北京时间明天，避免固定日期过期；在独立数据库上执行可重复演示：

```bash
DEMO_DATE=$(python -c 'from datetime import datetime,timedelta; from zoneinfo import ZoneInfo; print((datetime.now(ZoneInfo("Asia/Shanghai"))+timedelta(days=1)).date())')
curl -s http://127.0.0.1:8000/api/reservations -H 'Content-Type: application/json' -H 'X-Demo-User-Id: 1' --data "{\"room_id\":1,\"subject\":\"项目讨论\",\"attendee_count\":4,\"start_at\":\"${DEMO_DATE}T09:00:00+08:00\",\"end_at\":\"${DEMO_DATE}T10:00:00+08:00\"}"
```

重复同房间请求会返回包含会议室及时段的已被预约提示，不包含原预约人姓名；前端依据 room_conflict 错误码显示弹窗。将人数改为 5 可验证 A101 容量限制；保持用户为 1、改成房间 2 并选择重叠时段可验证预约人冲突。用返回的预约 ID 调用取消接口即可释放时段。字段错误返回 400，权限不足 403，资源不存在 404，业务冲突 409，存储失败 500，数据库繁忙 503；框架参数校验也统一为 400 和中文说明。

## 验证

```bash
python -m pytest
cd frontend
npm test
npm run typecheck
npm run build
```

后端测试使用固定时钟、独立临时文件数据库，不修改演示数据。`npm test` 使用 Node 内置测试验证时间可用性计算。浏览器和两种启动模式的实际验证结果见 [验证记录](docs/verification.md)。

最近一次功能验收（2026-10-25）：94 项后端测试、16 项前端时间测试、两种模式各 10 组浏览器场景，以及类型检查、构建和 OpenSpec 严格校验均通过。当前 OpenSpec 变更任务为 51/51 完成；报告及验收日期详见验证记录。

自动浏览器验收使用 Playwright，包含两种启动模式、不同浏览器时区、刷新/重启、失败反馈和移动端布局。先按 [停止与重新启动](#停止与重新启动) 停止正在运行的服务，确保 8000、5173 端口可用，再执行：

```bash
cd frontend
npx playwright install chromium
npm run test:e2e
```

脚本会启动和关闭自己的服务，使用独立临时数据库，并将报告、截图和服务日志写入项目根目录的 `test-results/`。默认使用项目 `.venv` 中的 Python；其他虚拟环境可用 `MEETING_ROOM_PYTHON` 指定 Python 可执行文件。Linux 缺少浏览器运行库时，可在具备系统安装权限的环境执行 `npx playwright install-deps chromium`；本次无管理员权限环境的验证处理见验证记录。

建议依次演示：创建预约与时间轴色块 → 三处选房联动 → 已占用及本人跨房间时段禁用 → 取消释放但保留明细 → 管理员停用/启用 → 刷新与重启保留。并发弹窗需在其他窗口已提交、当前页尚未刷新时触发，完整步骤及预期结果见 [演示流程](docs/usage.md#演示流程)。

## SDD 与 AI 过程

- 原始需求：[轻量级会议室预约系统_Demo需求说明.docx](轻量级会议室预约系统_Demo需求说明.docx)
- 规划：[proposal](openspec/changes/meeting-room-booking-demo/proposal.md)、[设计](openspec/changes/meeting-room-booking-demo/design.md)、[规格](openspec/changes/meeting-room-booking-demo/specs/)、[任务](openspec/changes/meeting-room-booking-demo/tasks.md)
- [主要 AI 会话记录](docs/ai-session-record.md)
- [验证记录](docs/verification.md)
- [使用指南与常见问题](docs/usage.md)

应用不包含审批、通知、重复会议、代预约或公网部署。归档 OpenSpec 变更是单独的后续操作。
