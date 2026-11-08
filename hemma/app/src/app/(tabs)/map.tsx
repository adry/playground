// A real map of the day's viewings around the buyer. Tap a pin for the home
// and directions in Apple Maps or Google Maps.
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { dayPhrase, plural } from '@core/format.ts';
import { Row } from '../../components/Cards';
import { Button } from '../../components/bits';
import { Header } from '../../components/Header';
import { T } from '../../components/T';
import { ViewingsMap } from '../../components/ViewingsMap';
import { openDirections } from '../../directions';
import { useApp } from '../../state';
import { useTheme } from '../../theme';
import { track } from '../../track';

export default function MapScreen() {
  const t = useTheme();
  const app = useApp();
  const [picked, setPicked] = useState<string | null>(null);
  const items = useMemo(() => [...app.feed.organic, ...app.feed.sponsored], [app.feed]);
  // A week boost also highlights the home's pin.
  const featured = useMemo(() => new Set(app.feed.sponsored.filter((i) => (i.promotion?.tier ?? 0) >= 3).map((i) => i.listing.id)), [app.feed]);
  const chosen = useMemo(() => app.data.areas.filter((a) => app.areas.includes(a.id)), [app.data.areas, app.areas]);
  const pick = items.find((i) => i.listing.id === picked);
  const card = { backgroundColor: t.surface, borderRadius: 14, shadowColor: '#000', shadowOpacity: t.dark ? 0.4 : 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 4 } as const;
  const legend: [string, string][] = [['On now', t.patina], ['Within the hour', t.falu], ['Later', t.ink], ['Ended', t.muted]];

  return (
    <View style={{ flex: 1, backgroundColor: t.paper }}>
      <Header />
      <View style={{ flex: 1 }}>
        <ViewingsMap
          items={items}
          featured={featured}
          origin={app.origin}
          mode={app.mode}
          radiusKm={app.radiusKm}
          areas={chosen}
          allAreas={app.data.areas}
          picked={picked}
          onPick={setPicked}
          bottomInset={pick ? 190 : 70}
        />

        <View pointerEvents="box-none" style={{ position: 'absolute', top: 10, left: 12, right: 12 }}>
          <View style={[card, { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7 }]}>
            <T v="bodyStrong" style={{ fontSize: 14 }}>{plural(items.length, 'viewing')} {dayPhrase(app.day, app.today)}</T>
            {app.feed.live > 0 && <T v="bodyStrong" color={t.patina} style={{ fontSize: 14 }}>{`  ·  ${app.feed.live} on now`}</T>}
          </View>
        </View>

        <View pointerEvents="box-none" style={{ position: 'absolute', left: 12, right: 12, bottom: 12 }}>
          {pick ? (
            <View style={[card, { borderRadius: 18, padding: 10, gap: 10, backgroundColor: t.paper }]}>
              <Row item={pick} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button
                  primary
                  icon="walk"
                  label="Directions"
                  style={{ flex: 1 }}
                  onPress={() => {
                    track('directions', pick, app.day);
                    openDirections({ lat: pick.listing.lat, lng: pick.listing.lng, label: pick.listing.address }, app.origin.gps ? null : app.origin);
                  }}
                />
                <Button label="Details" onPress={() => router.push({ pathname: '/listing/[id]', params: { id: pick.listing.id } })} />
              </View>
            </View>
          ) : (
            <View style={[card, { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4, paddingHorizontal: 12, paddingVertical: 8 }]}>
              {legend.map(([label, color]) => (
                <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: color }} />
                  <T v="small" color={t.muted} style={{ fontSize: 12 }}>{label}</T>
                </View>
              ))}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <View style={{ width: 9, height: 9, borderRadius: 3, borderWidth: 2, borderColor: t.ochreFill }} />
                <T v="small" color={t.muted} style={{ fontSize: 12 }}>Sponsored</T>
              </View>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
