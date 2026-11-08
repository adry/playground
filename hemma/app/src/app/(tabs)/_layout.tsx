import { Tabs } from 'expo-router/tabs';
import { Icon } from '../../components/Icon';
import { useApp } from '../../state';
import { useTheme } from '../../theme';

export default function TabsLayout() {
  const t = useTheme();
  const app = useApp();
  const planned = app.plan.filter((e) => e.start > app.now - 3 * 3600e3).length;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.falu,
        tabBarInactiveTintColor: t.muted,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.line },
        tabBarLabelStyle: { fontFamily: 'HankenGrotesk_600SemiBold', fontSize: 11 },
        sceneStyle: { backgroundColor: t.paper },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Viewings', tabBarIcon: ({ color }) => <Icon name="home" size={22} color={color} /> }} />
      <Tabs.Screen name="map" options={{ title: 'Map', tabBarIcon: ({ color }) => <Icon name="radar" size={22} color={color} /> }} />
      <Tabs.Screen
        name="plan"
        options={{
          title: 'My day',
          tabBarIcon: ({ color }) => <Icon name="calendar" size={22} color={color} />,
          tabBarBadge: planned || undefined,
          tabBarBadgeStyle: { backgroundColor: t.falu, color: t.onFalu, fontSize: 10 },
        }}
      />
    </Tabs>
  );
}
