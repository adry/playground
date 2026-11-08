// The feed: what is open for viewing on the chosen day, sponsored first.
import { router } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, View, type ListViewToken } from 'react-native';
import { dayLabel, dayPhrase, fromKey, plural } from '@core/format.ts';
import type { FeedItem } from '@core/types.ts';
import { Row, SponsoredCard } from '../../components/Cards';
import { Button, Section } from '../../components/bits';
import { Header } from '../../components/Header';
import { Icon } from '../../components/Icon';
import { T } from '../../components/T';
import { useApp } from '../../state';
import { useTheme } from '../../theme';
import { track } from '../../track';

type Entry =
  | { key: string; kind: 'sponsored'; item: FeedItem }
  | { key: string; kind: 'section'; title: string; count: number; live?: boolean }
  | { key: string; kind: 'row'; item: FeedItem }
  | { key: string; kind: 'more'; count: number };

export default function Viewings() {
  const t = useTheme();
  const app = useApp();
  const [showEnded, setShowEnded] = useState(false);
  const { feed } = app;

  const entries = useMemo(() => {
    const out: Entry[] = feed.sponsored.map((item) => ({ key: `s-${item.listing.id}`, kind: 'sponsored', item }));
    const add = (title: string, items: FeedItem[], live?: boolean) => {
      if (!items.length) return;
      out.push({ key: `h-${title}`, kind: 'section', title, count: items.length, live });
      for (const item of items) out.push({ key: `r-${item.listing.id}`, kind: 'row', item });
    };
    const ended = feed.organic.filter((i) => i.status === 'ended');
    const open = feed.organic.filter((i) => i.status !== 'ended');
    if (app.sort === 'distance') add('Nearest first', open);
    else if (app.day === app.today) {
      add('On now', open.filter((i) => i.status === 'live'), true);
      add('Coming up', open.filter((i) => i.status !== 'live'));
    } else {
      const h = (i: FeedItem) => new Date(i.slot.start).getHours();
      add('Morning', open.filter((i) => h(i) < 12));
      add('Afternoon', open.filter((i) => h(i) >= 12 && h(i) < 17));
      add('Evening', open.filter((i) => h(i) >= 17));
    }
    if (ended.length) {
      if (showEnded) add('Earlier today', ended);
      else out.push({ key: 'more', kind: 'more', count: ended.length });
    }
    return out;
  }, [feed, app.sort, app.day, app.today, showEnded]);

  // Agents see how often their homes were shown: count what scrolls into view.
  const dayRef = useRef(app.day);
  dayRef.current = app.day;
  const onViewable = useRef(({ viewableItems }: { viewableItems: ListViewToken[] }) => {
    for (const v of viewableItems) {
      const e = v.item as Entry | undefined;
      if (e && (e.kind === 'row' || e.kind === 'sponsored')) track('impression', e.item, dayRef.current);
    }
  }).current;

  const filterCount = (app.filters.types.length ? 1 : 0) + (app.filters.minRooms ? 1 : 0) + (app.filters.maxPrice ? 1 : 0) + (app.filters.openOnly ? 1 : 0);
  const where = app.mode === 'near' ? `within ${app.radiusKm} km` : app.areas.length ? `in ${plural(app.areas.length, 'area')}` : 'everywhere';
  const nextDay = app.days.find((d) => d > app.day && (app.counts[d] ?? 0) > 0);

  const renderItem = useCallback(({ item: e }: { item: Entry }) => {
    if (e.kind === 'sponsored') return <View style={{ marginBottom: 12 }}><SponsoredCard item={e.item} /></View>;
    if (e.kind === 'section') return <Section title={e.title} count={e.count} tone={e.live ? 'live' : undefined} />;
    if (e.kind === 'row') return <View style={{ marginBottom: 10 }}><Row item={e.item} /></View>;
    return (
      <View style={{ alignItems: 'flex-start', marginTop: 12 }}>
        <Button label={`Show ${plural(e.count, 'ended viewing')}`} onPress={() => setShowEnded(true)} />
      </View>
    );
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: t.paper }}>
      <Header />
      <FlatList
        data={entries}
        keyExtractor={(e) => e.key}
        renderItem={renderItem}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60, minimumViewTime: 600 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        ListHeaderComponent={
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, paddingTop: 16, paddingBottom: 12 }}>
            <View style={{ flex: 1 }}>
              <T v="title">{plural(feed.total, 'viewing')} {dayPhrase(app.day, app.today)}</T>
              <T v="body" color={t.muted}>
                {where}
                {feed.live > 0 && <T v="bodyStrong" color={t.patina}>{`  ·  ${feed.live} on now`}</T>}
              </T>
            </View>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Tool icon="sort" label={app.sort === 'time' ? 'Soonest' : 'Nearest'} onPress={() => app.set({ sort: app.sort === 'time' ? 'distance' : 'time' })} />
              <Tool icon="filter" label="Filters" badge={filterCount} onPress={() => router.push('/filters')} />
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={{ marginTop: 8, padding: 20, borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: t.line, backgroundColor: t.surface, gap: 10 }}>
            <T v="title" style={{ fontSize: 19 }}>{app.loadError ? 'Could not load viewings' : `No viewings ${dayPhrase(app.day, app.today)}`}</T>
            <T color={t.muted}>{app.loadError ? 'Check your connection and try again.' : 'Try another day or a wider area.'}</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {app.loadError ? <Button primary label="Try again" onPress={app.reload} /> : nextDay && <Button primary label={`See ${dayLabel(nextDay, app.today)} ${fromKey(nextDay).getDate()}`} onPress={() => app.setDay(nextDay)} />}
              {!app.loadError && app.mode === 'near' && app.radiusKm < 10 && <Button label={`Widen to ${app.radiusKm < 5 ? 5 : 10} km`} onPress={() => app.set({ radiusKm: app.radiusKm < 5 ? 5 : 10 })} />}
            </View>
          </View>
        }
      />
    </View>
  );
}

function Tool({ icon, label, badge, onPress }: { icon: 'sort' | 'filter'; label: string; badge?: number; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => ({
      flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface,
      borderRadius: 999, paddingVertical: 6, paddingHorizontal: 11, opacity: pressed ? 0.7 : 1,
    })}>
      <Icon name={icon} size={14} color={t.ink} />
      <T v="bodyStrong" style={{ fontSize: 13 }}>{label}</T>
      {!!badge && (
        <View style={{ backgroundColor: t.falu, borderRadius: 999, minWidth: 17, height: 17, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
          <T v="small" color={t.onFalu} style={{ fontSize: 11, lineHeight: 13 }}>{badge}</T>
        </View>
      )}
    </Pressable>
  );
}
