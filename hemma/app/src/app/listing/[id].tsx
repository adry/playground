// One home: photos or facade, facts, every upcoming viewing, the agent.
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { activePromotion, statusOf } from '@core/feed.ts';
import { dateKey, dayLabel, distanceText, fromKey, kr, num, rok, timeRange } from '@core/format.ts';
import { distanceKm, walkMinutes } from '@core/geo.ts';
import { Button } from '../../components/bits';
import { HomeImage } from '../../components/HomeImage';
import { MiniMap } from '../../components/MiniMap';
import { Icon } from '../../components/Icon';
import { T } from '../../components/T';
import { useApp } from '../../state';
import { appleMapsUrl, googleMapsUrl, openDirections, otherAppUrl } from '../../directions';
import { useTheme } from '../../theme';
import { track } from '../../track';

export default function ListingScreen() {
  const t = useTheme();
  const app = useApp();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const l = app.data.listings.find((x) => x.id === id);
  const promo = l ? activePromotion(app.data.promotions, l.id, app.day) : null;
  const ref = l ? { listing: l, promotion: promo } : null;

  useEffect(() => {
    if (ref) track('open', ref, app.day);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!l || !ref) {
    return (
      <View style={{ flex: 1, padding: 24, gap: 12, justifyContent: 'center', backgroundColor: t.surface }}>
        <T v="title">This home is no longer listed</T>
        <Button label="Back" onPress={() => router.back()} />
      </View>
    );
  }

  const km = distanceKm(app.origin, l);
  const area = app.data.areas.find((a) => a.id === l.area)?.name;
  const dest = { lat: l.lat, lng: l.lng, label: l.address };
  const from = app.origin.gps ? null : app.origin;
  const go = (url: string) => {
    track('directions', ref, app.day);
    void Linking.openURL(url);
  };
  const facts: [string, string][] = [
    ['Rooms', rok(l.rooms)],
    ['Living area', `${l.size} m²`],
    [l.fee ? 'Fee' : 'Tenure', l.fee ? `${num(l.fee)} kr/mån` : l.tenure],
    [l.floor ? 'Floor' : 'Type', l.floor ? `${l.floor}${l.floors ? ` of ${l.floors}` : ''}` : l.type === 'house' ? 'Detached' : 'Terraced'],
    ['Built', l.built ? String(l.built) : '–'],
    ['Per m²', l.size ? `${num(Math.round(l.price / l.size / 100) * 100)} kr` : '–'],
  ];
  const upcoming = l.viewings.filter((v) => v.end > app.now - 3600e3);

  return (
    <View style={{ flex: 1, backgroundColor: t.surface }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 18 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <T v="small" color={t.muted}>{[l.tenure, area].filter(Boolean).join(' · ')}</T>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Close" hitSlop={10}
            style={{ width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: t.line, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="close" size={16} color={t.ink} />
          </Pressable>
        </View>
        <View>
          <HomeImage listing={l} style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 18 }} />
          {promo && (
            <View style={{ position: 'absolute', left: 12, top: 12, backgroundColor: t.ochreFill, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5 }}>
              <T v="label" color="#2A1C00" style={{ fontFamily: 'FamiljenGrotesk_700Bold' }}>Sponsored</T>
            </View>
          )}
        </View>
        <View style={{ gap: 2 }}>
          <T v="display">{l.address}</T>
          <T v="small" color={t.muted}>{[area, l.city].filter(Boolean).join(', ')} · {distanceText(km)} from {app.origin.label}, {walkMinutes(km)} min walk</T>
          <T v="title" style={{ marginTop: 6 }}>{kr(l.price)}</T>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, borderColor: t.line, borderRadius: 14, overflow: 'hidden' }}>
          {facts.map(([k, v], i) => (
            <View key={k} style={{ width: '33.333%', padding: 10, borderColor: t.line, borderRightWidth: i % 3 === 2 ? 0 : 1, borderBottomWidth: i < 3 ? 1 : 0 }}>
              <T v="label" color={t.muted} style={{ fontSize: 10 }}>{k}</T>
              <T v="bodyStrong">{v}</T>
            </View>
          ))}
        </View>

        {!!l.blurb && <T>{l.blurb}</T>}

        <View style={{ gap: 8 }}>
          <T v="label" color={t.muted} style={{ fontSize: 12 }}>Viewings</T>
          {upcoming.length === 0 && <T color={t.muted}>No upcoming viewings.</T>}
          {upcoming.map((v) => {
            const k = dateKey(new Date(v.start));
            const st = statusOf([v], app.now, k);
            const on = app.inPlan(l.id, v.start);
            const ended = st.key === 'ended';
            return (
              <View key={v.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderWidth: 1, borderColor: t.line, borderRadius: 14 }}>
                <View style={{ flex: 1 }}>
                  <T v="heading" style={{ fontSize: 16 }}>{dayLabel(k, app.today)} {fromKey(k).getDate()} · {timeRange(v)}</T>
                  <T v="small" color={t.muted}>{ended ? 'Ended' : v.booking ? 'Book a time with the agent first' : 'Open viewing, just turn up'}</T>
                </View>
                <Pressable
                  disabled={ended}
                  onPress={() => { if (app.togglePlan(l.id, v.start)) track('save', ref, k); }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: ended }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 36, borderRadius: 18, borderWidth: 1, borderColor: on ? t.falu : t.line, backgroundColor: on ? t.falu : t.surface, opacity: ended ? 0.4 : 1 }}
                >
                  <Icon name={on ? 'check' : 'plus'} size={16} color={on ? t.onFalu : t.ink} />
                  <T v="bodyStrong" color={on ? t.onFalu : t.ink} style={{ fontSize: 13 }}>{on ? 'In my day' : 'Add'}</T>
                </Pressable>
              </View>
            );
          })}
        </View>

        <View style={{ gap: 10 }}>
          <T v="label" color={t.muted} style={{ fontSize: 12 }}>Agent</T>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.ink, alignItems: 'center', justifyContent: 'center' }}>
              <T v="bodyStrong" color={t.paper} style={{ fontSize: 13 }}>{l.agent.split(' ').map((p) => p[0]).join('')}</T>
            </View>
            <View style={{ flex: 1 }}>
              <T v="bodyStrong">{l.agent}</T>
              <T v="small" color={t.muted}>{l.agency}</T>
            </View>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {l.phone && <Button icon="phone" label={l.phone} onPress={() => { track('call', ref, app.day); void Linking.openURL(`tel:${l.phone!.replace(/[^\d+]/g, '')}`); }} />}
            {l.url && <Button icon="link" label="Agency page" onPress={() => { track('agency_link', ref, app.day); void Linking.openURL(l.url!); }} />}
          </View>
        </View>

        <View style={{ gap: 10 }}>
          <T v="label" color={t.muted} style={{ fontSize: 12 }}>Getting there</T>
          <MiniMap at={l} label={l.address} onPress={() => { track('directions', ref, app.day); openDirections(dest, from); }} />
          <T v="small" color={t.muted}>{distanceText(km)} from {app.origin.label}, about {walkMinutes(km)} min on foot.</T>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {Platform.OS === 'android' ? (
              <>
                <Button primary icon="walk" label="Google Maps" style={{ flex: 1 }} onPress={() => go(googleMapsUrl(dest, from))} />
                <Button icon="pin" label="Other app" style={{ flex: 1 }} onPress={() => go(otherAppUrl(dest))} />
              </>
            ) : (
              <>
                <Button primary icon="walk" label="Apple Maps" style={{ flex: 1 }} onPress={() => go(appleMapsUrl(dest, from))} />
                <Button icon="walk" label="Google Maps" style={{ flex: 1 }} onPress={() => go(googleMapsUrl(dest, from))} />
              </>
            )}
          </View>
        </View>

        {promo && (
          <View style={{ backgroundColor: t.ochreSoft, borderRadius: 12, padding: 12 }}>
            <T v="small" color={t.muted}>
              <T v="small" style={{ fontFamily: 'HankenGrotesk_600SemiBold' }}>Sponsored by {l.agency}. </T>
              Sponsored viewings appear first, but only when they match the day, area and filters you picked.
            </T>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
