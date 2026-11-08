// Web build only (used for previews): react-native-maps has no web version,
// so the browser shows the distance diagram instead. Phones get
// ViewingsMap.native.tsx, a real Apple or Google map.
import { ScrollView } from 'react-native';
import { Radar, radarFrame } from './Radar';
import type { ViewingsMapProps } from './mapTypes';

export function ViewingsMap({ items, featured, origin, mode, radiusKm, areas, allAreas, picked, onPick, bottomInset }: ViewingsMapProps) {
  const frame = radarFrame(mode, origin, radiusKm, areas.length ? areas : allAreas, items);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 64, paddingBottom: bottomInset + 16 }}>
      <Radar center={frame.center} radiusKm={frame.R} you={origin} items={items} featured={featured} areas={allAreas} picked={picked} onPick={(id) => onPick(id)} />
    </ScrollView>
  );
}
