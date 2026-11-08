// My day: planned viewings in time order with the walk between them.
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { planDay, statusOf } from '@core/feed.ts';
import { dateKey, distanceText, fromKey, hhmm, longDay, plural, priceShort, shortDay } from '@core/format.ts';
import { Button } from '../../components/bits';
import { Status } from '../../components/bits';
import { Header } from '../../components/Header';
import { HomeImage } from '../../components/HomeImage';
import { Icon } from '../../components/Icon';
import { T } from '../../components/T';
import { useApp } from '../../state';
import { useTheme } from '../../theme';

export default function Plan() {
  const t = useTheme();
  const app = useApp();
  const entries = app.plan.filter((e) => dateKey(new Date(e.start)) === app.day);
  const plan = planDay({ entries, listings: app.data.listings, origin: app.origin });
  const otherDays = [...new Set(app.plan.map((e) => dateKey(new Date(e.start))))].filter((d) => d !== app.day && d >= app.today).sort();

  const route = () => {
    const stops = plan.stops.map((s) => `${s.listing.address}, ${s.listing.city || 'Stockholm'}`);
    const params = new URLSearchParams({ api: '1', origin: `${app.origin.lat},${app.origin.lng}`, destination: stops[stops.length - 1], travelmode: 'walking' });
    if (stops.length > 1) params.set('waypoints', stops.slice(0, -1).join('|'));
    void Linking.openURL(`https://www.google.com/maps/dir/?${params}`);
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.paper }}>
      <Header />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <T v="display">{longDay(app.day, app.today)}</T>
        <T color={t.muted} style={{ marginTop: 2 }}>
          {plan.stops.length ? `${plural(plan.stops.length, 'viewing')} · ${plan.walkTotal} min walking from ${app.origin.label}` : 'Your viewing route'}
        </T>

        {plan.stops.length === 0 ? (
          <View style={{ marginTop: 18, padding: 20, borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: t.line, backgroundColor: t.surface, gap: 10, alignItems: 'flex-start' }}>
            <T v="title" style={{ fontSize: 19 }}>Nothing planned yet</T>
            <T color={t.muted}>Tap + on any viewing and it lands here in time order, with the walk between each one.</T>
            <Button primary label="Browse viewings" onPress={() => router.navigate('/')} />
          </View>
        ) : (
          <View style={{ marginTop: 16 }}>
            <View style={{ position: 'absolute', left: 21, top: 14, bottom: 30, width: 2, backgroundColor: t.line }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 44, alignItems: 'center' }}><View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: t.falu, borderWidth: 3, borderColor: t.paper }} /></View>
              <T><T v="bodyStrong">Start</T> · {app.origin.label}</T>
            </View>
            {plan.stops.map((s, i) => {
              const st = statusOf([s.slot], app.now, app.day);
              const item = { listing: s.listing, slot: s.slot, slots: [s.slot], status: st.key, startsIn: st.startsIn, endsIn: st.endsIn, distanceKm: null, walkMin: null, promotion: null };
              return (
                <View key={`${s.listing.id}-${s.slot.start}`}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
                    <View style={{ width: 44 }} />
                    <Icon name="walk" size={14} color={t.muted} />
                    <T v="small" color={t.muted}>{s.walkMin} min walk · {distanceText(s.walkKm)}</T>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ width: 44, paddingTop: 10, backgroundColor: t.paper }}>
                      <T v="time">{hhmm(s.slot.start)}</T>
                      <T v="small" color={t.muted} style={{ fontSize: 12 }}>{hhmm(s.slot.end)}</T>
                    </View>
                    <Pressable
                      onPress={() => router.push({ pathname: '/listing/[id]', params: { id: s.listing.id } })}
                      style={{ flex: 1, flexDirection: 'row', gap: 10, alignItems: 'center', padding: 8, borderRadius: 16, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface }}
                    >
                      <HomeImage listing={s.listing} style={{ width: 58, height: 58, borderRadius: 10 }} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <T v="bodyStrong" numberOfLines={1} style={{ fontFamily: 'FamiljenGrotesk_600SemiBold', fontSize: 16 }}>{s.listing.address}</T>
                        <T v="small" color={t.muted}>{priceShort(s.listing.price)}{i < plan.stops.length - 1 ? ` · leave by ${hhmm(s.leave)}` : ''}</T>
                        <Status item={item} />
                        {s.warning && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.warnSoft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start', marginTop: 2 }}>
                            <Icon name="warn" size={13} color={t.warn} />
                            <T v="small" color={t.warn} style={{ fontSize: 12, fontFamily: 'HankenGrotesk_600SemiBold' }}>
                              {s.warning.kind === 'miss' ? `You'd arrive with ${s.warning.minutes} min left` : `About ${s.warning.minutes} min late`}
                            </T>
                          </View>
                        )}
                      </View>
                      <Pressable onPress={() => app.togglePlan(s.listing.id, s.slot.start)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${s.listing.address} from your day`} style={{ padding: 6 }}>
                        <Icon name="trash" size={18} color={t.muted} />
                      </Pressable>
                    </Pressable>
                  </View>
                </View>
              );
            })}
            <Button primary icon="walk" label="Walking route in Google Maps" onPress={route} style={{ marginTop: 20 }} />
          </View>
        )}

        {otherDays.length > 0 && (
          <View style={{ marginTop: 24, gap: 8 }}>
            <T v="label" color={t.muted}>Also planned</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {otherDays.map((d) => (
                <Button key={d} label={`${shortDay(d)} · ${app.plan.filter((e) => dateKey(new Date(e.start)) === d).length}`} onPress={() => app.setDay(d)} />
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
