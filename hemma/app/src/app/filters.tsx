import { router } from 'expo-router';
import { ScrollView, Switch, View } from 'react-native';
import { plural } from '@core/format.ts';
import { NO_FILTERS, type ListingType } from '@core/types.ts';
import { Button, Chip } from '../components/bits';
import { T } from '../components/T';
import { useApp } from '../state';
import { useTheme } from '../theme';

const TYPES: [ListingType, string][] = [['apartment', 'Apartment'], ['house', 'House'], ['townhouse', 'Townhouse']];
const ROOMS: [number, string][] = [[0, 'Any'], [1, '1+'], [2, '2+'], [3, '3+'], [4, '4+']];
const PRICES: [number, string][] = [[0, 'Any'], [3e6, '3 Mkr'], [5e6, '5 Mkr'], [8e6, '8 Mkr'], [12e6, '12 Mkr']];

export default function FiltersSheet() {
  const t = useTheme();
  const app = useApp();
  const f = app.filters;
  const set = (patch: Partial<typeof f>) => app.set({ filters: { ...f, ...patch } });
  const group = (label: string, children: React.ReactNode) => (
    <View style={{ gap: 10 }}>
      <T v="label" color={t.muted} style={{ fontSize: 12 }}>{label}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>
    </View>
  );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 22, paddingBottom: 40, gap: 18 }} style={{ backgroundColor: t.surface }}>
      <T v="title">Filters</T>
      {group('Home', TYPES.map(([v, label]) => (
        <Chip key={v} label={label} on={f.types.includes(v)} onPress={() => set({ types: f.types.includes(v) ? f.types.filter((x) => x !== v) : [...f.types, v] })} />
      )))}
      {group('Rooms', ROOMS.map(([v, label]) => <Chip key={v} label={label} on={f.minRooms === v} onPress={() => set({ minRooms: v })} />))}
      {group('Highest price', PRICES.map(([v, label]) => <Chip key={v} label={label} on={f.maxPrice === v} onPress={() => set({ maxPrice: v })} />))}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 14, backgroundColor: t.paper, borderRadius: 12 }}>
        <View style={{ flex: 1 }}>
          <T v="bodyStrong">Open viewings only</T>
          <T v="small" color={t.muted}>Skip viewings you have to book first</T>
        </View>
        <Switch value={f.openOnly} onValueChange={(v) => set({ openOnly: v })} trackColor={{ true: t.falu, false: t.line }} accessibilityLabel="Open viewings only" />
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button label="Clear" onPress={() => app.set({ filters: NO_FILTERS })} />
        <Button primary label={`Show ${plural(app.feed.total, 'viewing')}`} onPress={() => router.back()} style={{ flex: 1 }} />
      </View>
    </ScrollView>
  );
}
