import { useEffect, useState } from 'react';
import { request } from './api';
import { beijingDate } from './time';
import type { Reservation, Room } from './types';

export function useRoomOverview(now: number, refresh: number, synchronizeClock: (time: string) => void) {
  const currentDate = beijingDate(now);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [rows, setRows] = useState<Reservation[]>([]);
  const [loadedDate, setLoadedDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let pending = false;
    let controller: AbortController | undefined;
    async function load() {
      if (pending) return;
      pending = true;
      controller = new AbortController();
      try {
        const [roomResult, reservationResult] = await Promise.all([
          request<Room[]>('/rooms', { signal: controller.signal }),
          request<Reservation[]>(`/reservations?date=${currentDate}`, { signal: controller.signal }),
        ]);
        if (!active) return;
        setRooms(roomResult.data); setRows(reservationResult.data);
        setLoadedDate(currentDate); setError(null);
        synchronizeClock(reservationResult.server_time);
      } catch (failure) {
        if (active && !controller.signal.aborted) {
          setLoadedDate('');
          setError(failure instanceof Error ? failure.message : '当前会议室状态暂不可用');
        }
      } finally { pending = false; }
    }
    void load();
    const timer = window.setInterval(() => { void load(); }, 30000);
    const visible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false; controller?.abort(); window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [currentDate, refresh, synchronizeClock]);

  const occupied = new Set(rows.filter(row => row.status === 'booked'
    && Date.parse(row.start_at) <= now && now < Date.parse(row.end_at)).map(row => row.room_id));
  return { rooms, occupied, statusKnown: loadedDate === currentDate && !error, error };
}
