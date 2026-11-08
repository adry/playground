// A small, still map of where the home is. Tapping it offers directions.
import { Pressable, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useTheme } from '../theme';
import { regionAround, type MiniMapProps } from './mapTypes';

export function MiniMap({ at, label, onPress }: MiniMapProps) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Map of ${label}. Get directions`} style={{ height: 170, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: t.line }}>
      <View pointerEvents="none" style={{ flex: 1 }}>
        <MapView
          style={{ flex: 1 }}
          initialRegion={regionAround(at, 0.3)}
          scrollEnabled={false}
          zoomEnabled={false}
          pitchEnabled={false}
          rotateEnabled={false}
          toolbarEnabled={false}
          liteMode
          showsPointsOfInterests={false}
          userInterfaceStyle={t.dark ? 'dark' : 'light'}
        >
          <Marker coordinate={{ latitude: at.lat, longitude: at.lng }} pinColor={t.falu} title={label} />
        </MapView>
      </View>
    </Pressable>
  );
}
