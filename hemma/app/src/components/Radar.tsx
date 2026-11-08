// Viewings placed at their true distance and bearing from the centre, with
// rings in walking minutes. No map tiles, so it works offline and needs no
// map API key; swap in react-native-maps later if a street map is wanted.
import { useWindowDimensions, View } from 'react-native';
import Svg, { Circle, G, Line, Text as SvgText } from 'react-native-svg';
import { distanceKm, toLocalKm, walkMinutes } from '@core/geo.ts';
import { hhmm } from '@core/format.ts';
import type { Area, FeedItem, LatLng } from '@core/types.ts';
import { useTheme } from '../theme';

interface Props {
  center: LatLng;
  radiusKm: number;
  you: LatLng | null;
  items: FeedItem[];
  featured: Set<string>;
  areas: Area[];
  picked: string | null;
  onPick: (id: string) => void;
}

export function Radar({ center, radiusKm: R, you, items, featured, areas, picked, onPick }: Props) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const size = Math.min(width - 32, 560);
  const pad = R * 1.1;
  const fs = R * 0.058;
  const pr = R * 0.04;
  const color = (s: FeedItem['status']) => (s === 'live' ? t.patina : s === 'soon' ? t.falu : s === 'ended' ? t.muted : t.ink);
  const order = { ended: 0, scheduled: 1, later: 1, soon: 2, live: 3 } as const;
  const sorted = [...items].sort((a, b) => order[a.status] - order[b.status]);
  const yp = you ? toLocalKm(center, you) : null;

  return (
    <View style={{ width: size, height: size, alignSelf: 'center', borderRadius: 22, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, overflow: 'hidden' }}>
      <Svg width={size} height={size} viewBox={`${-pad} ${-pad} ${pad * 2} ${pad * 2}`}>
        <Circle r={R} fill={t.sunken} opacity={0.5} />
        <Line x1={-R} y1={0} x2={R} y2={0} stroke={t.line} strokeWidth={R * 0.004} />
        <Line x1={0} y1={-R} x2={0} y2={R} stroke={t.line} strokeWidth={R * 0.004} />
        {[1 / 3, 2 / 3, 1].map((k) => {
          const r = R * k;
          const km = Math.round(r * 10) / 10;
          return (
            <G key={k}>
              <Circle r={r} fill="none" stroke={t.line} strokeWidth={R * 0.006} />
              <SvgText x={0} y={r - R * 0.02} fontSize={fs * 0.9} fill={t.muted} textAnchor="middle" fontFamily="HankenGrotesk_500Medium">{`${String(km).replace('.', ',')} km · ${walkMinutes(km)} min`}</SvgText>
            </G>
          );
        })}
        <SvgText x={0} y={-R - R * 0.03} fontSize={fs} fill={t.muted} textAnchor="middle" fontFamily="FamiljenGrotesk_700Bold">N</SvgText>
        {areas.map((a) => {
          const p = toLocalKm(center, a);
          if (Math.hypot(p.x, p.y) > R * 0.98) return null;
          const anchor = p.x < -R * 0.55 ? 'start' : p.x > R * 0.55 ? 'end' : 'middle';
          return (
            <SvgText key={a.id} x={p.x} y={-p.y - fs * 0.6} fontSize={fs} fill={t.muted} opacity={0.8} textAnchor={anchor} fontFamily="FamiljenGrotesk_600SemiBold" letterSpacing={fs * 0.08}>
              {a.name.toUpperCase()}
            </SvgText>
          );
        })}
        {yp && Math.hypot(yp.x, yp.y) <= R * 1.05 && (
          <G>
            <Circle cx={yp.x} cy={-yp.y} r={R * 0.06} fill={t.falu} opacity={0.14} />
            <Circle cx={yp.x} cy={-yp.y} r={R * 0.022} fill={t.falu} stroke={t.surface} strokeWidth={R * 0.008} />
          </G>
        )}
        {sorted.map((item) => {
          const p = toLocalKm(center, item.listing);
          const on = picked === item.listing.id;
          const feat = featured.has(item.listing.id);
          const r = on ? pr * 1.45 : pr;
          return (
            <G key={item.listing.id} onPress={() => onPick(item.listing.id)}>
              {feat && <Circle cx={p.x} cy={-p.y} r={r * 1.7} fill={t.ochreFill} />}
              <Circle cx={p.x} cy={-p.y} r={r} fill={color(item.status)} opacity={item.status === 'ended' ? 0.45 : 1} stroke={on ? t.ink : t.surface} strokeWidth={R * 0.008} />
              {(on || feat) && (
                <SvgText x={p.x + r * 1.9} y={-p.y + fs * 0.35} fontSize={fs} fill={t.ink} fontFamily="FamiljenGrotesk_600SemiBold">
                  {hhmm(item.slot.start)}
                </SvgText>
              )}
              <Circle cx={p.x} cy={-p.y} r={pr * 2.4} fill="transparent" />
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

export function radarFrame(mode: 'near' | 'area', origin: LatLng, radiusKm: number, chosen: Area[], items: FeedItem[]) {
  if (mode === 'near') return { center: origin, R: radiusKm };
  const center = { lat: chosen.reduce((s, a) => s + a.lat, 0) / chosen.length, lng: chosen.reduce((s, a) => s + a.lng, 0) / chosen.length };
  const far = Math.max(1.2, ...items.map((i) => distanceKm(center, i.listing) * 1.12));
  return { center, R: Math.ceil(far * 2) / 2 };
}
