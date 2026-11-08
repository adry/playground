// Hands a destination to the phone's map apps for turn-by-turn directions.
// iPhone: Apple Maps or Google Maps. Android: Google Maps or any other map
// app (the geo: link lets the phone ask). Destinations are coordinates, which
// come from the agency's feed, so the pin lands on the right door.
import * as Linking from 'expo-linking';
import { ActionSheetIOS, Alert, Platform } from 'react-native';
import { appleMapsUrl, googleMapsUrl, otherAppUrl, type Destination } from '@core/maps.ts';
import type { LatLng } from '@core/types.ts';

export type { Destination } from '@core/maps.ts';
export { appleMapsUrl, googleMapsUrl, otherAppUrl } from '@core/maps.ts';

const open = (url: string) => void Linking.openURL(url).catch(() => Alert.alert('Could not open the map app'));

// Directions to one home. `from` is only passed when the buyer is planning
// from a chosen spot rather than where they stand; otherwise the map app
// starts from the phone's own position.
export function openDirections(to: Destination, from?: LatLng | null) {
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      { title: `Walk to ${to.label}`, options: ['Apple Maps', 'Google Maps', 'Cancel'], cancelButtonIndex: 2 },
      (i) => {
        if (i === 0) open(appleMapsUrl(to, from));
        if (i === 1) open(googleMapsUrl(to, from));
      },
    );
  } else if (Platform.OS === 'android') {
    Alert.alert(`Walk to ${to.label}`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Other map app', onPress: () => open(otherAppUrl(to)) },
      { text: 'Google Maps', onPress: () => open(googleMapsUrl(to, from)) },
    ]);
  } else {
    open(googleMapsUrl(to, from));
  }
}

// A whole viewing day. Google Maps takes every stop in order; Apple Maps
// links carry one destination, so it gets the first stop.
export function openRoute(stops: Destination[], from?: LatLng | null) {
  if (!stops.length) return;
  const last = stops[stops.length - 1];
  const google = googleMapsUrl(last, from, stops.slice(0, -1));
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      { title: 'Walking route', options: [`Google Maps, all ${stops.length} stops`, `Apple Maps, to ${stops[0].label}`, 'Cancel'], cancelButtonIndex: 2 },
      (i) => {
        if (i === 0) open(google);
        if (i === 1) open(appleMapsUrl(stops[0], from));
      },
    );
  } else {
    open(google);
  }
}
