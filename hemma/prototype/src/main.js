import { AREAS, AREA_BY_ID, DEMO_SPOTS, STOCKHOLM } from './areas.js';
import { generateListings, seedPromotions, PACKAGES, PACKAGE_BY_ID, DEMO_AGENT, AGENCIES, SPOTS_PER_AREA_DAY } from './data.js';
import { buildFeed, dayCounts, planDay, spotsLeft, activePromotion, slotsOn, statusOf, MAX_SPONSORED } from './feed.js';
import { facadeSVG } from './facade.js';
import { distanceKm, walkMinutes, toLocalKm } from './geo.js';
import * as F from './format.js';

// ---------------------------------------------------------------- data

const TODAY = F.dateKey(new Date());
const DAYS = Array.from({ length: 14 }, (_, i) => F.addDays(TODAY, i));
const LAST_DAY = DAYS[DAYS.length - 1];
const listings = generateListings(TODAY);
const byId = new Map(listings.map((l) => [l.id, l]));
const seeded = seedPromotions(listings, TODAY);

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(`hemma:${key}`);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`hemma:${key}`, JSON.stringify(value));
    } catch {
      /* private mode or blocked storage: the page still works, it just forgets */
    }
  },
};

const slotExists = (e) => byId.get(e.listingId)?.viewings.some((v) => v.start === e.start);

const TABS = ['viewings', 'map', 'plan', 'agents'];
const state = {
  tab: 'viewings',
  day: TODAY,
  place: { mode: 'near', radiusKm: 3, areas: ['sodermalm'], ...store.get('place', {}) },
  spot: store.get('spot', 'medborgarplatsen'),
  gps: null,
  filters: { types: [], minRooms: 0, maxPrice: 0, openOnly: false, ...store.get('filters', {}) },
  sort: store.get('sort', 'time'),
  plan: store.get('plan', []).filter(slotExists),
  booked: store.get('booked', []).filter((p) => p.to >= TODAY && byId.has(p.listingId)),
  mapPick: null,
  showEnded: false,
};
if (state.spot === 'gps') state.spot = 'medborgarplatsen';

const save = () => {
  store.set('place', state.place);
  store.set('spot', state.spot);
  store.set('filters', state.filters);
  store.set('sort', state.sort);
  store.set('plan', state.plan);
  store.set('booked', state.booked);
};

const promotions = () => [...seeded, ...state.booked];

function origin() {
  if (state.spot === 'gps' && state.gps) return { ...state.gps, label: 'Your location' };
  return DEMO_SPOTS.find((s) => s.id === state.spot) || DEMO_SPOTS[0];
}

function place() {
  return state.place.mode === 'area'
    ? { mode: 'area', areas: state.place.areas }
    : { mode: 'near', origin: origin(), radiusKm: state.place.radiusKm };
}

function feedFor(day = state.day, overrides = {}) {
  return buildFeed({
    listings,
    promotions: promotions(),
    day,
    now: Date.now(),
    place: overrides.place || place(),
    filters: overrides.filters || state.filters,
    origin: origin(),
    sort: state.sort,
  });
}

const inPlan = (listingId, start) => state.plan.some((e) => e.listingId === listingId && e.start === start);

function togglePlan(listingId, start) {
  if (inPlan(listingId, start)) {
    state.plan = state.plan.filter((e) => !(e.listingId === listingId && e.start === start));
    toast('Removed from your day');
  } else {
    state.plan.push({ listingId, start });
    const l = byId.get(listingId);
    toast(`Added ${l.address}, ${F.hhmm(start)} ${F.dayLabel(F.dateKey(new Date(start)), TODAY).toLowerCase()}`);
  }
  save();
}

// ---------------------------------------------------------------- helpers

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const areaName = (id) => AREA_BY_ID[id]?.name ?? id;

const ICON = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  close: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  walk: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="13" cy="4.5" r="1.8"/><path d="m9 21 2.5-6 2.5 2.5V21M8 11l3-3.5 3 2 2.5 2.5M11.5 15l1-5.5"/></svg>',
  warn: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 4 2.5 20h19L12 4z"/><path d="M12 10v4.5M12 17.5v.01"/></svg>',
  filter: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
  sort: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5"/></svg>',
  ok: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  cal: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>',
  trash: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/></svg>',
};

function statusText(item) {
  switch (item.status) {
    case 'live': return `On now · ${F.minutesText(item.endsIn)} left`;
    case 'soon': return `Starts in ${F.minutesText(item.startsIn)}`;
    case 'later': return `In ${F.minutesText(item.startsIn)}`;
    case 'ended': return 'Ended';
    default: return '';
  }
}

function statusHTML(item) {
  const text = statusText(item);
  const dot = item.status === 'live' ? '<i class="live-dot"></i>' : '';
  const book = item.slot.booking ? '<span class="chip-book">Book first</span>' : '';
  return `${text ? `<span class="status ${item.status}">${dot}${text}</span>` : ''}${book}`;
}

function whereText(item) {
  const l = item.listing;
  const dist = item.distanceKm != null ? ` · ${F.distanceText(item.distanceKm)}, ${item.walkMin} min walk` : '';
  return `${areaName(l.area)}${dist}`;
}

function factsText(l) {
  const fee = l.fee ? ` · ${F.num(l.fee)} kr/mån` : '';
  return `${F.rok(l.rooms)} · ${l.size} m²${fee}`;
}

function addButton(item, iconOnly) {
  const pressed = inPlan(item.listing.id, item.slot.start);
  const label = pressed ? 'In my day' : 'Add to my day';
  const aria = `${label}: ${item.listing.address} at ${F.hhmm(item.slot.start)}`;
  return `<button class="add${iconOnly ? ' icon' : ''}" type="button" data-add="${item.listing.id}" data-start="${item.slot.start}" aria-pressed="${pressed}" aria-label="${esc(aria)}">${pressed ? ICON.check : ICON.plus}${iconOnly ? '' : label}</button>`;
}

function timeRange(slot) {
  return `${F.hhmm(slot.start)}–${F.hhmm(slot.end)}`;
}

// ---------------------------------------------------------------- cards

function sponsoredCard(item, { preview = false } = {}) {
  const l = item.listing;
  const agency = esc(l.agency);
  const opener = preview
    ? `<span>${esc(l.address)}</span>`
    : `<button class="stretch" type="button" data-open="${l.id}">${esc(l.address)}</button>`;
  return `<article class="sp" aria-label="Sponsored viewing">
    <div class="sp-art">${facadeSVG(l)}<span class="sign">Sponsored</span></div>
    <div class="sp-body">
      <div class="sp-when"><span class="sp-time">${timeRange(item.slot)}</span>${statusHTML(item)}</div>
      <h3>${opener}</h3>
      <p class="meta">${esc(whereText(item))}</p>
      <p class="facts">${factsText(l)}</p>
      <div class="sp-foot"><span class="price">${F.kr(l.price)}</span>${preview ? '' : addButton(item, false)}</div>
      <p class="sp-by">Promoted by ${agency}</p>
    </div>
  </article>`;
}

function rowCard(item) {
  const l = item.listing;
  const others = item.slots.filter((s) => s !== item.slot);
  const also = others.length ? `<em>also ${others.map((s) => F.hhmm(s.start)).join(', ')}</em>` : '';
  return `<article class="v is-${item.status}">
    <div class="v-time"><b>${F.hhmm(item.slot.start)}</b><span>${F.hhmm(item.slot.end)}</span>${also}</div>
    <div class="v-card">
      <div class="v-thumb">${facadeSVG(l)}</div>
      <div class="v-info">
        <h3><button class="stretch" type="button" data-open="${l.id}">${esc(l.address)}</button></h3>
        <p class="meta">${esc(areaName(l.area))}${item.distanceKm != null ? ` · ${F.distanceText(item.distanceKm)}` : ''}</p>
        <p class="facts">${F.rok(l.rooms)} · ${l.size} m² · ${F.priceShort(l.price)}</p>
        <div>${statusHTML(item)}</div>
      </div>
      ${addButton(item, true)}
    </div>
  </article>`;
}

function section(title, items, cls = '') {
  if (!items.length) return '';
  return `<div class="sec"><h2 class="${cls}">${title}</h2><span class="n">${items.length}</span></div><div class="rows">${items.map(rowCard).join('')}</div>`;
}

// ---------------------------------------------------------------- header

function placeLabel() {
  if (state.place.mode === 'near') {
    return { kicker: `Within ${state.place.radiusKm} km of`, name: origin().label };
  }
  const names = state.place.areas.map(areaName);
  return {
    kicker: names.length === 1 ? 'Area' : `${names.length} areas`,
    name: names.length ? names.join(', ') : 'All of Stockholm',
  };
}

function renderHeader() {
  const p = placeLabel();
  $('#placeKicker').textContent = p.kicker;
  $('#placeName').textContent = p.name;
  const daysEl = $('#days');
  daysEl.hidden = state.tab === 'agents';
  const counts = dayCounts({ listings, days: DAYS, place: place(), filters: state.filters });
  const custom = !DAYS.includes(state.day);
  daysEl.innerHTML =
    DAYS.map((d) => {
      const c = F.chipParts(d, TODAY);
      const wd = F.fromKey(d).getDay();
      const cls = `day${counts[d] ? '' : ' is-empty'}${wd === 0 || wd === 6 ? ' is-weekend' : ''}`;
      const label = `${F.dayLabel(d, TODAY)} ${F.shortDay(d)}, ${plural(counts[d], 'viewing')}`;
      return `<button class="${cls}" type="button" role="tab" data-day="${d}" aria-selected="${d === state.day}" aria-label="${esc(label)}">
        <span class="day-top">${c.top}</span><span class="day-date">${c.date}</span><span class="day-count">${counts[d] || '–'}</span></button>`;
    }).join('') +
    `<label class="day pick" ${custom ? 'aria-selected="true"' : ''}>
      ${ICON.cal}<span class="day-top">${custom ? esc(F.shortDay(state.day)) : 'Pick'}</span>
      <input type="date" id="datePick" min="${TODAY}" value="${state.day}" aria-label="Pick another date">
    </label>`;
  const selected = daysEl.querySelector('[aria-selected="true"]');
  if (selected && !daysEl.dataset.scrolled) {
    selected.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    daysEl.dataset.scrolled = '1';
  }
  const badge = $('#planBadge');
  const n = state.plan.filter((e) => e.start > Date.now() - 3 * 3600e3).length;
  badge.hidden = n === 0;
  badge.textContent = n;
  document.querySelectorAll('.tabs a').forEach((a) => {
    if (a.dataset.tab === state.tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

// ---------------------------------------------------------------- viewings

function placePhrase() {
  if (state.place.mode === 'near') return `within ${state.place.radiusKm} km`;
  const names = state.place.areas.map(areaName);
  return names.length ? `in ${names.length > 2 ? `${names.length} areas` : names.join(' and ')}` : 'in Stockholm';
}

function dayPhrase(day = state.day) {
  if (day === TODAY) return 'today';
  if (day === F.addDays(TODAY, 1)) return 'tomorrow';
  return `on ${F.dayLabel(day, TODAY)} ${F.fromKey(day).getDate()}`;
}

function filterCount() {
  const f = state.filters;
  return (f.types.length ? 1 : 0) + (f.minRooms ? 1 : 0) + (f.maxPrice ? 1 : 0) + (f.openOnly ? 1 : 0);
}

function nextBusyDay(after) {
  const counts = dayCounts({ listings, days: DAYS, place: place(), filters: state.filters });
  return DAYS.find((d) => d > after && counts[d] > 0);
}

function renderViewings() {
  const feed = feedFor();
  const liveBit = feed.live ? ` · <span class="live-count"><i class="live-dot"></i>${feed.live} on now</span>` : '';
  $('#summary').innerHTML = `<strong>${plural(feed.total, 'viewing')} ${dayPhrase()}</strong>${placePhrase()}${liveBit}`;
  $('#sortBtn').innerHTML = `${ICON.sort}${state.sort === 'time' ? 'Soonest' : 'Nearest'}`;
  $('#sortBtn').setAttribute('aria-label', `Sorted by ${state.sort === 'time' ? 'start time' : 'distance'}. Change sorting`);
  const fc = filterCount();
  $('#filterBtn').innerHTML = `${ICON.filter}Filters${fc ? `<b>${fc}</b>` : ''}`;

  $('#sponsored').innerHTML = feed.sponsored.map((i) => sponsoredCard(i)).join('');

  if (!feed.total) {
    const next = nextBusyDay(state.day);
    const wider = state.place.mode === 'near' && state.place.radiusKm < 10;
    $('#feed').innerHTML = `<div class="empty">
      <h2>No viewings ${dayPhrase()} ${placePhrase()}</h2>
      <p>${state.day > LAST_DAY ? 'Agents publish viewings about two weeks ahead, so this day is still empty.' : 'Try another day or a wider area.'}</p>
      <div class="chips">
        ${next ? `<button class="btn primary" type="button" data-day="${next}">See ${esc(F.dayLabel(next, TODAY))} ${F.fromKey(next).getDate()}</button>` : ''}
        ${wider ? `<button class="btn" type="button" data-radius="${state.place.radiusKm < 5 ? 5 : 10}">Widen to ${state.place.radiusKm < 5 ? 5 : 10} km</button>` : ''}
        ${filterCount() ? '<button class="btn" type="button" data-clear-filters>Clear filters</button>' : ''}
      </div></div>`;
    return;
  }

  const items = feed.organic;
  let html = '';
  if (state.sort === 'distance') {
    const open = items.filter((i) => i.status !== 'ended');
    html += section('Nearest first', open);
    html += endedSection(items.filter((i) => i.status === 'ended'));
  } else if (state.day === TODAY) {
    html += section('On now', items.filter((i) => i.status === 'live'), 'live');
    html += section('Coming up', items.filter((i) => i.status === 'soon' || i.status === 'later'));
    html += endedSection(items.filter((i) => i.status === 'ended'));
  } else {
    const hour = (i) => new Date(i.slot.start).getHours();
    html += section('Morning', items.filter((i) => hour(i) < 12));
    html += section('Afternoon', items.filter((i) => hour(i) >= 12 && hour(i) < 17));
    html += section('Evening', items.filter((i) => hour(i) >= 17));
  }
  if (feed.sponsored.length && !items.length) html += '<p class="hint">Every viewing that matches is shown above.</p>';
  $('#feed').innerHTML = html;
}

function endedSection(ended) {
  if (!ended.length) return '';
  if (state.showEnded) return section('Earlier today', ended);
  return `<div class="sec"><h2>Earlier today</h2><span class="n">${ended.length}</span></div>
    <button class="btn" type="button" data-show-ended>Show ${plural(ended.length, 'ended viewing')}</button>`;
}

// ---------------------------------------------------------------- map

function renderMap() {
  const feed = feedFor();
  const items = [...feed.organic, ...feed.sponsored];
  const featured = new Set(feed.sponsored.filter((i) => i.promotion.tier >= 3).map((i) => i.listing.id));
  const o = origin();
  let center;
  let R;
  if (state.place.mode === 'near') {
    center = o;
    R = state.place.radiusKm;
  } else {
    const chosen = state.place.areas.length ? state.place.areas.map((id) => AREA_BY_ID[id]) : AREAS;
    center = { lat: chosen.reduce((s, a) => s + a.lat, 0) / chosen.length, lng: chosen.reduce((s, a) => s + a.lng, 0) / chosen.length };
    R = Math.max(1.2, ...items.map((i) => distanceKm(center, i.listing) * 1.12));
    R = Math.ceil(R * 2) / 2;
  }
  const pad = R * 1.1;
  const fs = R * 0.058;
  const parts = [];
  parts.push(`<circle class="ring-fill" r="${R}"/>`);
  parts.push(`<line class="axis" x1="${-R}" y1="0" x2="${R}" y2="0" stroke-width="${R * 0.004}"/><line class="axis" x1="0" y1="${-R}" x2="0" y2="${R}" stroke-width="${R * 0.004}"/>`);
  for (const k of [1 / 3, 2 / 3, 1]) {
    const r = R * k;
    const km = Math.round(r * 10) / 10;
    parts.push(`<circle class="ring" r="${r}" stroke-width="${R * 0.006}"/>`);
    parts.push(`<text class="ring-label" x="0" y="${r - R * 0.02}" font-size="${fs * 0.9}" text-anchor="middle">${String(km).replace('.', ',')} km · ${walkMinutes(km)} min</text>`);
  }
  parts.push(`<text class="north" x="0" y="${-R - R * 0.03}" font-size="${fs}" text-anchor="middle">N</text>`);

  for (const a of AREAS) {
    const p = toLocalKm(center, a);
    if (Math.hypot(p.x, p.y) > R * 0.98) continue;
    const anchor = p.x < -R * 0.55 ? 'start' : p.x > R * 0.55 ? 'end' : 'middle';
    parts.push(`<text class="area-label" x="${p.x}" y="${-p.y - fs * 0.6}" font-size="${fs}" text-anchor="${anchor}">${esc(a.name)}</text>`);
  }

  const op = toLocalKm(center, o);
  if (Math.hypot(op.x, op.y) <= R * 1.05) {
    parts.push(`<circle class="you-halo" cx="${op.x}" cy="${-op.y}" r="${R * 0.06}"/><circle class="you" cx="${op.x}" cy="${-op.y}" r="${R * 0.022}" stroke-width="${R * 0.008}"/>`);
  }

  const order = { ended: 0, scheduled: 1, later: 1, soon: 2, live: 3 };
  const sorted = [...items].sort((a, b) => order[a.status] - order[b.status] || featured.has(a.listing.id) - featured.has(b.listing.id));
  const pr = R * 0.04;
  for (const item of sorted) {
    const p = toLocalKm(center, item.listing);
    const x = p.x;
    const y = -p.y;
    const picked = state.mapPick === item.listing.id;
    const isFeatured = featured.has(item.listing.id);
    const r = picked ? pr * 1.45 : pr;
    const label = `${item.listing.address}, ${timeRange(item.slot)}${statusText(item) ? `, ${statusText(item)}` : ''}`;
    let g = `<g data-pick="${item.listing.id}" role="button" tabindex="0" aria-label="${esc(label)}">`;
    if (item.status === 'live') g += `<circle class="pulse" cx="${x}" cy="${y}" r="${r}"/>`;
    if (isFeatured) g += `<circle class="featured-ring" cx="${x}" cy="${y}" r="${r * 1.7}"/>`;
    g += `<circle class="pin ${item.status}${picked ? ' picked' : ''}" cx="${x}" cy="${y}" r="${r}" stroke-width="${R * 0.008}"/>`;
    if (picked || isFeatured) {
      g += `<text class="pin-label" x="${x + r * 1.9}" y="${y + fs * 0.35}" font-size="${fs}" stroke-width="${fs * 0.28}">${F.hhmm(item.slot.start)}</text>`;
    }
    g += `<circle cx="${x}" cy="${y}" r="${pr * 2.4}" fill="transparent"/></g>`;
    parts.push(g);
  }

  const svg = $('#radar');
  svg.setAttribute('viewBox', `${-pad} ${-pad} ${pad * 2} ${pad * 2}`);
  svg.innerHTML = parts.join('');

  const centreName = state.place.mode === 'near' ? o.label : placeLabel().name;
  $('#mapSummary').innerHTML = `<strong>${plural(items.length, 'viewing')} ${dayPhrase()}</strong>around ${esc(centreName)}${feed.live ? ` · <span class="live-count"><i class="live-dot"></i>${feed.live} on now</span>` : ''}`;

  const pick = items.find((i) => i.listing.id === state.mapPick);
  $('#mapPick').innerHTML = pick
    ? `<div class="rows">${rowCard(pick)}</div>`
    : `<p class="hint">Tap a pin to see the viewing. Rings show walking time from ${state.place.mode === 'near' ? 'you' : 'the middle of the area'}.</p>`;
}

// ---------------------------------------------------------------- my day

function googleRoute(stops, from) {
  if (!stops.length) return null;
  const addr = (s) => `${s.listing.address}, Stockholm`;
  const params = new URLSearchParams({ api: '1', origin: `${from.lat},${from.lng}`, destination: addr(stops[stops.length - 1]), travelmode: 'walking' });
  if (stops.length > 1) params.set('waypoints', stops.slice(0, -1).map(addr).join('|'));
  return `https://www.google.com/maps/dir/?${params}`;
}

function renderPlan() {
  const el = $('#view-plan');
  const o = origin();
  const entries = state.plan.filter((e) => F.dateKey(new Date(e.start)) === state.day);
  const plan = planDay({ entries, listings, origin: o });
  const dayName = `${F.dayLabel(state.day, TODAY)} ${F.fromKey(state.day).getDate()} ${F.fromKey(state.day).toLocaleDateString('en-GB', { month: 'long' })}`;
  const others = [...new Set(state.plan.map((e) => F.dateKey(new Date(e.start))))].filter((d) => d !== state.day && d >= TODAY).sort();
  const otherHTML = others.length
    ? `<div class="other-days"><h3>Also planned</h3><div class="chips">${others
        .map((d) => `<button class="chip" type="button" data-day="${d}">${esc(F.shortDay(d))} <small>${state.plan.filter((e) => F.dateKey(new Date(e.start)) === d).length}</small></button>`)
        .join('')}</div></div>`
    : '';

  if (!plan.stops.length) {
    el.innerHTML = `<div class="plan-head"><h2>${esc(dayName)}</h2><p>Your viewing route</p></div>
      <div class="empty"><h2>Nothing planned yet</h2><p>Tap + on any viewing and it lands here in time order, with the walk between each one.</p>
      <a class="btn primary" href="#viewings">Browse viewings ${dayPhrase()}</a></div>${otherHTML}`;
    return;
  }

  const now = Date.now();
  let html = `<div class="plan-head"><h2>${esc(dayName)}</h2><p>${plural(plan.stops.length, 'viewing')} · ${plan.walkTotal} min walking from ${esc(o.label)}</p></div><ol class="route">`;
  html += `<li class="stop-origin"><span class="node"></span><span><strong>Start</strong> · ${esc(o.label)}</span></li>`;
  plan.stops.forEach((s, idx) => {
    html += `<li class="leg"><span></span><span class="walk">${ICON.walk}${s.walkMin} min walk · ${F.distanceText(s.walkKm)}</span></li>`;
    const st = statusOf([s.slot], now, state.day);
    const item = { listing: s.listing, slot: s.slot, slots: [s.slot], status: st.key, startsIn: st.startsIn, endsIn: st.endsIn };
    let warn = '';
    if (s.warning?.kind === 'miss') warn = `<span class="warn">${ICON.warn}You'd arrive with ${s.warning.minutes} min left</span>`;
    else if (s.warning?.kind === 'late') warn = `<span class="warn">${ICON.warn}About ${s.warning.minutes} min late</span>`;
    const leave = idx < plan.stops.length - 1 ? `<p class="meta">Leave by ${F.hhmm(s.leave)}</p>` : '';
    html += `<li class="stop"><div class="v-time"><b>${F.hhmm(s.slot.start)}</b><span>${F.hhmm(s.slot.end)}</span></div>
      <div class="v-card">
        <div class="v-thumb">${facadeSVG(s.listing)}</div>
        <div class="v-info">
          <h3><button class="stretch" type="button" data-open="${s.listing.id}">${esc(s.listing.address)}</button></h3>
          <p class="meta">${esc(areaName(s.listing.area))} · ${F.priceShort(s.listing.price)}</p>
          ${leave}<div>${statusHTML(item)}</div>${warn}
        </div>
        <button class="remove" type="button" data-add="${s.listing.id}" data-start="${s.slot.start}" aria-label="Remove ${esc(s.listing.address)} from your day">${ICON.trash}</button>
      </div></li>`;
  });
  html += '</ol>';
  const route = googleRoute(plan.stops, o);
  html += `<div class="plan-actions"><a class="btn primary block" href="${esc(route)}" target="_blank" rel="noopener">${ICON.walk}Walking route in Google Maps</a></div>`;
  el.innerHTML = html + otherHTML;
}

// ---------------------------------------------------------------- agents

const agency = AGENCIES.find((a) => a.id === DEMO_AGENT.agencyId);

function bookingFor(listingId) {
  return state.booked.filter((p) => p.listingId === listingId && p.to >= TODAY).sort((a, b) => (a.from < b.from ? -1 : 1))[0];
}

function viewingDays(l) {
  return [...new Set(l.viewings.filter((v) => v.end > Date.now()).map((v) => F.dateKey(new Date(v.start))))].sort();
}

function renderAgents() {
  const mine = listings.filter((l) => l.agencyId === agency.id);
  const rows = mine
    .map((l) => {
      const days = viewingDays(l);
      const next = l.viewings.find((v) => v.end > Date.now());
      const booked = bookingFor(l.id);
      const when = next ? `${F.dayLabel(F.dateKey(new Date(next.start)), TODAY)} ${F.hhmm(next.start)}` : 'No viewings booked';
      const status = booked
        ? `<span class="boosted"><i></i>${esc(PACKAGE_BY_ID[booked.packageId].name)} · ${esc(F.shortDay(booked.from))}${booked.to !== booked.from ? ` to ${esc(F.shortDay(booked.to))}` : ''}</span>`
        : `<span class="meta">${next ? `Next viewing ${esc(when)}` : 'No upcoming viewings'}</span>`;
      const action = booked
        ? `<button class="small-btn" type="button" data-cancel="${booked.id}">Cancel</button>`
        : `<button class="small-btn primary" type="button" data-promote="${l.id}" ${days.length ? '' : 'disabled'}>Promote</button>`;
      return `<div class="mine-row"><div class="v-thumb">${facadeSVG(l)}</div>
        <div class="v-info"><h3>${esc(l.address)}</h3><p class="meta">${esc(areaName(l.area))} · ${F.priceShort(l.price)}</p>${status}</div>${action}</div>`;
    })
    .join('');

  $('#view-agents').innerHTML = `
    <div class="ag-hero">
      <h2>Put your viewing first</h2>
      <p>Buyers open Hemma to see what is on today, or on the day they plan to go out. A boost puts your viewing at the top of their feed, in a larger card, when they look at your area on your viewing day.</p>
    </div>
    <div class="account"><span class="avatar">ME</span><div><strong>${esc(DEMO_AGENT.name)} · ${esc(agency.name)}</strong><span>Demo agent account. Payments are simulated.</span></div></div>
    <h3 class="h-sec">Your listings</h3>
    <div class="mine">${rows}</div>
    <h3 class="h-sec">Packages</h3>
    <div class="packages">${PACKAGES.map((p) => `<div class="pkg"><h3>${esc(p.name)}</h3><span class="pkg-price">${F.kr(p.price)}</span><p>${esc(p.blurb)}</p></div>`).join('')}</div>
    <h3 class="h-sec">How placement works</h3>
    <ul class="rules">
      <li>${ICON.ok}<span>Your viewing is lifted only for buyers whose search already includes it: same day, same area or distance, same filters.</span></li>
      <li>${ICON.ok}<span>At most ${MAX_SPONSORED} sponsored viewings sit at the top of a feed, and ${SPOTS_PER_AREA_DAY} spots are sold per area and day. When they are gone, the day is sold out.</span></li>
      <li>${ICON.ok}<span>Longer packages are placed first. Equal packages rotate each day, so no agency holds the top spot for good.</span></li>
      <li>${ICON.ok}<span>Every boosted card says Sponsored and names your agency. Once the viewing has ended it drops back into the normal feed.</span></li>
    </ul>`;
}

const promo = { listingId: null, packageId: 'weekend', startDay: null, done: null };

function openPromote(listingId) {
  const l = byId.get(listingId);
  promo.listingId = listingId;
  promo.packageId = promo.packageId || 'weekend';
  const days = viewingDays(l);
  promo.startDay = days.find((d) => spotsLeft({ promotions: promotions(), listings, area: l.area, day: d, exceptListingId: l.id }) > 0) || days[0];
  promo.done = null;
  renderPromote();
  openSheet();
}

function promoPlan() {
  const l = byId.get(promo.listingId);
  const pkg = PACKAGE_BY_ID[promo.packageId];
  const from = promo.startDay;
  const to = F.addDays(from, pkg.days - 1);
  const covered = l.viewings.filter((v) => {
    const k = F.dateKey(new Date(v.start));
    return k >= from && k <= to && v.end > Date.now();
  });
  const coveredDays = [...new Set(covered.map((v) => F.dateKey(new Date(v.start))))];
  const left = Math.min(...coveredDays.map((day) => spotsLeft({ promotions: promotions(), listings, area: l.area, day, exceptListingId: l.id })));
  return { l, pkg, from, to, covered, coveredDays, left: Number.isFinite(left) ? left : SPOTS_PER_AREA_DAY };
}

function renderPromote() {
  const body = $('#sheetBody');
  if (promo.done) {
    const l = byId.get(promo.done.listingId);
    body.innerHTML = `<div class="sheet-bar"><h2>Booked</h2><button class="close" type="button" data-close aria-label="Close">${ICON.close}</button></div>
      <div class="done"><span class="tick">${ICON.ok}</span>
        <h2>${esc(l.address)} is sponsored</h2>
        <p class="meta">${esc(PACKAGE_BY_ID[promo.done.packageId].name)}, ${esc(F.shortDay(promo.done.from))}${promo.done.to !== promo.done.from ? ` to ${esc(F.shortDay(promo.done.to))}` : ''}. Buyers looking at ${esc(areaName(l.area))} on your viewing days now see it first.</p>
        <button class="btn primary" type="button" data-see-feed="${l.id}">See it in the ${esc(areaName(l.area))} feed</button>
      </div>`;
    return;
  }
  const { l, pkg, from, to, covered, coveredDays, left } = promoPlan();
  const days = viewingDays(l);
  const dayChips = days
    .map((d) => {
      const leftThat = spotsLeft({ promotions: promotions(), listings, area: l.area, day: d, exceptListingId: l.id });
      return `<button class="chip" type="button" data-start-day="${d}" aria-pressed="${d === from}" ${leftThat ? '' : 'disabled'}>${esc(F.shortDay(d))} <small>${leftThat ? `${leftThat} left` : 'Sold out'}</small></button>`;
    })
    .join('');
  const first = covered[0];
  const st = statusOf([first], Date.now(), F.dateKey(new Date(first.start)));
  const km = distanceKm(origin(), l);
  const previewItem = { listing: l, slot: first, slots: [first], status: st.key, startsIn: st.startsIn, endsIn: st.endsIn, distanceKm: km, walkMin: walkMinutes(km) };
  const spots = Array.from({ length: SPOTS_PER_AREA_DAY }, (_, i) => `<i class="${i < SPOTS_PER_AREA_DAY - left ? '' : 'free'}"></i>`).join('');

  body.innerHTML = `<div class="sheet-bar"><h2>Promote ${esc(l.address)}</h2><button class="close" type="button" data-close aria-label="Close">${ICON.close}</button></div>
    <div class="sheet-section"><h3>Package</h3><div class="pkg-pick">
      ${PACKAGES.map((p) => `<button class="pkg-opt" type="button" data-pkg="${p.id}" aria-pressed="${p.id === pkg.id}"><strong>${esc(p.name)} · ${plural(p.days, 'day')}</strong><span class="p">${F.kr(p.price)}</span><span class="d">${esc(p.blurb)}</span></button>`).join('')}
    </div></div>
    <div class="sheet-section"><h3>Starting</h3><div class="chips">${dayChips}</div>
      <p class="inventory"><span class="spots" aria-hidden="true">${spots}</span>${left} of ${SPOTS_PER_AREA_DAY} sponsored spots left in ${esc(areaName(l.area))}${coveredDays.length > 1 ? ' on the busiest covered day' : ` on ${esc(F.shortDay(coveredDays[0]))}`}</p>
    </div>
    <div class="sheet-section"><h3>Covers</h3><div class="covers">${esc(F.shortDay(from))}${to !== from ? ` to ${esc(F.shortDay(to))}` : ''}, with ${plural(covered.length, 'viewing')}:
      <ul>${covered.map((v) => `<li>${esc(F.shortDay(F.dateKey(new Date(v.start))))}, ${timeRange(v)}</li>`).join('')}</ul></div></div>
    <div class="sheet-section"><h3>How buyers see it</h3>${sponsoredCard(previewItem, { preview: true })}</div>
    <div class="sheet-foot" style="flex-direction: column">
      <div class="total"><span>Total, excl. VAT</span><strong>${F.kr(pkg.price)}</strong></div>
      <button class="btn primary block" type="button" data-pay ${left ? '' : 'disabled'}>${left ? `Pay ${F.kr(pkg.price)}` : 'Sold out for these days'}</button>
      <p class="note">Simulated payment. Nothing is charged in this demo.</p>
    </div>`;
}

function pay() {
  const { l, pkg, from, to, left } = promoPlan();
  if (!left) return;
  const booking = { id: `b-${l.id}-${from}-${pkg.id}`, listingId: l.id, packageId: pkg.id, from, to, tier: pkg.tier };
  state.booked = state.booked.filter((p) => p.listingId !== l.id).concat(booking);
  save();
  promo.done = booking;
  renderPromote();
  render();
}

// ---------------------------------------------------------------- sheets

const sheet = $('#sheet');
function openSheet() {
  if (!sheet.open) {
    if (typeof sheet.showModal === 'function') sheet.showModal();
    else sheet.setAttribute('open', '');
  }
  $('#sheetBody').scrollTop = 0;
}
function closeSheet() {
  if (typeof sheet.close === 'function') sheet.close();
  else sheet.removeAttribute('open');
  sheetKind = null;
}
let sheetKind = null;
sheet.addEventListener('close', () => {
  sheetKind = null;
});
sheet.addEventListener('click', (e) => {
  if (e.target === sheet) closeSheet();
});

function openDetail(id) {
  sheetKind = { kind: 'detail', id };
  renderDetail(id);
  openSheet();
}

function renderDetail(id) {
  const l = byId.get(id);
  const o = origin();
  const km = distanceKm(o, l);
  const promoNow = activePromotion(promotions(), l.id, state.day);
  const upcoming = l.viewings.filter((v) => v.end > Date.now() - 3600e3);
  const slots = upcoming
    .map((v) => {
      const k = F.dateKey(new Date(v.start));
      const st = statusOf([v], Date.now(), k);
      const pressed = inPlan(l.id, v.start);
      const note = st.key === 'ended' ? 'Ended' : v.booking ? 'Book a time with the agent first' : 'Open viewing, just turn up';
      return `<div class="slot"><div><strong>${esc(F.dayLabel(k, TODAY))} ${F.fromKey(k).getDate()} · ${timeRange(v)}</strong><span>${note}</span></div>
        <button class="add" type="button" data-add="${l.id}" data-start="${v.start}" aria-pressed="${pressed}" ${st.key === 'ended' ? 'disabled' : ''}>${pressed ? ICON.check : ICON.plus}${pressed ? 'In my day' : 'Add'}</button></div>`;
    })
    .join('');
  const query = encodeURIComponent(`${l.address}, Stockholm`);
  const initials = l.agent.split(' ').map((p) => p[0]).join('');
  const facts = [
    ['Rooms', F.rok(l.rooms)],
    ['Living area', `${l.size} m²`],
    [l.fee ? 'Fee' : 'Tenure', l.fee ? `${F.num(l.fee)} kr/mån` : l.tenure],
    [l.floor ? 'Floor' : 'Type', l.floor ? `${l.floor} of ${l.floors}` : l.type === 'house' ? 'Detached' : 'Terraced'],
    ['Built', l.built],
    ['Per m²', `${F.num(Math.round(l.price / l.size / 100) * 100)} kr`],
  ];
  $('#sheetBody').innerHTML = `<div class="sheet-bar"><span class="meta">${esc(l.tenure)} · ${esc(areaName(l.area))}</span><button class="close" type="button" data-close aria-label="Close">${ICON.close}</button></div>
    <div class="detail-art">${facadeSVG(l)}${promoNow ? '<span class="sign">Sponsored</span>' : ''}</div>
    <div class="detail-title"><h2>${esc(l.address)}</h2><p class="meta">${esc(areaName(l.area))}, Stockholm · ${F.distanceText(km)} from ${esc(o.label)}, ${walkMinutes(km)} min walk</p>
      <p class="detail-price">${F.kr(l.price)}</p></div>
    <div class="sheet-section"><dl class="facts-grid">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></div>
    <div class="sheet-section"><p class="blurb">${esc(l.blurb)}</p></div>
    <div class="sheet-section"><h3>Viewings</h3><div class="slots">${slots || '<p class="meta">No upcoming viewings.</p>'}</div></div>
    <div class="sheet-section"><h3>Agent</h3>
      <div class="agent"><span class="avatar">${esc(initials)}</span><div><strong>${esc(l.agent)}</strong><p class="meta">${esc(l.agency)}</p>
        <div class="phone-row"><span class="phone" id="phone">${esc(l.phone)}</span><button class="small-btn" type="button" data-copy="${esc(l.phone)}">Copy number</button></div></div></div></div>
    <div class="sheet-section"><div class="links">
      <a class="btn" href="https://maps.apple.com/?daddr=${query}&dirflg=w" target="_blank" rel="noopener">${ICON.walk}Directions</a>
      <a class="btn" href="https://www.google.com/maps/search/?api=1&query=${query}" target="_blank" rel="noopener">Google Maps</a>
    </div></div>
    ${promoNow ? `<div class="sheet-section"><p class="disclosure"><strong>Sponsored by ${esc(l.agency)}.</strong> Sponsored viewings appear first, but only when they match the day, area and filters you picked.</p></div>` : ''}`;
}

function openPlace() {
  sheetKind = { kind: 'place' };
  renderPlace();
  openSheet();
}

function renderPlace() {
  const p = state.place;
  const counts = {};
  for (const a of AREAS) counts[a.id] = feedFor(state.day, { place: { mode: 'area', areas: [a.id] } }).total;
  const total = feedFor().total;
  const nearPanel = `
    <div class="sheet-section"><h3>Start from</h3>
      <button class="btn" type="button" data-gps>${ICON.walk}Use my location</button>
      <div class="chips">${DEMO_SPOTS.map((s) => `<button class="chip" type="button" data-spot="${s.id}" aria-pressed="${state.spot === s.id}">${esc(s.label)}</button>`).join('')}
      ${state.gps ? `<button class="chip" type="button" data-spot="gps" aria-pressed="${state.spot === 'gps'}">Your location</button>` : ''}</div></div>
    <div class="sheet-section"><h3>Distance</h3><div class="chips">${[1, 2, 3, 5, 10]
      .map((km) => `<button class="chip" type="button" data-radius="${km}" aria-pressed="${p.radiusKm === km}">${km} km <small>${walkMinutes(km)} min walk</small></button>`)
      .join('')}</div></div>`;
  const areaPanel = `
    <div class="sheet-section"><h3>Areas · ${esc(dayPhrase())}</h3><div class="chips">${AREAS.map(
      (a) => `<button class="chip" type="button" data-area="${a.id}" aria-pressed="${p.areas.includes(a.id)}">${esc(a.name)} <small>${counts[a.id]}</small></button>`,
    ).join('')}</div></div>`;
  $('#sheetBody').innerHTML = `<div class="sheet-bar"><h2>Where are you looking?</h2><button class="close" type="button" data-close aria-label="Close">${ICON.close}</button></div>
    <div class="seg" role="group" aria-label="Search by"><button type="button" data-mode="near" aria-pressed="${p.mode === 'near'}">Around me</button><button type="button" data-mode="area" aria-pressed="${p.mode === 'area'}">Pick areas</button></div>
    ${p.mode === 'near' ? nearPanel : areaPanel}
    <div class="sheet-foot"><button class="btn primary block" type="button" data-close>Show ${plural(total, 'viewing')} ${esc(dayPhrase())}</button></div>`;
}

function openFilters() {
  sheetKind = { kind: 'filters' };
  renderFilters();
  openSheet();
}

function renderFilters() {
  const f = state.filters;
  const total = feedFor().total;
  const types = [['apartment', 'Apartment'], ['house', 'House'], ['townhouse', 'Townhouse']];
  const rooms = [[0, 'Any'], [1, '1+'], [2, '2+'], [3, '3+'], [4, '4+']];
  const prices = [[0, 'Any'], [3e6, '3 Mkr'], [5e6, '5 Mkr'], [8e6, '8 Mkr'], [12e6, '12 Mkr']];
  $('#sheetBody').innerHTML = `<div class="sheet-bar"><h2>Filters</h2><button class="close" type="button" data-close aria-label="Close">${ICON.close}</button></div>
    <div class="sheet-section"><h3>Home</h3><div class="chips">${types.map(([v, t]) => `<button class="chip" type="button" data-type="${v}" aria-pressed="${f.types.includes(v)}">${t}</button>`).join('')}</div></div>
    <div class="sheet-section"><h3>Rooms</h3><div class="chips">${rooms.map(([v, t]) => `<button class="chip" type="button" data-rooms="${v}" aria-pressed="${f.minRooms === v}">${t}</button>`).join('')}</div></div>
    <div class="sheet-section"><h3>Highest price</h3><div class="chips">${prices.map(([v, t]) => `<button class="chip" type="button" data-maxprice="${v}" aria-pressed="${f.maxPrice === v}">${t}</button>`).join('')}</div></div>
    <div class="sheet-section"><label class="toggle" for="openOnly"><span>Open viewings only<br><span class="meta">Skip viewings you have to book first</span></span><input type="checkbox" id="openOnly" ${f.openOnly ? 'checked' : ''}></label></div>
    <div class="sheet-foot"><button class="btn" type="button" data-clear-filters>Clear</button><button class="btn primary block" type="button" data-close>Show ${plural(total, 'viewing')}</button></div>`;
}

function refreshSheet() {
  if (!sheet.open || !sheetKind) return;
  const keep = $('#sheetBody').scrollTop;
  if (sheetKind.kind === 'detail') renderDetail(sheetKind.id);
  else if (sheetKind.kind === 'place') renderPlace();
  else if (sheetKind.kind === 'filters') renderFilters();
  else if (sheetKind.kind === 'promote') renderPromote();
  $('#sheetBody').scrollTop = keep;
}

// ---------------------------------------------------------------- toast

let toastTimer;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

// ---------------------------------------------------------------- render + events

function render() {
  renderHeader();
  for (const t of TABS) $(`#view-${t}`).hidden = t !== state.tab;
  if (state.tab === 'viewings') renderViewings();
  else if (state.tab === 'map') renderMap();
  else if (state.tab === 'plan') renderPlan();
  else renderAgents();
}

function setDay(day) {
  state.day = day;
  state.showEnded = false;
  state.mapPick = null;
  delete $('#days').dataset.scrolled;
  render();
}

function useGPS() {
  if (!navigator.geolocation) {
    toast('Location is not available here. Pick a starting point instead.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (distanceKm(here, STOCKHOLM) > 40) {
        toast('You are outside Stockholm, where the demo listings are. Pick a starting point there.');
        return;
      }
      state.gps = here;
      state.spot = 'gps';
      save();
      render();
      refreshSheet();
    },
    () => toast('Location is not available here. Pick a starting point instead.'),
    { timeout: 8000, maximumAge: 60000 },
  );
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Number copied');
  } catch {
    const el = $('#phone');
    if (el) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    toast('Number selected. Copy it from the menu.');
  }
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('button, a, [data-pick]');
  if (!t) return;
  const d = t.dataset;

  if (d.add) {
    togglePlan(d.add, Number(d.start));
    render();
    refreshSheet();
  } else if (d.open) {
    openDetail(d.open);
  } else if (d.day && t.closest('#days, .empty, .other-days')) {
    setDay(d.day);
  } else if (d.pick) {
    state.mapPick = state.mapPick === d.pick ? null : d.pick;
    renderMap();
  } else if (d.close !== undefined) {
    closeSheet();
  } else if (d.mode) {
    state.place.mode = d.mode;
    save();
    render();
    renderPlace();
  } else if (d.spot) {
    state.spot = d.spot;
    save();
    render();
    renderPlace();
  } else if (d.radius) {
    state.place.radiusKm = Number(d.radius);
    state.place.mode = 'near';
    save();
    render();
    refreshSheet();
  } else if (d.area) {
    const set = new Set(state.place.areas);
    set.has(d.area) ? set.delete(d.area) : set.add(d.area);
    state.place.areas = AREAS.map((a) => a.id).filter((id) => set.has(id));
    save();
    render();
    renderPlace();
  } else if (d.gps !== undefined) {
    useGPS();
  } else if (d.type) {
    const set = new Set(state.filters.types);
    set.has(d.type) ? set.delete(d.type) : set.add(d.type);
    state.filters.types = [...set];
    save();
    render();
    renderFilters();
  } else if (d.rooms !== undefined) {
    state.filters.minRooms = Number(d.rooms);
    save();
    render();
    renderFilters();
  } else if (d.maxprice !== undefined) {
    state.filters.maxPrice = Number(d.maxprice);
    save();
    render();
    renderFilters();
  } else if (d.clearFilters !== undefined) {
    state.filters = { types: [], minRooms: 0, maxPrice: 0, openOnly: false };
    save();
    render();
    refreshSheet();
  } else if (d.showEnded !== undefined) {
    state.showEnded = true;
    renderViewings();
  } else if (d.copy) {
    copy(d.copy);
  } else if (d.promote) {
    sheetKind = { kind: 'promote' };
    openPromote(d.promote);
  } else if (d.pkg) {
    promo.packageId = d.pkg;
    renderPromote();
  } else if (d.startDay) {
    promo.startDay = d.startDay;
    renderPromote();
  } else if (d.pay !== undefined) {
    pay();
    toast('Promotion booked');
  } else if (d.seeFeed) {
    const l = byId.get(d.seeFeed);
    const first = promo.done ? l.viewings.find((v) => F.dateKey(new Date(v.start)) >= promo.done.from && v.end > Date.now()) : null;
    state.place = { ...state.place, mode: 'area', areas: [l.area] };
    state.filters = { types: [], minRooms: 0, maxPrice: 0, openOnly: false };
    save();
    closeSheet();
    location.hash = 'viewings';
    setDay(first ? F.dateKey(new Date(first.start)) : state.day);
  } else if (d.cancel) {
    state.booked = state.booked.filter((p) => p.id !== d.cancel);
    save();
    render();
    toast('Promotion cancelled. Nothing was charged.');
  }
});

document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[data-pick]')) {
    e.preventDefault();
    e.target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'datePick' && e.target.value) setDay(e.target.value);
  if (e.target.id === 'openOnly') {
    state.filters.openOnly = e.target.checked;
    save();
    render();
    renderFilters();
  }
});

$('#placeBtn').addEventListener('click', openPlace);
$('#filterBtn').addEventListener('click', openFilters);
$('#sortBtn').addEventListener('click', () => {
  state.sort = state.sort === 'time' ? 'distance' : 'time';
  save();
  renderViewings();
});

function route() {
  const name = location.hash.slice(1);
  state.tab = TABS.includes(name) ? name : 'viewings';
  render();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

// Statuses ("on now", "starts in 12 min") move with the clock.
setInterval(() => {
  if (state.tab === 'viewings' || state.tab === 'map' || state.tab === 'plan') render();
  refreshSheet();
}, 30000);

route();
