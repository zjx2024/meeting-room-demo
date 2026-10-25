const zone = 'Asia/Shanghai';

export function beijingDate(timestamp: string | number): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp));
  const value = (name: string) => parts.find(part => part.type === name)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function beijingTime(timestamp: string | number): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(timestamp));
}

export const isoTime = (date: string, time: string) => `${date}T${time}:00+08:00`;

export const timeOptions = Array.from({ length: 25 }, (_, index) => {
  const minutes = 8 * 60 + index * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});

export function nextTime(time: string): string {
  return timeOptions[Math.min(timeOptions.indexOf(time) + 1, timeOptions.length - 1)];
}

export function initialSlot(serverTime: string) {
  let date = beijingDate(serverTime);
  const [hours, minutes] = beijingTime(serverTime).split(':').map(Number);
  let next = Math.max(480, Math.ceil((hours * 60 + minutes + 1) / 30) * 30);
  if (next > 1170) {
    date = beijingDate(Date.parse(`${date}T12:00:00+08:00`) + 86400000);
    next = 480;
  }
  const start = `${String(Math.floor(next / 60)).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`;
  return { date, start, end: nextTime(start) };
}
