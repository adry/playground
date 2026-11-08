// Top of the buyer screens: wordmark, where they are looking, and the
// 14-day strip with how many homes are shown each day.
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dayLabel, fromKey, shortDay, weekdayShort } from '@core/format.ts';
import { useApp } from '../state';
import { useTheme } from '../theme';
import { Icon } from './Icon';
import { T } from './T';

export function placeLabel(app: ReturnType<typeof useApp>) {
  if (app.mode === 'near') return { kicker: `Within ${app.radiusKm} km of`, name: app.origin.label };
  const names = app.areas.map((id) => app.data.areas.find((a) => a.id === id)?.name ?? id);
  return { kicker: names.length === 1 ? 'Area' : names.length ? `${names.length} areas` : 'Area', name: names.join(', ') || 'Everywhere' };
}

export function Header({ showDays = true }: { showDays?: boolean }) {
  const t = useTheme();
  const app = useApp();
  const insets = useSafeAreaInsets();
  const p = placeLabel(app);
  const strip = useRef<ScrollViewInstance>(null);
  useEffect(() => {
    const i = app.days.indexOf(app.day);
    if (i > 3) strip.current?.scrollTo({ x: (i - 2) * 60, animated: false });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={{ paddingTop: insets.top + 10, paddingBottom: 10, backgroundColor: t.paper, borderBottomWidth: 1, borderBottomColor: t.line }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
            <T style={{ fontFamily: 'FamiljenGrotesk_700Bold', fontSize: 27, lineHeight: 30, letterSpacing: -0.9 }}>hemma</T>
            <View style={{ width: 7, height: 7, backgroundColor: t.falu, marginLeft: 2, marginBottom: 6, borderRadius: 1 }} />
          </View>
          {!app.live && (
            <View style={{ borderWidth: 1, borderColor: t.line, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
              <T v="label" color={t.muted} style={{ fontSize: 10 }}>Demo</T>
            </View>
          )}
        </View>
        <Pressable
          onPress={() => router.push('/place')}
          accessibilityRole="button"
          accessibilityLabel={`${p.kicker} ${p.name}. Change where you are looking`}
          style={({ pressed }) => ({
            flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line,
            borderRadius: 14, paddingVertical: 6, paddingLeft: 9, paddingRight: 10, opacity: pressed ? 0.8 : 1,
          })}
        >
          <Icon name="pin" size={18} color={t.falu} />
          <View style={{ flexShrink: 1 }}>
            <T v="label" color={t.muted} numberOfLines={1} style={{ fontSize: 10, letterSpacing: 0.6 }}>{p.kicker}</T>
            <T v="bodyStrong" numberOfLines={1} style={{ fontSize: 14, lineHeight: 18 }}>{p.name}</T>
          </View>
          <Icon name="chevron" size={14} color={t.muted} />
        </Pressable>
      </View>
      {showDays && (
        <ScrollView ref={strip} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 16, paddingTop: 12 }}>
          {app.days.map((d) => {
            const on = d === app.day;
            const wd = fromKey(d).getDay();
            const weekend = wd === 0 || wd === 6;
            const n = app.counts[d] ?? 0;
            return (
              <Pressable
                key={d}
                onPress={() => app.setDay(d)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${dayLabel(d, app.today)} ${shortDay(d)}, ${n} viewings`}
                style={{
                  width: 54, alignItems: 'center', paddingTop: 7, paddingBottom: 6, borderRadius: 14, borderWidth: 1,
                  borderColor: on ? t.ink : t.line, backgroundColor: on ? t.ink : t.surface,
                }}
              >
                <T v="label" color={on ? t.paper : weekend ? t.falu : t.muted} style={{ fontSize: 10, letterSpacing: 0.5 }}>{d === app.today ? 'Today' : weekdayShort(d)}</T>
                <T v="title" color={on ? t.paper : n ? t.ink : t.muted} style={{ fontSize: 20, lineHeight: 24 }}>{fromKey(d).getDate()}</T>
                <T v="small" color={on ? t.paper : t.muted} style={{ fontSize: 11, lineHeight: 13, opacity: on ? 0.8 : 1 }}>{n || '–'}</T>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
