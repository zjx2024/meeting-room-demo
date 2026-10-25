import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiRequestError, request } from './api';
import { BookingForm, ConflictDialog, RoomCards } from './components';
import { ReservationSchedule } from './ReservationSchedule';
import { beijingTime, initialSlot, isoTime, nextTime } from './time';
import type { Reservation, ReservationInput, Room, User } from './types';
import { useRoomOverview } from './useRoomOverview';
import { getAvailability } from './availability';
import './style.css';

export default function App() {
  const [users, setUsers] = useState<User[]>([]);
  const [userId, setUserId] = useState(1);
  const [rows, setRows] = useState<Reservation[]>([]);
  const [date, setDate] = useState('');
  const [loadedDate, setLoadedDate] = useState('');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('09:30');
  const [roomId, setRoomId] = useState(1);
  const [subject, setSubject] = useState('');
  const [count, setCount] = useState('1');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const submitRef = useRef<HTMLButtonElement>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [bootstrap, setBootstrap] = useState(0);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [tick, setTick] = useState(Date.now());
  const now = tick + offset;
  const synchronizeClock = useCallback((serverTime: string) => {
    const receivedAt = Date.now();
    setOffset(Date.parse(serverTime) - receivedAt);
    setTick(receivedAt);
  }, []);
  const overview = useRoomOverview(now, refresh, synchronizeClock);
  const rooms = overview.rooms;

  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    request<User[]>('/users', { signal: controller.signal })
      .then(userResponse => {
        if (controller.signal.aborted) return;
        setUsers(userResponse.data);
        synchronizeClock(userResponse.server_time);
        const slot = initialSlot(userResponse.server_time);
        setDate(slot.date); setStart(slot.start); setEnd(slot.end);
      })
      .catch(error => { if (!controller.signal.aborted) { setNotice({ type: 'error', text: error.message }); setLoading(false); } });
    return () => controller.abort();
  }, [bootstrap, synchronizeClock]);

  useEffect(() => {
    if (!date) return;
    let active = true;
    let pending = false;
    let controller: AbortController | undefined;
    setLoading(true); setLoadedDate(''); setRows([]);
    async function load() {
      if (pending) return;
      pending = true; controller = new AbortController();
      try {
        const result = await request<Reservation[]>(`/reservations?date=${encodeURIComponent(date)}`, { signal: controller.signal });
        if (!active) return;
        setRows(result.data); setLoadedDate(date);
        synchronizeClock(result.server_time);
      } catch (error) {
        if (active && !controller.signal.aborted) {
          setLoadedDate('');
          setNotice({ type: 'error', text: error instanceof Error ? error.message : '暂时无法读取预约，请稍后重试' });
        }
      } finally { pending = false; if (active) setLoading(false); }
    }
    void load();
    const timer = window.setInterval(() => { void load(); }, 30000);
    const visible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false; controller?.abort(); window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [date, refresh, synchronizeClock]);

  const user = users.find(item => item.id === userId);
  const selectedRoom = rooms.find(room => room.id === roomId);
  const availabilityReady = !!date && loadedDate === date && !loading;
  const availability = getAvailability({ date, roomId, userId, start, rows, now,
    ready: availabilityReady, enabled: !!selectedRoom?.enabled });
  const rangeAvailable = availability.isRangeAvailable(start, end);
  const selectedRows = rows.filter(row => row.room_id === roomId);

  async function mutate(action: () => Promise<unknown>, message: string, clearSubject = false) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setNotice(null);
    try {
      await action();
      if (clearSubject) setSubject('');
      setNotice({ type: 'success', text: message }); setRefresh(value => value + 1);
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'room_conflict') {
        setConflictMessage(error.message);
        setRefresh(value => value + 1);
      } else {
        setNotice({ type: 'error', text: error instanceof Error ? error.message : '操作未完成，请重试' });
      }
    } finally { busyRef.current = false; setBusy(false); }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!date) { setNotice({ type: 'error', text: '请选择预约日期' }); return; }
    if (!rangeAvailable) { setNotice({ type: 'error', text: '所选时段不可预约，请重新选择可用时间' }); return; }
    const body: ReservationInput = { room_id: roomId, subject, attendee_count: Number(count), start_at: isoTime(date, start), end_at: isoTime(date, end) };
    void mutate(() => request<Reservation>('/reservations', { method: 'POST', body: JSON.stringify(body) }, userId), '预约成功，已更新预约列表', true);
  }

  return <div className="app-shell">
    <ConflictDialog message={conflictMessage} onClose={() => setConflictMessage(null)} returnFocus={submitRef} />
    <header className="app-header"><a className="brand" href="/" aria-label="会议室预约首页"><span className="brand-icon">M</span><span>MEETING ROOM<span className="brand-sub">会议室预约</span></span></a>
      <div className="user-control"><label htmlFor="current-user">当前用户</label><select id="current-user" value={userId} onChange={event => setUserId(Number(event.target.value))} disabled={busy || !users.length}>
        {users.map(item => <option key={item.id} value={item.id}>{item.name}{item.role === 'super_admin' ? ' · 管理员' : ''}</option>)}
      </select></div>
    </header>
    <main>
      <div className="intro"><div><span className="eyebrow">WORK TOGETHER</span><h1>为下一场讨论，留个位置。</h1><p>查看会议室，选择时间，开始高效协作。</p></div><span className="timezone">北京时间 <strong>{beijingTime(now)}</strong></span></div>
      {notice && <div role={notice.type === 'error' ? 'alert' : 'status'} className={`notice ${notice.type}`}>
        <span>{notice.text}</span><button type="button" aria-label="关闭提示" onClick={() => setNotice(null)}>×</button>
      </div>}
      {!user ? <section className="panel initial-loading"><p>{loading ? '正在读取会议室与用户…' : '暂时无法加载，请检查服务后重新加载。'}</p><button className="text-button" onClick={() => { setLoading(true); setNotice(null); setBootstrap(value => value + 1); setRefresh(value => value + 1); }}>重新加载</button></section> : <>
        <div className="section-heading"><h2>会议室概况</h2><span>营业时间 08:00–20:00 · 显示当前使用状态</span></div>
        {overview.error && <div role="alert" className="notice error">当前会议室状态暂不可用：{overview.error}</div>}
        <RoomCards rooms={rooms} selected={roomId} onSelect={setRoomId} occupied={overview.occupied} statusKnown={overview.statusKnown} statusError={overview.error} isAdmin={user.role === 'super_admin'} busy={busy}
          onToggle={room => {
            const action = room.enabled ? 'disable' : 'enable';
            void mutate(() => request<Room>(`/rooms/${room.id}/${action}`, { method: 'POST' }, userId), `${room.name} 已${room.enabled ? '停用' : '启用'}，原有预约仍保留`);
          }} />
        <div className="workspace"><section className="panel schedule-panel">
          <div className="schedule-title"><div><span className="eyebrow">DAILY SCHEDULE</span><h2 className="schedule-heading" aria-label={`${selectedRoom?.name ?? '会议室'} 当日预约`}>
            <select className="schedule-room-select" aria-label="当日预约会议室" value={roomId} disabled={busy} onChange={event => setRoomId(Number(event.target.value))}>
              {rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}
            </select><span>当日预约</span></h2></div><div className="date-control"><label htmlFor="date">日期</label><input id="date" type="date" value={date} disabled={busy} onChange={event => {
            if (event.target.value !== date) { setDate(event.target.value); setRows([]); setLoadedDate(''); setNotice(null); if (!event.target.value) setLoading(false); }
          }} required /></div></div>
          <ReservationSchedule rows={selectedRows} roomName={selectedRoom?.name ?? '会议室'} date={date} enabled={!!selectedRoom?.enabled} currentUser={userId} now={now} busy={busy} loading={loading} failed={!loading && !!date && loadedDate !== date} onCancel={row => { void mutate(() => request<Reservation>(`/reservations/${row.id}/cancel`, { method: 'POST' }, userId), '预约已取消，时段已释放'); }} />
          <div className="schedule-note">已取消记录保留供查询。仅预约人本人可在会议开始前取消。</div>
        </section>
          <BookingForm rooms={rooms} user={user} roomId={roomId} setRoomId={setRoomId} start={start} end={end} setStart={value => { setStart(value); setEnd(nextTime(value)); }} setEnd={setEnd}
            subject={subject} setSubject={setSubject} count={count} setCount={setCount} busy={busy} onSubmit={submit} submitRef={submitRef}
            availableStarts={availability.starts} availableEnds={availability.ends} availabilityReady={availabilityReady} rangeAvailable={rangeAvailable} />
        </div>
      </>}
    </main>
    <footer>MEETING ROOM · 本地演示 <span>所有预约时间均为北京时间</span></footer>
  </div>;
}
