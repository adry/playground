// An approved agent's homes: how buyers found them over the last two weeks,
// and a boost button per home.
import { useEffect, useMemo, useState } from 'react';
import { addDays, dateKey, fromKey, hhmm, num, plural, priceShort, rok, shortDay } from '@core/format.ts';
import { PACKAGE_BY_ID } from '@core/packages.ts';
import { api } from '../api';
import type { AgencyHome, Boost, DayStat, Pricing } from '../api/types';
import { Sparkline, ViewsChart } from '../components/Charts';
import { HomeArt } from '../components/Facade';
import { BoostDialog } from './Boost';

const DAYS = 14;

export function Listings({ agency, notice }: { agency: string; notice: string | null }) {
  const today = dateKey(new Date());
  const from = addDays(today, -(DAYS - 1));
  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDays(from, i)), [from]);
  const [homes, setHomes] = useState<AgencyHome[] | null>(null);
  const [stats, setStats] = useState<DayStat[]>([]);
  const [boosts, setBoosts] = useState<Boost[]>([]);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [boosting, setBoosting] = useState<AgencyHome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    Promise.all([api.homes(), api.stats(from, today), api.boosts(), api.pricing()])
      .then(([h, s, b, p]) => {
        setHomes(h);
        setStats(s);
        setBoosts(b);
        setPricing(p);
      })
      .catch((e: Error) => setError(e.message));
  }, [from, today, reloads]);

  const byHome = useMemo(() => {
    const m = new Map<string, DayStat[]>();
    for (const s of stats) m.set(s.listingId, [...(m.get(s.listingId) ?? []), s]);
    return m;
  }, [stats]);
  const scoped = selected ? stats.filter((s) => s.listingId === selected) : stats;
  const sum = (k: keyof DayStat) => scoped.reduce((a, s) => a + (s[k] as number), 0);
  const series = days.map((day) => {
    const ds = scoped.filter((s) => s.day === day);
    const sponsored = ds.reduce((a, s) => a + s.sponsored, 0);
    return { day, sponsored, organic: ds.reduce((a, s) => a + s.impressions, 0) - sponsored };
  });
  const selectedHome = homes?.find((h) => h.id === selected);

  if (error) return <main className="wrap page"><p className="error">{error}</p></main>;
  if (!homes || !pricing) return <main className="wrap page"><p className="muted">Loading your homes…</p></main>;

  const tiles: [string, number, string][] = [
    ['Seen in a feed', sum('impressions'), 'buyers who scrolled past, one per phone a day'],
    ['As sponsored', sum('sponsored'), 'of those, while boosted'],
    ['Opened', sum('opens'), 'looked at the home'],
    ['Added to a day', sum('saves'), 'planned to go'],
    ['Directions', sum('directions'), 'asked for the way there'],
  ];

  return (
    <main className="wrap page">
      <div className="page-head">
        <div>
          <span className="label">{agency}</span>
          <h1>{selectedHome ? selectedHome.address : 'Your homes on Hemma'}</h1>
          <p className="muted">Last {DAYS} days, {shortDay(from)} to {shortDay(today)}{selectedHome ? '' : ` · ${plural(homes.length, 'home')} from your feed`}</p>
        </div>
        {selected && <button className="btn" onClick={() => setSelected(null)}>Show all homes</button>}
      </div>

      {notice && <p className="note">{notice}</p>}
      {(pricing.freeBoosts > 0 || pricing.discount) && (
        <div className="offer">
          <span className="tag">Launch offer</span>
          <span>
            {pricing.freeBoosts > 0 && <><b>{plural(pricing.freeBoosts, 'free boost')}</b> left for your agency. </>}
            {pricing.discount && <>After that, <b>{pricing.discount.percent}% off</b> every boost until {shortDay(pricing.discount.until)} {fromKey(pricing.discount.until).getFullYear()}.</>}
          </span>
        </div>
      )}

      <div className="tiles">
        {tiles.map(([label, value, sub]) => (
          <div className="tile" key={label}>
            <span className="label">{label}</span>
            <b>{num(value)}</b>
            <small>{sub}</small>
          </div>
        ))}
      </div>

      <section className="panel" aria-labelledby="views-h">
        <div className="panel-head">
          <h2 id="views-h">Views per day</h2>
          <div className="legend">
            <span><i style={{ background: 'var(--c-organic)' }} />In the feed</span>
            <span><i style={{ background: 'var(--c-sponsored)' }} />As sponsored</span>
          </div>
        </div>
        <ViewsChart data={series} />
      </section>

      <section className="panel" aria-labelledby="homes-h">
        <div className="panel-head">
          <h2 id="homes-h">Homes</h2>
          <span className="muted small">Select a home to see its numbers above</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Home</th>
                <th>Next viewing</th>
                <th className="n">Seen</th>
                <th>Trend</th>
                <th className="n">Opened</th>
                <th className="n">Added</th>
                <th>Boost</th>
              </tr>
            </thead>
            <tbody>
              {homes.map((h) => {
                const s = byHome.get(h.id) ?? [];
                const perDay = days.map((d) => s.filter((x) => x.day === d).reduce((a, x) => a + x.impressions, 0));
                const next = h.viewings.find((v) => v.end > Date.now());
                const boost = boosts.find((b) => b.listingId === h.id);
                return (
                  <tr key={h.id} aria-selected={selected === h.id} onClick={() => setSelected(selected === h.id ? null : h.id)}>
                    <td>
                      <div className="home">
                        <span className="thumb"><HomeArt home={h} /></span>
                        <div><strong>{h.address}</strong><span>{h.areaName} · {rok(h.rooms)} · {priceShort(h.price)}</span></div>
                      </div>
                    </td>
                    <td className="num">{next ? `${shortDay(dateKey(new Date(next.start)))}, ${hhmm(next.start)}` : <span className="muted">None booked</span>}</td>
                    <td className="n">{num(perDay.reduce((a, b) => a + b, 0))}</td>
                    <td><Sparkline values={perDay} label={`Views per day for ${h.address}`} /></td>
                    <td className="n">{num(s.reduce((a, x) => a + x.opens, 0))}</td>
                    <td className="n">{num(s.reduce((a, x) => a + x.saves, 0))}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {boost ? (
                        <span className={`pill ${boost.status === 'active' ? 'boosted' : 'pending'}`}>
                          <i />
                          {boost.status === 'active' ? `${PACKAGE_BY_ID[boost.packageId]?.name ?? 'Boost'} to ${shortDay(boost.to)}` : 'Awaiting payment'}
                        </span>
                      ) : (
                        <button className="btn primary" disabled={!next} onClick={() => setBoosting(h)} title={next ? undefined : 'Boosts need an upcoming viewing'}>
                          Boost
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {homes.length === 0 && <p className="muted">No homes from your agency's feed yet. Once your agency's system sends listings to Hemma they appear here within 15 minutes.</p>}
      </section>

      <p className="muted small">Prices are excl. VAT. Buyers are counted anonymously, one per phone per day; Hemma stores no buyer names.</p>

      {boosting && (
        <BoostDialog
          home={boosting}
          pricing={pricing}
          onClose={(changed) => {
            setBoosting(null);
            if (changed) setReloads((n) => n + 1);
          }}
        />
      )}
    </main>
  );
}
