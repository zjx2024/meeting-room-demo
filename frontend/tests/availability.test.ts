import assert from 'node:assert/strict';
import test from 'node:test';
import { getAvailability } from '../src/availability.ts';
import type { Reservation } from '../src/types.ts';

const day = '2026-10-26';
type Options = Parameters<typeof getAvailability>[0];
const available = (changes: Partial<Options> = {}) => getAvailability({
  date: day, roomId: 1, userId: 1, start: '08:30', rows: [],
  now: Date.parse('2026-10-25T08:00:00+08:00'), ready: true, enabled: true, ...changes,
});
function meeting(start = '09:00', end = '10:00', changes: Partial<Reservation> = {}): Reservation {
  return { id: 1, room_id: 1, room_name: 'A101', booker_id: 2, booker_name: '李四', subject: '会议', attendee_count: 2,
    start_at: `${day}T${start}:00+08:00`, end_at: `${day}T${end}:00+08:00`, status: 'booked', status_label: '已预约', ...changes };
}

test('空闲日期包含营业时间和时长边界', () => {
  const result = available({ start: '08:00' });
  assert.equal(result.starts.size, 24);
  assert.ok(result.starts.has('08:00') && result.starts.has('19:30'));
  assert.ok(!result.starts.has('20:00'));
  assert.deepEqual([...result.ends], ['08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00']);
});

test('占用的开始点禁用，相邻端点可用，结束不能跨越占用区间', () => {
  const result = available({ rows: [meeting()] });
  assert.ok(!result.starts.has('09:00') && !result.starts.has('09:30'));
  assert.ok(result.starts.has('08:30') && result.starts.has('10:00'));
  assert.deepEqual([...result.ends], ['09:00']);
  assert.equal(result.isRangeAvailable('08:30', '10:30'), false);
});

test('同一预约人在另一房间的会议也阻止重叠', () => {
  const result = available({ rows: [meeting('09:00', '10:00', { room_id: 2, booker_id: 1 })] });
  assert.ok(!result.starts.has('09:00'));
  assert.ok(result.starts.has('10:00'));
});

test('其他人使用另一房间不会占用目标会议室', () => {
  assert.ok(available({ rows: [meeting('09:00', '10:00', { room_id: 2 })] }).starts.has('09:00'));
});

test('取消记录同时释放房间和预约人的时段', () => {
  const result = available({ rows: [meeting('09:00', '10:00', { booker_id: 1, status: 'cancelled', status_label: '已取消' })] });
  assert.ok(result.starts.has('09:00') && result.isRangeAvailable('08:30', '10:30'));
});

test('开始点等于上一场结束时允许', () => {
  assert.ok(available({ start: '10:00', rows: [meeting()] }).ends.has('10:30'));
});

test('结束点等于下一场开始时允许', () => {
  assert.ok(available({ start: '08:30', rows: [meeting()] }).ends.has('09:00'));
});

test('中间有会议时不能直接选择其后的空闲结束点', () => {
  const result = available({ start: '10:00', rows: [meeting('11:00', '12:00')] });
  assert.ok(result.ends.has('11:00'));
  assert.ok(!result.ends.has('11:30') && !result.ends.has('12:00') && !result.ends.has('12:30'));
});

test('相接的占用区间不会产生虚假空隙', () => {
  const result = available({ rows: [meeting('09:00', '10:00'), meeting('10:00', '11:00')] });
  assert.ok(!result.starts.has('10:00') && !result.starts.has('10:30'));
  assert.ok(result.starts.has('11:00'));
});

test('结束必须晚于开始，最多四小时且不越过20点', () => {
  const result = available({ start: '16:00' });
  assert.ok(!result.ends.has('16:00') && result.ends.has('20:00'));
  assert.equal(result.isRangeAvailable('15:30', '20:00'), false);
  assert.deepEqual([...available({ start: '19:30' }).ends], ['20:00']);
});

test('开始时刻包含现在，但不会把09:00:01舍入为09:00', () => {
  assert.ok(available({ now: Date.parse(`${day}T09:00:00+08:00`) }).starts.has('09:00'));
  assert.ok(!available({ now: Date.parse(`${day}T09:00:01+08:00`) }).starts.has('09:00'));
});

test('七天上界包含开始时间，不额外限制结束时间', () => {
  const result = available({ date: '2026-11-01', start: '08:00' });
  assert.deepEqual([...result.starts], ['08:00']);
  assert.ok(result.ends.has('08:30'));
});

test('历史和超过七天的日期没有可创建时段', () => {
  assert.equal(available({ date: '2026-10-24' }).starts.size, 0);
  assert.equal(available({ date: '2026-11-02' }).starts.size, 0);
});

test('未知数据和停用会议室不提供可用选项', () => {
  for (const change of [{ ready: false }, { enabled: false }]) {
    const result = available(change);
    assert.equal(result.starts.size, 0); assert.equal(result.ends.size, 0);
    assert.equal(result.isRangeAvailable('09:00', '10:00'), false);
  }
});

test('其他日期的记录不影响所选日期', () => {
  assert.ok(available({ rows: [meeting('09:00', '10:00', {
    start_at: '2026-10-27T09:00:00+08:00', end_at: '2026-10-27T10:00:00+08:00',
  })] }).starts.has('09:00'));
});

test('当前开始点无效时结束选项也全部不可用', () => {
  assert.equal(available({ start: '09:00', rows: [meeting()] }).ends.size, 0);
  assert.equal(available().isRangeAvailable('09:10', '10:10'), false);
});
