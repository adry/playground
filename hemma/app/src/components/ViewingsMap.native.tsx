// The real map on iPhone (Apple Maps) and Android (Google Maps): a pin per
// viewing showing its start time, coloured by whether it is on now, the
// buyer's search radius, and where they stand.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import MapView, { Circle, Marker } from 'react-native-maps';
import { hhmm } from '@core/format.ts';
import type { FeedItem } from '@core/types.ts';
import { useTheme, type Theme } from '../theme';
import { regionAround, regionFitting, type ViewingsMapProps } from './mapTypes';

function pinColors(item: FeedItem, t: Theme) {
  const light = t.dark ? t.paper : '#FFFFFF';
  switch (item.status) {
    case 'live': return { bg: t.patina, fg: light };
    case 'soon': return { bg: t.falu, fg: light };
    case 'ended': return { bg: t.sunken, fg: t.muted };
    default: return { bg: t.ink, fg: t.paper };
  }
}

function Pin({ item, featured, picked }: { item: FeedItem; featured: boolean; picked: boolean }) {
  const t = useTheme();
  const c = pinColors(item, t);
  const ring = featured ? t.ochreFill : item.status === 'ended' ? t.line : t.surface;
  return (
    <View style={{ alignItems: 'center', transform: [{ scale: picked ? 1.18 : 1 }] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10, backgroundColor: c.bg, borderWidth: featured ? 2.5 : 1.5, borderColor: picked ? t.falu : ring }}>
        {item.promotion && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.ochreFill }} />}
        <Text style={{ color: c.fg, fontSize: 12, fontFamily: 'FamiljenGrotesk_600SemiBold', fontVariant: ['tabular-nums'] }}>{hhmm(item.slot.start)}</Text>
      </View>
      <View style={{ width: 8, height: 8, marginTop: -5, backgroundColor: c.bg, transform: [{ rotate: '45deg' }], borderRightWidth: 1.5, borderBottomWidth: 1.5, borderColor: picked ? t.falu : ring }} />
    </View>
  );
}

export function ViewingsMap({ items, featured, origin, mode, radiusKm, areas, allAreas, picked, onPick, bottomInset, style }: ViewingsMapProps) {
  const t = useTheme();
  const map = useRef<MapView>(null);
  const region = useMemo(() => {
    if (mode === 'near') return regionAround(origin, radiusKm);
    const pts = items.length ? items.map((i) => i.listing) : (areas.length ? areas : allAreas);
    return regionFitting(pts, origin);
  }, [mode, origin, radiusKm, items, areas, allAreas]);
  const frameKey = `${mode}:${origin.lat.toFixed(4)}:${origin.lng.toFixed(4)}:${radiusKm}:${areas.map((a) => a.id).join(',')}`;

  // Reframe when the buyer changes where they look, not on every clock tick.
  useEffect(() => {
    map.current?.animateToRegion(region, 350);
  }, [frameKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Custom pins must be drawn once before the map may cache them as images.
  const [tracking, setTracking] = useState(true);
  const pinsKey = items.map((i) => `${i.listing.id}:${i.status}`).join('|') + picked;
  useEffect(() => {
    setTracking(true);
    const timer = setTimeout(() => setTracking(false), 700);
    return () => clearTimeout(timer);
  }, [pinsKey]);

  const order = { ended: 0, scheduled: 1, later: 1, soon: 2, live: 3 } as const;
  return (
    <MapView
      ref={map}
      style={[{ flex: 1 }, style]}
      initialRegion={region}
      showsUserLocation={origin.gps}
      showsPointsOfInterests={false}
      showsCompass={false}
      toolbarEnabled={false}
      userInterfaceStyle={t.dark ? 'dark' : 'light'}
      mapPadding={{ top: 56, right: 0, bottom: bottomInset, left: 0 }}
      onPress={() => onPick(null)}
    >
      {mode === 'near' && (
        <Circle
          center={{ latitude: origin.lat, longitude: origin.lng }}
          radius={radiusKm * 1000}
          strokeColor={t.falu}
          strokeWidth={1.5}
          fillColor={t.dark ? 'rgba(226,107,87,0.07)' : 'rgba(163,56,42,0.05)'}
        />
      )}
      {!origin.gps && (
        <Marker coordinate={{ latitude: origin.lat, longitude: origin.lng }} title={origin.label} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
          <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: t.falu, borderWidth: 3, borderColor: t.surface }} />
        </Marker>
      )}
      {items.map((item) => {
        const id = item.listing.id;
        return (
          <Marker
            key={id}
            identifier={id}
            coordinate={{ latitude: item.listing.lat, longitude: item.listing.lng }}
            anchor={{ x: 0.5, y: 1 }}
            zIndex={picked === id ? 100 : order[item.status] * 10 + (featured.has(id) ? 5 : 0)}
            tracksViewChanges={tracking}
            accessibilityLabel={`${item.listing.address}, ${hhmm(item.slot.start)}`}
            onPress={(e) => {
              e.stopPropagation();
              onPick(id);
            }}
          >
            <Pin item={item} featured={featured.has(id)} picked={picked === id} />
          </Marker>
        );
      })}
    </MapView>
  );
}
