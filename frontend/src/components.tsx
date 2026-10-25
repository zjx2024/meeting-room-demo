import type { FormEvent, RefObject } from 'react';
import { useEffect, useRef } from 'react';
import type { Room, User } from './types';
import { timeOptions } from './time';

export function ConflictDialog({ message, onClose, returnFocus }: {
  message: string | null; onClose: () => void; returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (message) {
      if (!element.open) element.showModal();
      wasOpen.current = true;
    } else if (wasOpen.current) {
      if (element.open) element.close();
      wasOpen.current = false;
      const target = returnFocus.current;
      if (target && !target.disabled) target.focus();
      else target?.form?.querySelector<HTMLElement>('select:not(:disabled), input:not(:disabled):not([readonly])')?.focus();
    }
  }, [message, returnFocus]);

  return <dialog ref={dialog} className="conflict-dialog" role="alertdialog" aria-modal="true"
    aria-labelledby="conflict-title" aria-describedby="conflict-message" onCancel={onClose} onClose={onClose}>
    <h2 id="conflict-title">会议室已被预约</h2>
    <p id="conflict-message">{message}</p>
    <button type="button" className="primary-button" autoFocus onClick={onClose}>知道了</button>
  </dialog>;
}

export function RoomCards({ rooms, selected, onSelect, occupied, statusKnown, statusError, isAdmin, busy, onToggle }: {
  rooms: Room[]; occupied: Set<number>; statusKnown: boolean; statusError: string | null;
  selected: number; onSelect: (id: number) => void;
  isAdmin: boolean; busy: boolean; onToggle: (room: Room) => void;
}) {
  return <section className="room-grid" aria-label="会议室列表">
    {rooms.map(room => <article className={`room-card ${selected === room.id ? 'selected' : ''}`} key={room.id} data-testid={`room-${room.name}`}>
      <button type="button" className="room-select" aria-label={`选择 ${room.name}`} aria-pressed={selected === room.id} disabled={busy} onClick={() => onSelect(room.id)} />
      <div className="room-top"><h3>{room.name}</h3><span className={`badge ${room.enabled ? 'neutral' : 'disabled'}`}>{room.enabled ? '启用' : '停用'}</span></div>
      <div className="capacity"><strong>{room.capacity}</strong><span>人容量</span></div>
      <p className="equipment">{room.equipment.join(' · ')}</p>
      <div className="room-bottom">
        <span className={`availability ${!statusKnown ? 'unknown' : occupied.has(room.id) ? 'occupied' : ''}`}>
          <i />{statusKnown ? (occupied.has(room.id) ? '使用中' : '空闲') : statusError ? '状态暂不可用' : '读取状态中…'}
        </span>
        <div className="room-actions">
          {isAdmin && <button type="button" className={`text-button ${room.enabled ? 'danger' : ''}`} disabled={busy}
            aria-label={`${room.enabled ? '停用' : '启用'} ${room.name}`} onClick={() => onToggle(room)}>{room.enabled ? '停用' : '启用'}</button>}
        </div>
      </div>
    </article>)}
  </section>;
}

export function BookingForm({ rooms, user, roomId, setRoomId, start, end, setStart, setEnd, subject, setSubject, count, setCount, busy, onSubmit, submitRef, availableStarts, availableEnds, availabilityReady, rangeAvailable }: {
  rooms: Room[]; user: User; roomId: number; setRoomId: (id: number) => void;
  start: string; end: string; setStart: (time: string) => void; setEnd: (time: string) => void;
  subject: string; setSubject: (text: string) => void; count: string; setCount: (text: string) => void;
  busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitRef: RefObject<HTMLButtonElement | null>;
  availableStarts: Set<string>; availableEnds: Set<string>; availabilityReady: boolean; rangeAvailable: boolean;
}) {
  const room = rooms.find(item => item.id === roomId);
  return <aside className="panel booking-panel"><div className="panel-title"><span className="eyebrow">NEW RESERVATION</span><h2>创建预约</h2></div>
    <form onSubmit={onSubmit}>
      <label htmlFor="room">会议室</label>
      <select id="room" value={roomId} onChange={event => setRoomId(Number(event.target.value))} disabled={busy} required>
        {rooms.map(item => <option key={item.id} value={item.id} disabled={!item.enabled}>{item.name} · {item.capacity} 人{!item.enabled ? '（停用）' : ''}</option>)}
      </select>
      <label htmlFor="subject">会议主题</label>
      <input id="subject" value={subject} onChange={event => setSubject(event.target.value)} placeholder="例如：项目进度讨论" disabled={busy} required />
      <div className="field-pair"><div><label htmlFor="booker">预约人</label><input id="booker" value={user.name} readOnly /></div>
        <div><label htmlFor="count">参会人数</label><input id="count" type="number" min="1" step="1" value={count} onChange={event => setCount(event.target.value)} disabled={busy} required /></div></div>
      <div className="field-pair"><div><label htmlFor="start">开始时间</label><select id="start" className={`time-select ${availableStarts.has(start) ? '' : 'unavailable'}`} value={start} onChange={event => setStart(event.target.value)} disabled={busy || !availabilityReady || !room?.enabled} required>
        {timeOptions.slice(0, -1).map(time => <option key={time} value={time} disabled={!availableStarts.has(time)}>{time}{availableStarts.has(time) ? '' : '（不可用）'}</option>)}</select></div>
        <div><label htmlFor="end">结束时间</label><select id="end" className={`time-select ${availableEnds.has(end) ? '' : 'unavailable'}`} value={end} onChange={event => setEnd(event.target.value)} disabled={busy || !availabilityReady || !room?.enabled} required>
          {timeOptions.slice(1).map(time => <option key={time} value={time} disabled={!availableEnds.has(time)}>{time}{availableEnds.has(time) ? '' : '（不可用）'}</option>)}</select></div></div>
      <p className="form-hint">{room?.name} 最多容纳 {room?.capacity} 人 · 每场 30 分钟至 4 小时</p>
      {!rangeAvailable && <p className="form-hint" role="status">{!room?.enabled ? '会议室已停用，仅可查看预约。' : !availabilityReady ? '正在读取可预约时段，数据就绪后可选择。' : !availableStarts.size ? '该日期暂无可预约时段。' : '当前选择不可预约，请重新选择可用时间。'}</p>}
      <button ref={submitRef} type="submit" className="primary-button" disabled={busy || !rangeAvailable}>{busy ? '正在处理…' : '确认预约'}</button>
      <p className="form-note">预约日期以“当日预约”所选日期为准。所有时间均为北京时间，最多提前 7 天预约。</p>
    </form>
  </aside>;
}
