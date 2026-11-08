// A viewing in the feed: the full-width sponsored card, and the row.
import { router } from 'expo-router';
import { memo } from 'react';
import { Pressable, View } from 'react-native';
import { distanceText, hhmm, kr, num, priceShort, rok, timeRange } from '@core/format.ts';
import type { FeedItem } from '@core/types.ts';
import { useApp } from '../state';
import { useTheme } from '../theme';
import { AddButton, Status } from './bits';
import { HomeImage } from './HomeImage';
import { T } from './T';

const open = (id: string) => router.push({ pathname: '/listing/[id]', params: { id } });

function areaName(id: string, areas: { id: string; name: string }[]) {
  return areas.find((a) => a.id === id)?.name ?? '';
}

export const SponsoredCard = memo(function SponsoredCard({ item, preview }: { item: FeedItem; preview?: boolean }) {
  const t = useTheme();
  const { data } = useApp();
  const l = item.listing;
  const where = [areaName(l.area, data.areas), item.distanceKm != null ? `${distanceText(item.distanceKm)}, ${item.walkMin} min walk` : ''].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={preview ? undefined : () => open(l.id)}
      accessibilityRole="button"
      accessibilityLabel={`Sponsored viewing. ${l.address}, ${timeRange(item.slot)}`}
      style={({ pressed }) => ({
        backgroundColor: t.surface, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: t.ochreFill,
        opacity: pressed ? 0.92 : 1, shadowColor: '#000', shadowOpacity: t.dark ? 0.3 : 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2,
      })}
    >
      <View>
        <HomeImage listing={l} style={{ width: '100%', aspectRatio: 5 / 2 }} />
        <View style={{ position: 'absolute', left: 12, top: 12, backgroundColor: t.ochreFill, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5 }}>
          <T v="label" color="#2A1C00" style={{ fontFamily: 'FamiljenGrotesk_700Bold', letterSpacing: 1.1 }}>Sponsored</T>
        </View>
      </View>
      <View style={{ padding: 14, paddingTop: 12, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <T v="title" style={{ fontSize: 19 }}>{timeRange(item.slot)}</T>
          <Status item={item} />
        </View>
        <T v="title" style={{ fontSize: 19, marginTop: 2 }}>{l.address}</T>
        <T v="small" color={t.muted}>{where}</T>
        <T v="small">{rok(l.rooms)} · {l.size} m²{l.fee ? ` · ${num(l.fee)} kr/mån` : ''}</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
          <T v="heading" style={{ fontSize: 16 }}>{kr(l.price)}</T>
          {!preview && <AddButton item={item} />}
        </View>
        <T v="small" color={t.muted} style={{ fontSize: 12 }}>Promoted by {l.agency}</T>
      </View>
    </Pressable>
  );
});

export const Row = memo(function Row({ item }: { item: FeedItem }) {
  const t = useTheme();
  const { data } = useApp();
  const l = item.listing;
  const others = item.slots.filter((s) => s.start !== item.slot.start);
  const ended = item.status === 'ended';
  return (
    <View style={{ flexDirection: 'row', gap: 8, opacity: ended ? 0.62 : 1 }}>
      <View style={{ width: 46, paddingTop: 10 }}>
        <T v="time">{hhmm(item.slot.start)}</T>
        <T v="small" color={t.muted} style={{ fontSize: 12 }}>{hhmm(item.slot.end)}</T>
        {others.length > 0 && <T v="small" color={t.muted} style={{ fontSize: 11, marginTop: 4 }}>also {others.map((s) => hhmm(s.start)).join(', ')}</T>}
      </View>
      <Pressable
        onPress={() => open(l.id)}
        accessibilityRole="button"
        accessibilityLabel={`${l.address}, ${timeRange(item.slot)}`}
        style={({ pressed }) => ({
          flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, paddingRight: 10, borderRadius: 16, borderWidth: 1,
          borderColor: item.status === 'live' ? t.patina : t.line, backgroundColor: t.surface, opacity: pressed ? 0.85 : 1,
        })}
      >
        <HomeImage listing={l} style={{ width: 64, height: 64, borderRadius: 11 }} />
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <T v="bodyStrong" numberOfLines={1} style={{ fontSize: 16, fontFamily: 'FamiljenGrotesk_600SemiBold' }}>{l.address}</T>
          <T v="small" color={t.muted} numberOfLines={1}>
            {areaName(l.area, data.areas)}{item.distanceKm != null ? ` · ${distanceText(item.distanceKm)}` : ''}
          </T>
          <T v="small" numberOfLines={1}>{rok(l.rooms)} · {l.size} m² · {priceShort(l.price)}</T>
          <View style={{ marginTop: 3 }}><Status item={item} /></View>
        </View>
        <AddButton item={item} compact />
      </Pressable>
    </View>
  );
});
