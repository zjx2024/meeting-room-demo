import type { Reservation } from './types';
import { beijingTime, isoTime, timeOptions } from './time';

export function ReservationSchedule({ rows, roomName, date, enabled, currentUser, now, busy, loading, failed, onCancel }: {
  rows: Reservation[]; roomName: string; date: string; enabled: boolean;
  currentUser: number; now: number; busy: boolean; loading: boolean; failed: boolean;
  onCancel: (row: Reservation) => void;
}) {
  const ready = !!date && !loading && !failed;
  const booked = rows.filter(row => row.status === 'booked');
  const opening = Date.parse(isoTime(date, '08:00'));
  const dayLength = 12 * 60 * 60 * 1000;

  return <div className="schedule-body">
    <section className="day-timeline" aria-label={`${roomName} 全天时间轴`} aria-busy={loading}>
      <div className="timeline-heading"><h3>全天时段</h3>
        {ready && <div className="timeline-legend"><span><i className="legend-free" />空闲</span><span><i className="legend-booked" />已预约</span></div>}
      </div>
      {ready ? <>
        <div className="timeline-scale" aria-hidden="true">
          {timeOptions.filter((_, index) => index % 2 === 0).map((time, index) =>
            <span key={time} className={index % 2 ? 'minor-label' : ''} style={{ left: `${index / 12 * 100}%` }}>{time}</span>)}
        </div>
        <div className="timeline-track" data-testid="timeline-track">
          <div className="timeline-grid" aria-hidden="true">{timeOptions.slice(1).map(time => <span key={time} />)}</div>
          <ol className="timeline-bookings" aria-label="已预约时段">
            {booked.map(row => {
              const label = `${beijingTime(row.start_at)}～${beijingTime(row.end_at)} 已预约 · ${row.subject} · ${row.booker_name}`;
              return <li key={row.id} className="timeline-booking" data-testid={`timeline-${row.id}`} title={label}
                style={{ left: `${(Date.parse(row.start_at) - opening) / dayLength * 100}%`, width: `${(Date.parse(row.end_at) - Date.parse(row.start_at)) / dayLength * 100}%` }}>
                <span className="sr-only">{label}</span>
              </li>;
            })}
          </ol>
        </div>
        <p className="timeline-help">每格 30 分钟 · 留白为会议室空档，具体可预约时间见创建表单。</p>
        {!enabled && <p className="timeline-help">会议室已停用，时间轴仅供查询。</p>}
      </> : <p className="timeline-placeholder" role="status">{!date ? '请选择日期后查看全天时段。' : loading ? '正在读取时段…' : '时段数据暂不可用，读取成功后显示占用与空档。'}</p>}
    </section>
    <section className="reservation-details" aria-label="预约明细">
      <h3>预约明细</h3>
      {!rows.length ? <p className="schedule-empty">{!date ? '请先选择查询日期。' : loading ? '正在读取预约…' : failed ? '暂时无法读取预约，请重新选择日期后重试。' : `${roomName} 当天暂无预约。`}</p>
        : <ul className="reservation-list">
          {rows.map(row => <li className={`reservation-item ${row.status === 'cancelled' ? 'is-cancelled' : ''}`} key={row.id} data-testid={`reservation-${row.id}`}>
            <p className="reservation-time">{beijingTime(row.start_at)}–{beijingTime(row.end_at)}</p>
            <div className="reservation-content"><h4>{row.subject}</h4><p className="reservation-meta"><span>{row.room_name}</span><span>{row.booker_name}</span><span>{row.attendee_count} 人参会</span></p></div>
            <div className="reservation-actions"><span className={`badge ${row.status === 'booked' ? 'booked' : 'cancelled'}`}>{row.status_label}</span>
              {row.status === 'booked' && row.booker_id === currentUser && Date.parse(row.start_at) > now
                && <button className="text-button danger" disabled={busy} onClick={() => onCancel(row)} aria-label={`取消 ${row.subject}`}>取消</button>}
            </div>
          </li>)}
        </ul>}
    </section>
  </div>;
}
