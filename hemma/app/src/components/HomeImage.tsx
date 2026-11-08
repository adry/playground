// The home's first photo when the feed has one, otherwise a drawn facade.
import { Image } from 'expo-image';
import { memo, useMemo } from 'react';
import { View, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { facadeSVG } from '@core/facade.ts';
import type { Listing } from '@core/types.ts';
import { useTheme } from '../theme';

export const HomeImage = memo(function HomeImage({ listing, style }: { listing: Listing; style: ViewStyle }) {
  const theme = useTheme();
  const xml = useMemo(() => (listing.images.length ? null : facadeSVG(listing, theme.facade)), [listing, theme.facade]);
  return (
    <View style={[{ overflow: 'hidden', backgroundColor: theme.facade.sky }, style]}>
      {xml ? (
        <SvgXml xml={xml} width="100%" height="100%" preserveAspectRatio="xMidYMid slice" />
      ) : (
        <Image source={{ uri: listing.images[0] }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={150} accessibilityIgnoresInvertColors />
      )}
    </View>
  );
});
