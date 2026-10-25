import { isoTime, nextTime, timeOptions } from './time.ts';
import type { Reservation } from './types.ts';

interface AvailabilityInput {
  date: string;
  roomId: number;
  userId: number;
  start: string;
  rows: Reservation[];
  now: number;
  ready: boolean;
  enabled: boolean;
}

export function getAvailability(input: AvailabilityInput) {
  const blocked = input.rows.filter(row => row.status === 'booked'
    && (row.room_id === input.roomId || row.booker_id === input.userId))
    .map(row => [Date.parse(row.start_at), Date.parse(row.end_at)]);

  function isRangeAvailable(start: string, end: string): boolean {
    if (!input.ready || !input.enabled || !input.date || !timeOptions.includes(start) || !timeOptions.includes(end)) return false;
    const from = Date.parse(isoTime(input.date, start));
    const to = Date.parse(isoTime(input.date, end));
    return Number.isFinite(from) && Number.isFinite(to)
      && to - from >= 1800000 && to - from <= 14400000
      && from >= input.now && from <= input.now + 7 * 86400000
      && !blocked.some(([busyStart, busyEnd]) => from < busyEnd && to > busyStart);
  }

  return {
    starts: new Set(timeOptions.slice(0, -1).filter(start => isRangeAvailable(start, nextTime(start)))),
    ends: new Set(timeOptions.slice(1).filter(end => isRangeAvailable(input.start, end))),
    isRangeAvailable,
  };
}
