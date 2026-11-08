// Where the buyer is looking: around a point (GPS or a picked spot) within a
// distance, or in chosen areas.
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { DEMO_SPOTS } from '@core/areas.ts';
import { buildFeed } from '@core/feed.ts';
import { dayPhrase, plural } from '@core/format.ts';
import { walkMinutes } from '@core/geo.ts';
import { Button, Chip } from '../components/bits';
import { T } from '../components/T';
import { useApp } from '../state';
import { useTheme } from '../theme';

export default function PlaceSheet() {
  const t = useTheme();
  const app = useApp();
  const [note, setNote] = useState<string | null>(null);
  const countIn = (areaId: string) =>
    buildFeed({ listings: app.data.listings, promotions: [], day: app.day, now: app.now, place: { mode: 'area', areas: [areaId] }, filters: app.filters, origin: null }).total;
  const toggleArea = (id: string) => app.set({ mode: 'area', areas: app.areas.includes(id) ? app.areas.filter((a) => a !== id) : [...app.areas, id] });

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 22, paddingBottom: 40, gap: 18 }} style={{ backgroundColor: t.surface }}>
      <T v="title">Where are you looking?</T>
      <View style={{ flexDirection: 'row', backgroundColor: t.sunken, borderRadius: 12, padding: 3, gap: 3 }}>
        {(['near', 'area'] as const).map((m) => (
          <Pressable key={m} onPress={() => app.set({ mode: m })} accessibilityRole="button" accessibilityState={{ selected: app.mode === m }}
            style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 9, backgroundColor: app.mode === m ? t.surface : 'transparent' }}>
            <T v="bodyStrong" color={app.mode === m ? t.ink : t.muted} style={{ fontSize: 14 }}>{m === 'near' ? 'Around me' : 'Pick areas'}</T>
          </Pressable>
        ))}
      </View>

      {app.mode === 'near' ? (
        <>
          <View style={{ gap: 10 }}>
            <T v="label" color={t.muted} style={{ fontSize: 12 }}>Start from</T>
            <Button icon="locate" label={app.locating ? 'Finding you…' : 'Use my location'} disabled={app.locating}
              onPress={async () => setNote(await app.locateMe())} style={{ alignSelf: 'flex-start' }} />
            {note && <T v="small" color={t.warn}>{note}</T>}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {app.origin.gps && <Chip label="Your location" on onPress={() => {}} />}
              {DEMO_SPOTS.map((s) => <Chip key={s.id} label={s.label} on={app.spot === s.id} onPress={() => app.set({ spot: s.id })} />)}
            </View>
          </View>
          <View style={{ gap: 10 }}>
            <T v="label" color={t.muted} style={{ fontSize: 12 }}>Distance</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {[1, 2, 3, 5, 10].map((km) => <Chip key={km} label={`${km} km`} sub={`${walkMinutes(km)} min walk`} on={app.radiusKm === km} onPress={() => app.set({ radiusKm: km })} />)}
            </View>
          </View>
        </>
      ) : (
        <View style={{ gap: 10 }}>
          <T v="label" color={t.muted} style={{ fontSize: 12 }}>Areas · {dayPhrase(app.day, app.today)}</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {app.data.areas.map((a) => <Chip key={a.id} label={a.name} sub={String(countIn(a.id))} on={app.areas.includes(a.id)} onPress={() => toggleArea(a.id)} />)}
          </View>
        </View>
      )}
      <Button primary label={`Show ${plural(app.feed.total, 'viewing')} ${dayPhrase(app.day, app.today)}`} onPress={() => router.back()} />
    </ScrollView>
  );
}
