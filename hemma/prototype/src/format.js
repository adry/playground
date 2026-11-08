const nf = new Intl.NumberFormat('sv-SE');

export const kr = (n) => `${nf.format(Math.round(n))} kr`;
export const num = (n) => nf.format(n);

export function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, n) {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

export const hhmm = (ms) =>
  new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });
const WEEKDAY_LONG = new Intl.DateTimeFormat('en-GB', { weekday: 'long' });
const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short' });

export function dayLabel(key, todayKey) {
  if (key === todayKey) return 'Today';
  if (key === addDays(todayKey, 1)) return 'Tomorrow';
  return WEEKDAY_LONG.format(fromKey(key));
}

export function shortDay(key) {
  const d = fromKey(key);
  return `${WEEKDAY.format(d)} ${d.getDate()} ${MONTH.format(d)}`;
}

export function chipParts(key, todayKey) {
  const d = fromKey(key);
  const top = key === todayKey ? 'Today' : WEEKDAY.format(d);
  return { top, date: d.getDate(), month: MONTH.format(d) };
}

export function minutesText(min) {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function distanceText(km) {
  if (km < 1) return `${Math.round(km * 100) * 10} m`;
  return `${km.toFixed(1).replace('.', ',')} km`;
}

export function priceShort(n) {
  const m = n / 1e6;
  return `${m.toFixed(m < 10 ? 2 : 1).replace('.', ',')} Mkr`;
}

// Swedish listings say "3 rok" (rum och kök): rooms plus a kitchen.
export const rok = (rooms) => `${rooms} rok`;
