import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { dayPhrase, plural } from '@core/format.ts';
import { Row } from '../../components/Cards';
import { Header, placeLabel } from '../../components/Header';
import { Radar, radarFrame } from '../../components/Radar';
import { T } from '../../components/T';
import { useApp } from '../../state';
import { useTheme } from '../../theme';

export default function MapScreen() {
  const t = useTheme();
  const app = useApp();
  const [picked, setPicked] = useState<string | null>(null);
  const items = useMemo(() => [...app.feed.organic, ...app.feed.sponsored], [app.feed]);
  // A week boost also highlights the home's pin.
  const featured = useMemo(() => new Set(app.feed.sponsored.filter((i) => (i.promotion?.tier ?? 0) >= 3).map((i) => i.listing.id)), [app.feed]);
  const chosen = app.areas.length ? app.data.areas.filter((a) => app.areas.includes(a.id)) : app.data.areas;
  const frame = radarFrame(app.mode, app.origin, app.radiusKm, chosen.length ? chosen : app.data.areas, items);
  const pick = items.find((i) => i.listing.id === picked);
  const legend: [string, string, number?][] = [['On now', t.patina], ['Within the hour', t.falu], ['Later', t.ink], ['Ended', t.muted, 0.5], ['Featured', t.ochreFill]];

  return (
    <View style={{ flex: 1, backgroundColor: t.paper }}>
      <Header />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}>
        <View>
          <T v="title">{plural(items.length, 'viewing')} {dayPhrase(app.day, app.today)}</T>
          <T color={t.muted}>
            around {app.mode === 'near' ? app.origin.label : placeLabel(app).name}
            {app.feed.live > 0 && <T v="bodyStrong" color={t.patina}>{`  ·  ${app.feed.live} on now`}</T>}
          </T>
        </View>
        <Radar
          center={frame.center}
          radiusKm={frame.R}
          you={app.origin}
          items={items}
          featured={featured}
          areas={app.data.areas}
          picked={picked}
          onPick={(id) => setPicked((p) => (p === id ? null : id))}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 6 }}>
          {legend.map(([label, color, opacity]) => (
            <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color, opacity: opacity ?? 1 }} />
              <T v="small" color={t.muted} style={{ fontSize: 12 }}>{label}</T>
            </View>
          ))}
        </View>
        {pick ? <Row item={pick} /> : <T color={t.muted} style={{ fontSize: 14 }}>Tap a dot to see the viewing. Rings show walking time from {app.mode === 'near' ? 'you' : 'the middle of the area'}.</T>}
      </ScrollView>
    </View>
  );
}
