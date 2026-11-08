const nf = new Intl.NumberFormat('sv-SE');

export const kr = (n: number) => `${nf.format(Math.round(n))} kr`;
export const num = (n: number) => nf.format(n);

export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: string, n: number): string {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

const pad = (n: number) => String(n).padStart(2, '0');
// Built by hand: Hermes on Android does not always ship full Intl time formatting.
export const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const weekday = (key: string) => WEEKDAYS[fromKey(key).getDay()];
export const weekdayShort = (key: string) => weekday(key).slice(0, 3);
export const monthName = (key: string) => MONTHS[fromKey(key).getMonth()];

export function dayLabel(key: string, todayKey: string): string {
  if (key === todayKey) return 'Today';
  if (key === addDays(todayKey, 1)) return 'Tomorrow';
  return weekday(key);
}

export function shortDay(key: string): string {
  const d = fromKey(key);
  return `${weekdayShort(key)} ${d.getDate()} ${monthName(key).slice(0, 3)}`;
}

export function longDay(key: string, todayKey: string): string {
  const d = fromKey(key);
  return `${dayLabel(key, todayKey)} ${d.getDate()} ${monthName(key)}`;
}

export function dayPhrase(key: string, todayKey: string): string {
  if (key === todayKey) return 'today';
  if (key === addDays(todayKey, 1)) return 'tomorrow';
  return `on ${weekday(key)} ${fromKey(key).getDate()}`;
}

export function minutesText(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function distanceText(km: number): string {
  if (km < 1) return `${Math.round(km * 100) * 10} m`;
  return `${km.toFixed(1).replace('.', ',')} km`;
}

export function priceShort(n: number): string {
  const m = n / 1e6;
  return `${m.toFixed(m < 10 ? 2 : 1).replace('.', ',')} Mkr`;
}

// Swedish listings say "3 rok" (rum och kök): rooms plus a kitchen.
export const rok = (rooms: number) => `${rooms} rok`;

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const timeRange = (s: { start: number; end: number }) => `${hhmm(s.start)}–${hhmm(s.end)}`;
