import { FamiljenGrotesk_600SemiBold, FamiljenGrotesk_700Bold } from '@expo-google-fonts/familjen-grotesk';
import { HankenGrotesk_400Regular, HankenGrotesk_500Medium, HankenGrotesk_600SemiBold } from '@expo-google-fonts/hanken-grotesk';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from '../state';
import { useTheme } from '../theme';

export default function Root() {
  const t = useTheme();
  const [fontsLoaded, fontError] = useFonts({
    FamiljenGrotesk_600SemiBold, FamiljenGrotesk_700Bold, HankenGrotesk_400Regular, HankenGrotesk_500Medium, HankenGrotesk_600SemiBold,
  });
  if (!fontsLoaded && !fontError) return <View style={{ flex: 1, backgroundColor: t.paper }} />;
  return (
    <SafeAreaProvider>
      <AppProvider>
        <StatusBar style={t.dark ? 'light' : 'dark'} />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.paper } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="listing/[id]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="place" options={{ presentation: 'formSheet', sheetAllowedDetents: [0.75, 1], sheetGrabberVisible: true, contentStyle: { backgroundColor: t.surface } }} />
          <Stack.Screen name="filters" options={{ presentation: 'formSheet', sheetAllowedDetents: [0.7, 1], sheetGrabberVisible: true, contentStyle: { backgroundColor: t.surface } }} />
        </Stack>
      </AppProvider>
    </SafeAreaProvider>
  );
}
