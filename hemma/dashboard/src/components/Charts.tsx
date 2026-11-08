// Daily views as stacked bars (seen in the feed / seen as sponsored), and a
// sparkline for each home's row. Colours are validated for both themes.
import { useState } from 'react';
import { fromKey } from '@core/format.ts';

export interface DayViews {
  day: string;
  organic: number;
  sponsored: number;
}

const W = 720;
const H = 220;
const PAD = { top: 12, right: 8, bottom: 26, left: 36 };

// A bar with only its data end rounded; the baseline stays square.
function bar(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h, w / 2);
  return `M${x} ${y + h}V${y + rr}Q${x} ${y} ${x + rr} ${y}H${x + w - rr}Q${x + w} ${y} ${x + w} ${y + rr}V${y + h}Z`;
}

// The smallest round number at or above the tallest bar, so bars use the height.
function niceMax(v: number) {
  if (v <= 0) return 10;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((m) => m * p >= v) ?? 10) * p;
}

export function ViewsChart({ data }: { data: DayViews[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(...data.map((d) => d.organic + d.sponsored), 1));
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const step = iw / data.length;
  const bw = Math.min(28, step * 0.62);
  const y = (v: number) => PAD.top + ih - (v / max) * ih;
  const ticks = [0, max / 2, max];
  const h = hover == null ? null : data[hover];

  return (
    <div className="chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Views per day in the last two weeks; the table below lists the numbers per home">
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="axis" x={PAD.left - 8} y={y(t) + 4} textAnchor="end">{t}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = PAD.left + i * step + (step - bw) / 2;
          const total = d.organic + d.sponsored;
          const gap = d.organic && d.sponsored ? 2 : 0;
          const date = fromKey(d.day);
          return (
            <g key={d.day} className={hover === i ? 'hover' : undefined} onMouseEnter={() => setHover(i)}>
              <rect className="bar-hit" x={PAD.left + i * step} y={PAD.top} width={step} height={ih} />
              <g>
                {d.organic > 0 && (
                  d.sponsored
                    ? <rect x={x} y={y(d.organic)} width={bw} height={Math.max(0, y(0) - y(d.organic))} fill="var(--c-organic)" />
                    : <path d={bar(x, y(d.organic), bw, Math.max(0, y(0) - y(d.organic)), 4)} fill="var(--c-organic)" />
                )}
                {d.sponsored > 0 && (
                  <path d={bar(x, y(total), bw, Math.max(0, y(d.organic) - y(total) - gap), 4)} fill="var(--c-sponsored)" />
                )}
              </g>
              {(i % 2 === 0 || data.length <= 8) && (
                <text className="axis" x={x + bw / 2} y={H - 8} textAnchor="middle">{date.getDate()}/{date.getMonth() + 1}</text>
              )}
            </g>
          );
        })}
      </svg>
      {h && hover != null && (
        <div className="tip" style={{ left: `${((PAD.left + hover * step + step / 2) / W) * 100}%`, top: `${(y(h.organic + h.sponsored) / H) * 100}%` }}>
          <b>{fromKey(h.day).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</b>
          <div><i style={{ background: 'var(--c-organic)' }} />{h.organic} in the feed</div>
          <div><i style={{ background: 'var(--c-sponsored)' }} />{h.sponsored} as sponsored</div>
        </div>
      )}
    </div>
  );
}

export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const w = 84;
  const h = 24;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => [2 + (i * (w - 4)) / Math.max(1, values.length - 1), h - 3 - (v / max) * (h - 6)] as const);
  const d = pts.map(([x, yy], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${yy.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
      <path d={d} />
      {last && <circle cx={last[0]} cy={last[1]} r={2.5} />}
    </svg>
  );
}
