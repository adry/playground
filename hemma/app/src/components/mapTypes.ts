import type { Area, FeedItem, LatLng } from '@core/types.ts';
import type { ViewStyle } from 'react-native';

export interface ViewingsMapProps {
  items: FeedItem[];
  featured: Set<string>;
  origin: LatLng & { label: string; gps: boolean };
  mode: 'near' | 'area';
  radiusKm: number;
  areas: Area[]; // the chosen areas, for framing in area mode
  allAreas: Area[];
  picked: string | null;
  onPick: (id: string | null) => void;
  bottomInset: number;
  style?: ViewStyle;
}

export interface MiniMapProps {
  at: LatLng;
  label: string;
  onPress: () => void;
}

export { regionAround, regionFitting } from '@core/maps.ts';
