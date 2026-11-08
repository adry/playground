// Booking a boost: package, start day (with spots left in the area), what it
// covers, how buyers will see it, and payment.
import { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, dateKey, distanceText, kr, num, plural, rok, shortDay, timeRange } from '@core/format.ts';
import { SPOTS_PER_AREA_DAY, priceToday } from '@core/packages.ts';
import { api } from '../api';
import type { AgencyHome, Pricing } from '../api/types';
import { HomeArt } from '../components/Facade';

export function BoostDialog({ home, pricing, onClose }: { home: AgencyHome; pricing: Pricing; onClose: (changed: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const today = dateKey(new Date());
  const viewingDays = useMemo(() => [...new Set(home.viewings.filter((v) => v.end > Date.now()).map((v) => dateKey(new Date(v.start))))].sort(), [home]);
  const [pkgId, setPkgId] = useState(pricing.packages.find((p) => p.id === 'weekend')?.id ?? pricing.packages[0].id);
  const [start, setStart] = useState(viewingDays[0]);
  const [spots, setSpots] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { free?: boolean; simulated?: boolean }>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);
  useEffect(() => {
    if (viewingDays.length) api.spotsLeft(home.id, viewingDays[0], viewingDays[viewingDays.length - 1]).then(setSpots).catch(() => setSpots({}));
  }, [home.id, viewingDays]);

  const pkg = pricing.packages.find((p) => p.id === pkgId)!;
  const end = addDays(start, pkg.days - 1);
  const covered = home.viewings.filter((v) => v.end > Date.now() && dateKey(new Date(v.start)) >= start && dateKey(new Date(v.start)) <= end);
  const coveredDays = [...new Set(covered.map((v) => dateKey(new Date(v.start))))];
  const left = coveredDays.length ? Math.min(...coveredDays.map((d) => spots[d] ?? SPOTS_PER_AREA_DAY)) : 0;
  const free = pricing.freeBoosts > 0;
  const price = pricing.discount ? priceToday(pkg.price, today) : pkg.price;

  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.book(home.id, pkg.id, start);
      if (r.url) location.assign(r.url); // Stripe Checkout; back to the dashboard afterwards
      else setDone(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    ref.current?.close();
    onClose(!!done);
  };

  return (
    <dialog className="sheet" ref={ref} onClose={() => onClose(!!done)} onClick={(e) => e.target === ref.current && close()} aria-labelledby="boost-h">
      <div className="sheet-body">
        <div className="sheet-head">
          <div>
            <span className="label">{home.areaName}</span>
            <h2 id="boost-h">{done ? 'Your viewing is boosted' : `Boost ${home.address}`}</h2>
          </div>
          <button className="close" onClick={close} aria-label="Close">✕</button>
        </div>

        {done ? (
          <div className="done">
            <span className="tick" aria-hidden="true">✓</span>
            <p>
              {pkg.name}, {shortDay(start)}{end !== start ? ` to ${shortDay(end)}` : ''}. Buyers looking at {home.areaName} on {coveredDays.length > 1 ? 'those days' : 'that day'} now see it first.
              {done.free ? ' This one was free: part of the launch offer.' : done.simulated ? ' Payment is simulated in demo mode.' : ''}
            </p>
            <button className="btn primary" onClick={close}>Done</button>
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gap: 8 }}>
              <span className="label">Package</span>
              <div className="pkgs">
                {pricing.packages.map((p) => {
                  const now = pricing.discount ? priceToday(p.price, today) : p.price;
                  return (
                    <button key={p.id} className="pkg" aria-pressed={p.id === pkgId} onClick={() => setPkgId(p.id)}>
                      <strong>{p.name} · {plural(p.days, 'day')}</strong>
                      <span className="price">{now !== p.price && <s>{kr(p.price)}</s>}{kr(now)}</span>
                      <span className="d">{p.blurb}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              <span className="label">Starting</span>
              <div className="chips">
                {viewingDays.map((d) => {
                  const l = spots[d] ?? SPOTS_PER_AREA_DAY;
                  return (
                    <button key={d} className="chip" aria-pressed={d === start} disabled={l === 0} onClick={() => setStart(d)}>
                      {shortDay(d)} <small>{l ? `${l} left` : 'Sold out'}</small>
                    </button>
                  );
                })}
              </div>
              <p className="small">
                <span className="spots" aria-hidden="true">{Array.from({ length: SPOTS_PER_AREA_DAY }, (_, i) => <i key={i} className={i < SPOTS_PER_AREA_DAY - left ? '' : 'free'} />)}</span>
                {left} of {SPOTS_PER_AREA_DAY} sponsored spots left in {home.areaName}{coveredDays.length > 1 ? ' on the busiest day covered' : ''}
              </p>
            </div>

            <div style={{ display: 'grid', gap: 6 }}>
              <span className="label">Covers</span>
              <p className="small">{shortDay(start)}{end !== start ? ` to ${shortDay(end)}` : ''}, with {plural(covered.length, 'viewing')}: {covered.map((v) => `${shortDay(dateKey(new Date(v.start)))} ${timeRange(v)}`).join(', ')}</p>
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              <span className="label">How buyers see it</span>
              <div className="preview">
                <div className="art"><HomeArt home={home} /><span className="sign">Sponsored</span></div>
                <div className="body">
                  <span className="small num">{covered[0] ? timeRange(covered[0]) : ''}</span>
                  <b>{home.address}</b>
                  <span className="small muted">{home.areaName} · {distanceText(0.8)} away for a buyer nearby</span>
                  <span className="small">{rok(home.rooms)} · {home.size} m²{home.fee ? ` · ${num(home.fee)} kr/mån` : ''} · {kr(home.price)}</span>
                </div>
              </div>
            </div>

            {error && <p className="error">{error}</p>}
            <div className="total">
              <span className="muted">{free ? 'Launch offer' : 'Total, excl. VAT'}</span>
              <strong>{free ? 'Free' : kr(price)}</strong>
            </div>
            <button className="btn primary big" disabled={busy || left === 0 || !covered.length} onClick={pay}>
              {left === 0 ? 'Sold out for these days' : free ? 'Boost for free' : `Pay ${kr(price)} by card`}
            </button>
            <p className="muted small">{free ? `${plural(pricing.freeBoosts - 1, 'free boost')} left after this one.` : 'You pay through Stripe and get a VAT receipt by email.'} Sponsored viewings show only to buyers whose search already includes this home, and drop back into the normal feed once the viewing ends.</p>
          </>
        )}
      </div>
    </dialog>
  );
}
