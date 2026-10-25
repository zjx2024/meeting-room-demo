# 验证记录

使用步骤见 [使用指南](usage.md)，安装与测试命令见 [README](../README.md)。本文按最近一次功能验收、此前修订和初版记录排列；历史版本的展示规则不代表当前行为。当前功能对应“全天时间轴与精简明细”，OpenSpec 变更任务为 51/51 完成。

本次文档整理核对了现有实现、任务清单和已有浏览器报告，并检查本地文档链接；下方测试结果沿用对应功能验收记录，没有将文档整理记为重新执行功能测试。

## 最新修订：全天时间轴与精简明细

2026-10-25（北京时间）已执行：

| 检查 | 结果 |
| --- | --- |
| `.venv/bin/python -m pytest backend/tests -q` | 94 项后端测试通过 |
| `cd frontend && npm test` | 16 项时间可用性测试通过 |
| `npm run typecheck`、`npm run build` | 通过 |
| `npm run test:e2e` | development、demo 各 10 组场景通过 |
| `openspec validate meeting-room-booking-demo --strict` | 通过 |

真实 API 与临时数据库验证了创建后出现对应色块、取消后色块释放但明细保留，以及原有选择联动、时间选项禁用、权限、启停、并发弹窗、失败反馈和重启持久性。未修改后端 API、数据结构或业务校验。

新增隔离数据和固定时钟场景，用浏览器实际色块边界检查 08:00 起始、20:00 结束、半小时与四小时预约的位置和宽度；验证首尾相接色块分别对应两条预约，已取消记录只在明细中出现，其他会议室不混入。切换日期和房间会更新时间轴与明细。本人在其他房间的有效预约仍限制表单，但不画成当前房间占用。加载、读取失败及未选日期时没有空闲时间轴；恢复读取后正确显示。

桌面空记录及十二条记录时两张预约卡片等高。390px 手机保留完整 08:00～20:00 和半小时分隔，减少时间文字密度，无横向溢出；明细中的起止时间、主题、预约人、人数、状态及本人取消按钮完整可读。已查看[桌面时间轴](../test-results/development-timeline.png)和[手机时间轴](../test-results/development-timeline-mobile.png)。

实际报告为 [browser-report.json](../test-results/browser-report.json)，真实预约日期为 2026-10-26，数据库为 `/tmp/meeting-room-e2e-BbtCJq/development.sqlite3` 和 `/tmp/meeting-room-e2e-BbtCJq/demo.sqlite3`。时间轴隔离场景使用北京日期 2026-10-25、浏览器固定时间 07:00，不修改系统时间或默认演示数据。两种模式分别使用洛杉矶、纽约浏览器时区。以下保留此前验收历史，`test-results` 同名文件以最新运行结果为准。

## 会议室选择联动与可用时段（前次验收）

2026-10-25（北京时间）已执行：

| 检查 | 结果 |
| --- | --- |
| `.venv/bin/python -m pytest backend/tests -q` | 94 项后端测试通过 |
| `cd frontend && npm test` | 16 项时间可用性测试通过 |
| `npm run typecheck`、`npm run build` | 通过 |
| `npm run test:e2e` | development、demo 各 9 组场景通过 |
| `openspec validate meeting-room-booking-demo --strict` | 通过 |

浏览器在真实临时数据库上验证：卡片、标题下拉框和表单三处联动，键盘选择，单会议室列表过滤，停用房间可查询、不能创建，管理员操作不误选。开始和结束时间的占用选项已禁用；本人在其他房间的有效预约也参与限制，取消后释放。09:00～10:00 被占用时，08:30 可在 09:00 结束，10:00 可开始，结束时间不能跨过中间占用区间。纯函数测试另覆盖最长四小时、营业边界、过去时间、09:00:01、七天窗口边界、取消记录及不可用数据。

并发验收先让页面缓存可用时段，再用另一用户通过真实 API 创建相同时段，原页面提交得到 409 和匿名弹窗；关闭后输入保留、焦点回到可操作控件，预约数据重新读取，相关时间变为不可选。分别验证 Esc、确认按钮和重复弹窗。读取失败禁止选择时间和提交，恢复读取后可继续。创建、取消、启用/停用、重建前端、页面刷新及真实后端进程重启均回归通过。

两种模式分别使用洛杉矶、纽约浏览器时区，业务预约日期为 2026-10-26。可控时钟验证当前使用状态在开始、结束和跨北京日期时更新，与会议室选择及未来查询日期独立。桌面空列表和十二条单房间记录时两张预约卡片等高；390px 手机页面无横向溢出。已查看实际[桌面截图](../test-results/demo-desktop.png)、[长列表截图](../test-results/demo-current-state.png)和[手机截图](../test-results/demo-mobile.png)。

实际报告为 [browser-report.json](../test-results/browser-report.json)，数据库为 `/tmp/meeting-room-e2e-FDYNMA/development.sqlite3` 和 `/tmp/meeting-room-e2e-FDYNMA/demo.sqlite3`，未修改默认演示数据。下方保留此前验收历史；其中只读卡片规则已被本次选择联动替代，`test-results` 同名文件以最新运行结果为准。

## 匿名会议室冲突弹窗（前次验收）

2026-10-25（北京时间）已执行：后端完整测试 94 passed，前端类型检查与构建通过，development 和 demo 各 9 组浏览器场景通过，OpenSpec 严格校验通过。

后端四种重叠形态均验证返回 room_conflict，消息为“A101 在 09:00～10:00 已被预约”，响应不含原预约人姓名，且原预约不变、不新增失败记录。

浏览器验证了弹窗显示、弹窗内不含预约人姓名、初始焦点位于“知道了”、Esc 和确认按钮均可关闭、关闭后焦点回到提交按钮、原表单输入保留，以及重复冲突重新弹出。手机弹窗位于视口内，无横向溢出。容量和其他失败仍使用原页面提示。截图见 [桌面弹窗](../test-results/demo-conflict-dialog.png)和[手机弹窗](../test-results/demo-mobile-conflict-dialog.png)。

完整报告为 [browser-report.json](../test-results/browser-report.json)，本次真实测试数据库位于 `/tmp/meeting-room-e2e-9DXV22/`，没有使用演示数据库。浏览器验收中补齐了异步提交使原按钮失焦后的显式焦点恢复；修复后重新通过了类型检查、构建与两种模式完整验收。

## 会议室概况与恢复启用（前次验收）

2026-10-25（北京时间）已执行：

| 检查 | 结果 |
| --- | --- |
| `.venv/bin/python -m pytest` | 94 passed，含新增的启用权限、重复请求、记录保留、重启和失败回滚测试 |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过 |
| `npm run test:e2e` | development 与 demo 各 8 组场景通过 |

真实后端和临时 SQLite 数据库验证了停用后出现启用操作、恢复启用后可以创建预约、旧记录不变及重启保留。开发模式使用洛杉矶浏览器时区，单服务演示使用纽约浏览器时区。

当前状态边界使用隔离 API 数据和固定浏览器时钟验证：09:00 开始时为使用中、10:00 结束时为空闲；相邻下一场在 10:00 进入使用中；已取消记录不占用；跨北京日期自动重新读取当日数据。切换未来查询日期、表单时段和会议室不影响当前概况。读取失败显示状态暂不可用，重新读取后恢复。

浏览器核对了普通用户卡片没有选择或管理按钮、点击卡片不会改变表单选房、切换表单不改变卡片边框，以及桌面空列表、5 条真实预约和 12 条隔离预约时双卡片等高。手机布局无横向溢出。截图包括 [桌面](../test-results/demo-desktop.png)和[当前状态与长列表](../test-results/demo-current-state.png)。

最新报告为 [browser-report.json](../test-results/browser-report.json)，真实验收日期为 2026-10-26，数据库位于 `/tmp/meeting-room-e2e-K4pUDr/development.sqlite3` 和 `/tmp/meeting-room-e2e-K4pUDr/demo.sqlite3`。当前状态测试数据单独使用固定的北京日期，不修改演示数据库或服务端系统时间。

## 初版记录

以下保留初版验收历史，其中“按所选时段显示占用”的行为已由上述当前时间规则替代。

验证日期：2026-10-25（北京时间）。以下只记录已执行的检查。

### 环境与命令

Python 3.10.12、SQLite 3.37.2、Node 24.11.0；FastAPI 0.162.0、React 19.3.1、Vite 8.3.5、TypeScript 7.0.2、Playwright 1.64.1。依赖版本固定在 requirements.txt、package.json 和 package-lock.json。

| 检查 | 执行命令 | 结果 |
| --- | --- | --- |
| 后端业务与接口 | `.venv/bin/python -m pytest` | 88 passed |
| 前端类型 | `cd frontend && npm run typecheck` | 通过 |
| 前端构建 | `cd frontend && npm run build` | 通过，生成 frontend/dist |
| 浏览器端到端 | `cd frontend && npm run test:e2e` | development、demo 各 6 组场景通过 |
| 干净环境复现 | 新目录、新虚拟环境安装 requirements；执行 pytest、npm ci、typecheck、build | 88 项测试及前端安装、检查、构建全部通过 |

pytest 输出有 1 条 Starlette 对 TestClient 使用 HTTPX 的弃用提示，当前固定依赖版本的测试全部通过。没有跳过业务规则或验收场景来消除提示。

### 规格覆盖

| 能力 | 实际验证内容 |
| --- | --- |
| demo-users | 三个普通用户和一个超级管理员；用户切换、只读预约人、缺失/无效身份、代预约拒绝、管理员不能取消他人 |
| meeting-rooms | 三个房间的容量设备；所选时段占用；已取消和首尾相接不占用；普通用户停用被拒；停用保留旧预约；停用与空闲独立展示 |
| reservations | 输入、营业时间、同日、30/240 分钟边界、整点半点、非零秒/小数秒；当前时刻与七天上界；容量；两类重叠及包含；本人取消截止；中文错误；历史日期和取消记录；创建后即时展示 |
| data-persistence | 刷新、真实进程重启、重建应用实例、幂等初始化、前端重新构建；创建/取消/停用提交失败回滚；数据库路径不随工作目录变化 |

固定时钟测试单独验证了 09:00:01 不能创建当天 09:00 的预约，以及 now、now+7 天都包含在窗口内。七天上界开始的会议允许在窗口以外结束，但仍须满足同日营业时间和最长 4 小时。

两个独立数据库连接同时提交时，同房间同时间和同人不同房间两种场景均只保存一条有效预约。通过受控写事务顺序分别验证“创建先完成”和“停用先完成”的结果；数据库繁忙和提交失败均返回明确错误且不留下部分状态。

### 浏览器与本机演示

使用真实 Chromium，通过网页表单操作。development 使用 Vite 代理和洛杉矶浏览器时区；demo 只启动 Uvicorn，使用纽约浏览器时区，后端进程设置为 UTC。两种模式显示和提交的业务时间均为北京时间。

每种模式验证了以下 6 组场景：

1. 创建后列表即时展示、北京时间和只读预约人。
2. 用户切换、容量拒绝、会议室冲突和首尾相接占用展示。
3. 预约人跨会议室冲突、本人取消、保留取消记录和释放时段。
4. 超级管理员停用、原有未来预约继续有效、本人仍可取消，以及停用/空闲分别显示。
5. 查询历史日期、刷新页面、重新构建前端、停止并重启后端，逐字段对比记录及停用状态。
6. 模拟保存失败、网络断开和读取失败，验证保留输入、阻止重复提交、不显示虚构成功或空闲状态。

验收预约日期为 2026-10-26。浏览器测试数据库分别为 `/tmp/meeting-room-e2e-TpKc9o/development.sqlite3` 和 `/tmp/meeting-room-e2e-TpKc9o/demo.sqlite3`；默认演示数据库不用于测试。报告及截图保存在 [test-results](../test-results/)，其中 browser-report.json 记录模式、时区、日期和数据文件。桌面及 390px 手机布局均已检查，中文可读且页面无横向溢出。

### 独立环境与调试记录

在 `/tmp/meeting-room-tools/reproduction` 复制源码（不带原虚拟环境、node_modules、数据库和构建产物），新建虚拟环境并重新按固定依赖安装。该环境执行 pytest 得到 88 passed，npm ci、类型检查与构建全部成功。

本机精简 Linux 起初缺少 pip/ensurepip，按 README 的无 pip 虚拟环境初始化步骤准备依赖；Linux Node 在临时工具目录中使用。Chromium 缺少 libnspr4、libnss3、libasound2 且没有 sudo 权限，实际通过 apt-get download 下载这三个包，用 dpkg-deb 解包到 `/tmp/meeting-room-tools/browser-libs`，并设置 `LD_LIBRARY_PATH=/tmp/meeting-room-tools/browser-libs/usr/lib/x86_64-linux-gnu` 后完成上述浏览器验收，没有以静态检查替代浏览器操作。

调试中修复了 TypeScript 样式导入缺少 Vite 类型声明，以及同一日期重复触发 change 后清空占用状态却不重查的问题。修复后重新执行了类型检查、构建及两种模式的完整浏览器验收。
