import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const frontend = fileURLToPath(new URL('..', import.meta.url));
const root = resolve(frontend, '..');
const python = process.env.MEETING_ROOM_PYTHON || join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const viteScript = join(frontend, 'node_modules/vite/bin/vite.js');
const output = join(root, 'test-results');
const dataDirectory = mkdtempSync(join(tmpdir(), 'meeting-room-e2e-'));
mkdirSync(output, { recursive: true });
const report = { completed_at: null, data_directory: dataDirectory, modes: [] };
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const roomNames = { 1: 'A101', 2: 'A102', 3: 'B201' };

function startBackend(database) {
  return spawn(python, ['-m', 'uvicorn', 'app.main:create_app', '--factory', '--app-dir', join(root, 'backend'), '--host', '127.0.0.1', '--port', '8000'], {
    cwd: root, env: { ...process.env, MEETING_ROOM_DB_PATH: database, TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  await exited;
  clearTimeout(timer);
}

async function ready(url, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error('服务启动失败：' + child.exitCode);
    try { if ((await fetch(url)).ok) return; } catch { /* Wait for this test's server. */ }
    await delay(100);
  }
  throw new Error('等待服务超时：' + url);
}

async function api(path) {
  const response = await fetch('http://127.0.0.1:8000/api' + path);
  assert.equal(response.status, 200);
  return response.json();
}

async function createAs(day, roomId, start, end, userId, subject) {
  const response = await fetch('http://127.0.0.1:8000/api/reservations', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Demo-User-Id': String(userId) },
    body: JSON.stringify({ room_id: roomId, subject, attendee_count: 2,
      start_at: day + 'T' + start + ':00+08:00', end_at: day + 'T' + end + ':00+08:00' }),
  });
  assert.equal(response.status, 201, await response.text());
}

function beijingDate(value) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const get = name => parts.find(part => part.type === name).value;
  return get('year') + '-' + get('month') + '-' + get('day');
}

const roomCard = (page, name) => page.getByTestId('room-' + name);
const row = (page, subject) => page.locator('.reservation-item').filter({ hasText: subject });
const slot = (page, field, value) => page.locator('#' + field + ' option[value="' + value + '"]');

async function chooseTime(page, start, end) {
  for (const [id, value] of [['start', start], ['end', end]]) {
    await page.waitForFunction(({ id, value }) => {
      const select = document.getElementById(id);
      return select && !select.disabled && [...select.options].some(option => option.value === value && !option.disabled);
    }, { id, value });
    await page.locator('#' + id).selectOption(value);
  }
}

async function selection(page, id) {
  await page.getByRole('heading', { name: roomNames[id] + ' 当日预约', exact: true }).waitFor();
  assert.equal(await page.getByLabel('当日预约会议室', { exact: true }).inputValue(), String(id));
  assert.equal(await page.getByLabel('会议室', { exact: true }).inputValue(), String(id));
  assert.equal(await page.getByRole('button', { name: '选择 ' + roomNames[id], exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.room-card.selected').count(), 1);
}

async function equalPanelHeights(page) {
  const schedule = await page.locator('.schedule-panel').boundingBox();
  const booking = await page.locator('.booking-panel').boundingBox();
  assert.ok(Math.abs(schedule.height - booking.height) < 1, '卡片高度不同：' + schedule.height + ' / ' + booking.height);
  assert.ok(Math.abs(schedule.y - booking.y) < 1);
}

async function submit(page, status) {
  const result = page.waitForResponse(response => response.url().endsWith('/api/reservations') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '确认预约', exact: true }).click();
  assert.equal((await result).status(), status);
}

async function form(page, roomId, subject, start, end, count = '4') {
  await page.getByLabel('会议室', { exact: true }).selectOption(String(roomId));
  await chooseTime(page, start, end);
  await page.getByLabel('会议主题', { exact: true }).fill(subject);
  await page.getByLabel('参会人数', { exact: true }).fill(count);
}

async function verifyCurrentOverview(context, base, mode) {
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const users = (await api('/users')).data;
  const rooms = (await api('/rooms')).data.map(room => ({ ...room, enabled: true }));
  const active = { id: 101, room_id: 1, room_name: 'A101', booker_id: 1, booker_name: '张三',
    subject: '当前会议', attendee_count: 2, start_at: '2026-10-25T09:00:00+08:00', end_at: '2026-10-25T10:00:00+08:00', status: 'booked', status_label: '已预约' };
  const currentRows = [active,
    { ...active, id: 102, room_id: 2, room_name: 'A102', subject: '已取消会议', status: 'cancelled', status_label: '已取消' },
    { ...active, id: 103, room_id: 3, room_name: 'B201', subject: '下一场会议', start_at: '2026-10-25T10:00:00+08:00', end_at: '2026-10-25T11:00:00+08:00' },
  ];
  const futureRows = Array.from({ length: 12 }, (_, index) => ({ ...active, id: 200 + index, subject: '未来会议 ' + (index + 1),
    start_at: new Date(Date.parse('2026-10-26T09:00:00+08:00') + index * 1800000).toISOString(),
    end_at: new Date(Date.parse('2026-10-26T09:00:00+08:00') + (index + 1) * 1800000).toISOString(),
  }));
  let failCurrentRead = false;
  try {
    await page.clock.setFixedTime(new Date('2026-10-25T08:59:59+08:00'));
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      const current = url.searchParams.get('date') === '2026-10-25';
      const serverTime = await page.evaluate(() => new Date().toISOString());
      if (url.pathname === '/api/reservations' && current && failCurrentRead) {
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'read_failed', message: '当前状态读取失败' }, server_time: serverTime }) });
      }
      const data = url.pathname === '/api/users' ? users : url.pathname === '/api/rooms' ? rooms : current ? currentRows : futureRows;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data, server_time: serverTime }) });
    });
    await page.goto(base);
    await roomCard(page, 'A101').getByText('空闲', { exact: true }).waitFor();
    await row(page, '当前会议').waitFor();
    await page.clock.setFixedTime(new Date('2026-10-25T09:00:00+08:00'));
    await roomCard(page, 'A101').getByText('使用中', { exact: true }).waitFor();
    await roomCard(page, 'A102').getByText('空闲', { exact: true }).waitFor();
    await page.getByRole('button', { name: '选择 A102', exact: true }).click();
    await selection(page, 2);
    await row(page, '已取消会议').waitFor();
    assert.equal(await row(page, '当前会议').count(), 0);
    await page.getByLabel('当前用户', { exact: true }).selectOption('2');
    assert.equal(await slot(page, 'start', '09:00').isDisabled(), false);
    const selectB201 = page.getByRole('button', { name: '选择 B201', exact: true });
    await selectB201.focus(); await page.keyboard.press('Enter'); await selection(page, 3);
    await row(page, '下一场会议').waitFor();
    assert.equal(await slot(page, 'start', '10:00').isDisabled(), true);
    await page.getByLabel('日期', { exact: true }).fill('2026-10-26');
    await page.getByLabel('当日预约会议室', { exact: true }).selectOption('1');
    await row(page, '未来会议 12').waitFor(); await selection(page, 1);
    assert.equal(await page.locator('.reservation-item').count(), 12);
    assert.equal(await slot(page, 'start', '09:00').isDisabled(), true);
    assert.equal(await slot(page, 'start', '14:30').isDisabled(), true);
    assert.equal(await slot(page, 'start', '15:00').isDisabled(), false);
    await chooseTime(page, '18:00', '18:30');
    await roomCard(page, 'A101').getByText('使用中', { exact: true }).waitFor();
    await equalPanelHeights(page);
    failCurrentRead = true;
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await roomCard(page, 'A101').getByText('状态暂不可用', { exact: true }).waitFor();
    failCurrentRead = false;
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await roomCard(page, 'A101').getByText('使用中', { exact: true }).waitFor();
    await page.clock.setFixedTime(new Date('2026-10-25T10:00:00+08:00'));
    await roomCard(page, 'A101').getByText('空闲', { exact: true }).waitFor();
    await roomCard(page, 'B201').getByText('使用中', { exact: true }).waitFor();
    await page.screenshot({ path: join(output, mode + '-current-state.png'), fullPage: true });
    await page.clock.setFixedTime(new Date('2026-10-25T11:00:00+08:00'));
    await roomCard(page, 'B201').getByText('空闲', { exact: true }).waitFor();
    const midnightRequest = page.waitForRequest(request => request.url().includes('/api/reservations?date=2026-10-26'));
    await page.clock.setFixedTime(new Date('2026-10-26T00:00:00+08:00'));
    await midnightRequest;
    await roomCard(page, 'A101').getByText('空闲', { exact: true }).waitFor();
  } catch (error) {
    await page.screenshot({ path: join(output, mode + '-current-state-failure.png'), fullPage: true });
    throw error;
  } finally { await page.close(); }
}

async function assertTimeline(page, expected) {
  const track = page.getByTestId('timeline-track');
  await track.waitFor();
  await page.waitForFunction(count => document.querySelectorAll('.timeline-booking').length === count, expected.length);
  const bounds = await track.boundingBox();
  const innerWidth = bounds.width - 2;
  const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  for (const [id, start, end] of expected) {
    const block = page.getByTestId('timeline-' + id);
    const position = await block.boundingBox();
    assert.ok(Math.abs(position.x - bounds.x - 1 - (minutes(start) - 480) / 720 * innerWidth) < 1.5, '色块开始位置错误');
    assert.ok(Math.abs(position.width - (minutes(end) - minutes(start)) / 720 * innerWidth) < 1.5, '色块宽度未按时长成比例');
    assert.ok(position.x >= bounds.x && position.x + position.width <= bounds.x + bounds.width + 0.1);
    assert.match(await block.getAttribute('title'), new RegExp(start + '～' + end + ' 已预约'));
    assert.match(await block.innerText(), new RegExp(start + '～' + end));
  }
  assert.equal(await page.locator('.timeline-grid > span').count(), 24);
}

async function verifyTimeline(context, base, mode) {
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const day = '2026-10-25';
  const serverTime = day + 'T07:00:00+08:00';
  const users = (await api('/users')).data;
  const rooms = (await api('/rooms')).data.map(room => ({ ...room, enabled: true }));
  const makeRow = (id, start, end, subject, extra = {}) => ({ id, room_id: 1, room_name: 'A101', booker_id: 1, booker_name: '张三', subject,
    attendee_count: 2, start_at: day + 'T' + start + ':00+08:00', end_at: day + 'T' + end + ':00+08:00', status: 'booked', status_label: '已预约', ...extra });
  const records = [makeRow(301, '08:00', '08:30', '开门后的半小时'),
    makeRow(302, '09:00', '10:00', '保留的取消记录', { status: 'cancelled', status_label: '已取消' }),
    makeRow(303, '11:00', '12:00', '上午讨论'), makeRow(304, '12:00', '13:30', '相邻的午间讨论'),
    makeRow(305, '16:00', '20:00', '下午集中讨论与四小时会议'),
    makeRow(306, '09:00', '10:00', '跨房间会议', { room_id: 2, room_name: 'A102' })];
  let failRead = false;
  let holdRead = false;
  let releaseRead;
  const held = new Promise(resolve => { releaseRead = resolve; });
  const expected = [[301, '08:00', '08:30'], [303, '11:00', '12:00'], [304, '12:00', '13:30'], [305, '16:00', '20:00']];
  try {
    await page.clock.setFixedTime(new Date(serverTime));
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      let data;
      if (url.pathname === '/api/users') data = users;
      else if (url.pathname === '/api/rooms') data = rooms;
      else if (route.request().method() === 'POST' && url.pathname.endsWith('/cancel')) {
        const record = records.find(item => item.id === Number(url.pathname.split('/')[3]));
        record.status = 'cancelled'; record.status_label = '已取消'; data = record;
      } else {
        if (holdRead && url.searchParams.get('date') === '2026-10-26') await held;
        if (failRead) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'read_failed', message: '时段测试读取失败' }, server_time: serverTime }) });
        data = url.searchParams.get('date') === day ? records : [];
      }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data, server_time: serverTime }) });
    });
    await page.goto(base);
    await assertTimeline(page, expected);
    assert.equal(await page.locator('.reservation-item').count(), 5);
    assert.equal(await page.getByTestId('timeline-302').count(), 0);
    assert.equal(await page.getByTestId('timeline-306').count(), 0);
    assert.equal(await slot(page, 'start', '09:00').isDisabled(), true);
    await equalPanelHeights(page);
    await page.screenshot({ path: join(output, mode + '-timeline.png'), fullPage: true });
    await page.getByLabel('当日预约会议室', { exact: true }).selectOption('2');
    await assertTimeline(page, [[306, '09:00', '10:00']]);
    assert.equal(await page.locator('.reservation-item').count(), 1);
    await page.getByRole('button', { name: '选择 A101', exact: true }).click();
    await assertTimeline(page, expected);
    await page.getByRole('button', { name: '取消 上午讨论', exact: true }).click();
    await row(page, '上午讨论').getByText('已取消', { exact: true }).waitFor();
    await assertTimeline(page, expected.filter(item => item[0] !== 303));
    assert.equal(await page.getByTestId('timeline-303').count(), 0);
    assert.equal(await page.locator('.reservation-item').count(), 5);
    failRead = true;
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.getByText('时段数据暂不可用，读取成功后显示占用与空档。', { exact: true }).waitFor();
    assert.equal(await page.getByTestId('timeline-track').count(), 0);
    assert.equal(await page.locator('.timeline-legend').count(), 0);
    failRead = false;
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await assertTimeline(page, expected.filter(item => item[0] !== 303));
    await page.getByLabel('日期', { exact: true }).fill('');
    await page.getByText('请选择日期后查看全天时段。', { exact: true }).waitFor();
    assert.equal(await page.getByTestId('timeline-track').count(), 0);
    holdRead = true;
    await page.getByLabel('日期', { exact: true }).fill('2026-10-26');
    await page.getByText('正在读取时段…', { exact: true }).waitFor();
    assert.equal(await page.getByTestId('timeline-track').count(), 0);
    releaseRead();
    await assertTimeline(page, []);
    await page.getByText('A101 当天暂无预约。', { exact: true }).waitFor();
    await page.getByLabel('日期', { exact: true }).fill(day);
    await assertTimeline(page, expected.filter(item => item[0] !== 303));
    await page.setViewportSize({ width: 390, height: 844 });
    await assertTimeline(page, expected.filter(item => item[0] !== 303));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.equal(await page.locator('.timeline-scale').getByText('08:00', { exact: true }).isVisible(), true);
    assert.equal(await page.locator('.timeline-scale').getByText('20:00', { exact: true }).isVisible(), true);
    await page.screenshot({ path: join(output, mode + '-timeline-mobile.png'), fullPage: true });
  } catch (error) {
    await page.screenshot({ path: join(output, mode + '-timeline-failure.png'), fullPage: true });
    throw error;
  } finally { releaseRead(); await page.close(); }
}

const browser = await chromium.launch({ headless: true });
try {
  for (const mode of ['development', 'demo']) {
    let backend, vite, context, page;
    let log = '';
    const capture = child => { child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; }); };
    const database = join(dataDirectory, mode + '.sqlite3');
    const scenarios = [];
    try {
      backend = startBackend(database); capture(backend);
      await ready('http://127.0.0.1:8000/api/users', backend);
      if (mode === 'development') {
        vite = spawn(process.execPath, [viteScript, '--host', '127.0.0.1', '--port', '5173', '--strictPort'], { cwd: frontend, stdio: ['ignore', 'pipe', 'pipe'] });
        capture(vite); await ready('http://127.0.0.1:5173', vite);
      }
      const base = mode === 'development' ? 'http://127.0.0.1:5173' : 'http://127.0.0.1:8000';
      context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: mode === 'development' ? 'America/Los_Angeles' : 'America/New_York' });
      page = await context.newPage(); page.setDefaultTimeout(10000);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      const serverTime = (await api('/users')).server_time;
      const day = beijingDate(Date.parse(serverTime) + 86400000);
      const past = beijingDate(Date.parse(serverTime) - 30 * 86400000);
      await page.goto(base);
      await page.getByLabel('日期', { exact: true }).fill(day);
      await page.getByRole('button', { name: '选择 B201', exact: true }).click(); await selection(page, 3);
      await page.getByText('B201 当天暂无预约。', { exact: true }).waitFor();
      const second = page.getByRole('button', { name: '选择 A102', exact: true });
      await second.focus(); await page.keyboard.press('Enter'); await selection(page, 2);
      await page.getByLabel('当日预约会议室', { exact: true }).selectOption('1'); await selection(page, 1);
      await page.getByLabel('会议室', { exact: true }).selectOption('3'); await selection(page, 3);
      assert.equal(await page.getByRole('button', { name: /^(启用|停用) / }).count(), 0);
      await equalPanelHeights(page);
      scenarios.push('卡片/标题/表单联动、键盘选择、单会议室空列表与等高');

      await form(page, 1, '项目评审', '09:00', '10:00'); await submit(page, 201);
      await row(page, '项目评审').getByText('已预约', { exact: true }).waitFor();
      const createdId = (await row(page, '项目评审').getAttribute('data-testid')).replace('reservation-', '');
      await assertTimeline(page, [[createdId, '09:00', '10:00']]);
      await page.waitForFunction(() => document.querySelector('#start option[value="09:00"]')?.disabled === true);
      assert.equal(await slot(page, 'start', '09:30').isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: '确认预约', exact: true }).isDisabled(), true);
      await page.getByLabel('当日预约会议室', { exact: true }).selectOption('3'); await selection(page, 3);
      await page.getByText('B201 当天暂无预约。', { exact: true }).waitFor();
      assert.equal(await row(page, '项目评审').count(), 0);
      await assertTimeline(page, []);
      assert.equal(await slot(page, 'start', '09:00').isDisabled(), true);
      await page.getByLabel('当前用户', { exact: true }).selectOption('2');
      await form(page, 3, '李四会议', '09:00', '10:00'); await submit(page, 201);
      await row(page, '李四会议').getByText('李四', { exact: true }).waitFor();
      await roomCard(page, 'A101').getByText('空闲', { exact: true }).waitFor();
      scenarios.push('创建后过滤列表、占用选项禁用、本人跨会议室冲突、他人可用及当前状态独立');

      await page.getByLabel('当日预约会议室', { exact: true }).selectOption('1');
      await chooseTime(page, '08:30', '09:00');
      assert.equal(await slot(page, 'end', '09:30').isDisabled(), true);
      assert.equal(await slot(page, 'end', '10:00').isDisabled(), true);
      assert.equal(await slot(page, 'end', '10:30').isDisabled(), true);
      assert.equal(await slot(page, 'start', '10:00').isDisabled(), false);
      await page.getByLabel('会议主题', { exact: true }).fill('容量检查');
      await page.getByLabel('参会人数', { exact: true }).fill('5');
      await submit(page, 400);
      await page.getByRole('alert').filter({ hasText: '最多容纳 4 人' }).waitFor();
      assert.equal(await page.getByRole('alertdialog').count(), 0);
      assert.equal(await page.getByRole('button', { name: '取消 项目评审', exact: true }).count(), 0);
      scenarios.push('结束不能跨过占用区间、首尾相接和容量错误保留页面提示');

      await page.getByLabel('当前用户', { exact: true }).selectOption('1');
      await page.getByRole('button', { name: '取消 项目评审', exact: true }).click();
      await row(page, '项目评审').getByText('已取消', { exact: true }).waitFor();
      await assertTimeline(page, []);
      await form(page, 2, '停用前预约', '09:00', '10:00'); await submit(page, 201);
      await row(page, '停用前预约').getByText('已预约', { exact: true }).waitFor();
      await page.getByLabel('当前用户', { exact: true }).selectOption('4');
      await page.getByRole('button', { name: '选择 A101', exact: true }).click();
      await page.getByRole('button', { name: '停用 A102', exact: true }).click();
      await page.getByRole('button', { name: '启用 A102', exact: true }).waitFor();
      await selection(page, 1);
      await page.getByLabel('当日预约会议室', { exact: true }).selectOption('2'); await selection(page, 2);
      await row(page, '停用前预约').waitFor();
      assert.equal(await page.getByLabel('开始时间', { exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: '确认预约', exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: '取消 停用前预约', exact: true }).count(), 0);
      await page.getByLabel('当前用户', { exact: true }).selectOption('1');
      await page.getByLabel('当日预约会议室', { exact: true }).selectOption('1');
      assert.equal(await slot(page, 'start', '09:00').isDisabled(), true);
      await page.getByLabel('当日预约会议室', { exact: true }).selectOption('2');
      await page.getByRole('button', { name: '取消 停用前预约', exact: true }).click();
      await row(page, '停用前预约').getByText('已取消', { exact: true }).waitFor();
      await page.getByLabel('当前用户', { exact: true }).selectOption('4');
      await page.getByRole('button', { name: '启用 A102', exact: true }).click();
      await page.getByRole('button', { name: '停用 A102', exact: true }).waitFor();
      await selection(page, 2);
      await page.getByLabel('当前用户', { exact: true }).selectOption('3');
      await form(page, 2, '启用后预约', '09:00', '10:00'); await submit(page, 201);
      await row(page, '启用后预约').getByText('王五', { exact: true }).waitFor();
      scenarios.push('取消释放、停用仍可选中查询、管理不误选、停用保留本人冲突、恢复启用');

      await page.reload(); await page.getByLabel('日期', { exact: true }).fill(day);
      let conflictIndex = 0;
      for (const [start, end, close] of [['09:00', '10:00', 'escape'], ['10:00', '10:30', 'button']]) {
        await form(page, 1, '并发冲突检查', start, end);
        await createAs(day, 1, start, end, 4, '其他用户同时预约 ' + (++conflictIndex));
        await submit(page, 409);
        const dialog = page.getByRole('alertdialog', { name: '会议室已被预约', exact: true });
        await dialog.waitFor();
        assert.doesNotMatch(await dialog.innerText(), /张三|李四|王五|超级管理员/);
        assert.match(await dialog.innerText(), /已被预约/);
        assert.equal(await dialog.getByRole('button', { name: '知道了' }).evaluate(button => button === document.activeElement), true);
        await page.screenshot({ path: join(output, mode + '-conflict-dialog.png') });
        if (close === 'escape') await page.keyboard.press('Escape');
        else await dialog.getByRole('button', { name: '知道了' }).click();
        await dialog.waitFor({ state: 'hidden' });
        await page.waitForFunction(() => document.activeElement?.matches('.booking-panel select:not(:disabled), .booking-panel input:not(:disabled):not([readonly])'));
        assert.equal(await page.getByLabel('会议主题', { exact: true }).inputValue(), '并发冲突检查');
        await row(page, '其他用户同时预约 ' + conflictIndex).waitFor();
        assert.equal(await slot(page, 'start', start).isDisabled(), true);
        assert.equal(await page.getByRole('button', { name: '确认预约', exact: true }).isDisabled(), true);
      }
      scenarios.push('真实同时操作的服务端互斥、匿名弹窗、关闭保留输入并刷新占用选项');

      const beforeState = { rows: (await api('/reservations?date=' + day)).data, rooms: (await api('/rooms')).data };
      assert.equal(beforeState.rows.length, 6);
      await page.getByLabel('日期', { exact: true }).fill(past);
      await page.getByText('A101 当天暂无预约。', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '确认预约', exact: true }).isDisabled(), true);
      await promisify(execFile)(process.execPath, [viteScript, 'build'], { cwd: frontend });
      assert.deepEqual((await api('/reservations?date=' + day)).data, beforeState.rows);
      await stop(backend); backend = startBackend(database); capture(backend);
      await ready('http://127.0.0.1:8000/api/users', backend);
      assert.deepEqual((await api('/reservations?date=' + day)).data, beforeState.rows);
      assert.deepEqual((await api('/rooms')).data, beforeState.rooms);
      await page.reload(); await page.getByLabel('日期', { exact: true }).fill(day);
      await page.getByLabel('当日预约会议室', { exact: true }).selectOption('2');
      await row(page, '启用后预约').waitFor();
      assert.equal(await page.locator('.reservation-item').count(), 2);
      await equalPanelHeights(page);
      await page.screenshot({ path: join(output, mode + '-desktop.png'), fullPage: true });
      scenarios.push('按会议室查询历史、重新构建、刷新与真实进程重启保留记录');

      await form(page, 1, '失败保留输入', '11:00', '11:30');
      let release;
      let posts = 0;
      const held = new Promise(resolve => { release = resolve; });
      await page.route('**/api/reservations', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        posts++; await held;
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'storage_failed', message: '保存失败，请稍后重试' } }) });
      });
      await page.getByRole('button', { name: '确认预约', exact: true }).click();
      await page.getByRole('button', { name: '正在处理…', exact: true }).waitFor();
      await page.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      release();
      await page.getByRole('alert').filter({ hasText: '保存失败' }).waitFor();
      assert.equal(posts, 1);
      assert.equal(await page.getByLabel('会议主题', { exact: true }).inputValue(), '失败保留输入');
      assert.deepEqual((await api('/reservations?date=' + day)).data, beforeState.rows);
      await page.unroute('**/api/reservations');
      await page.route('**/api/reservations', route => route.abort());
      await page.getByRole('button', { name: '确认预约', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: '网络连接失败' }).waitFor();
      await page.unroute('**/api/reservations');
      await page.route('**/api/reservations?*', route => {
        if (new URL(route.request().url()).searchParams.get('date') !== day) return route.continue();
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'read_failed', message: '暂时无法读取预约，请稍后重试' } }) });
      });
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await page.getByRole('alert').filter({ hasText: '暂时无法读取预约' }).waitFor();
      assert.equal(await page.getByLabel('开始时间', { exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: '确认预约', exact: true }).isDisabled(), true);
      await page.unroute('**/api/reservations?*');
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await chooseTime(page, '11:00', '11:30');
      scenarios.push('保存/网络失败保留输入、防重复提交、读取失败禁用时间与恢复');

      const mobile = await context.newPage(); await mobile.setViewportSize({ width: 390, height: 844 });
      await mobile.goto(base);
      await mobile.getByLabel('日期', { exact: true }).fill(day);
      await mobile.getByRole('button', { name: '选择 A102', exact: true }).click(); await selection(mobile, 2);
      await row(mobile, '启用后预约').waitFor();
      await form(mobile, 1, '手机并发检查', '18:00', '18:30', '1');
      assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await mobile.screenshot({ path: join(output, mode + '-mobile.png'), fullPage: true });
      await createAs(day, 1, '18:00', '18:30', 4, '手机测试的并发预约');
      await submit(mobile, 409);
      const mobileDialog = mobile.getByRole('alertdialog', { name: '会议室已被预约', exact: true });
      await mobileDialog.waitFor();
      assert.doesNotMatch(await mobileDialog.innerText(), /张三|李四|王五|超级管理员/);
      const bounds = await mobileDialog.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
      await mobile.screenshot({ path: join(output, mode + '-mobile-conflict-dialog.png') });
      await mobileDialog.getByRole('button', { name: '知道了' }).click();
      await mobileDialog.waitFor({ state: 'hidden' });
      assert.equal(await mobile.getByLabel('会议主题', { exact: true }).inputValue(), '手机并发检查');
      await mobile.close();
      scenarios.push('手机选择联动、无横向溢出和并发弹窗');

      await verifyCurrentOverview(context, base, mode);
      scenarios.push('当前状态开始/结束/跨日、选择不影响使用状态、十二条单房间记录和等高');
      await verifyTimeline(context, base, mode);
      scenarios.push('全天时间轴比例与营业边界、相邻预约、取消保留、房间日期过滤、未知状态与手机展示');
      assert.deepEqual(errors, []);
      report.modes.push({ mode, browser_timezone: mode === 'development' ? 'America/Los_Angeles' : 'America/New_York', business_date: day, database, scenarios, passed: true });
      console.log(mode + ': ' + scenarios.length + ' 组浏览器场景通过，数据库 ' + database);
    } catch (error) {
      if (page && !page.isClosed()) {
        await page.screenshot({ path: join(output, mode + '-failure.png'), fullPage: true });
        writeFileSync(join(output, mode + '-failure.html'), await page.content());
      }
      throw error;
    } finally {
      await context?.close(); await stop(vite); await stop(backend);
      writeFileSync(join(output, mode + '-server.log'), log);
    }
  }
  report.completed_at = new Date().toISOString();
  writeFileSync(join(output, 'browser-report.json'), JSON.stringify(report, null, 2));
} finally { await browser.close(); }
