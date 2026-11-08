// Small shared pieces: chips, buttons, status line and the add-to-day button.
import * as Haptics from 'expo-haptics';
import { Platform, Pressable, View, type PressableProps, type ViewStyle } from 'react-native';
import { minutesText } from '@core/format.ts';
import type { FeedItem } from '@core/types.ts';
import { useApp } from '../state';
import { useTheme } from '../theme';
import { track } from '../track';
import { Icon } from './Icon';
import { T } from './T';

export function Chip({ label, sub, on, onPress, disabled }: { label: string; sub?: string; on?: boolean; onPress: () => void; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: !!on, disabled: !!disabled }}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'baseline', gap: 6, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999,
        borderWidth: 1, borderColor: on ? t.ink : t.line, backgroundColor: on ? t.ink : t.surface, opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
      })}
    >
      <T v="bodyStrong" color={on ? t.paper : t.ink} style={{ fontSize: 14 }}>{label}</T>
      {sub != null && <T v="small" color={on ? t.paper : t.muted} style={{ fontSize: 12, opacity: on ? 0.8 : 1 }}>{sub}</T>}
    </Pressable>
  );
}

export function Button({ label, onPress, primary, icon, style, disabled, ...rest }: PressableProps & { label: string; primary?: boolean; icon?: Parameters<typeof Icon>[0]['name']; style?: ViewStyle }) {
  const t = useTheme();
  const fg = primary ? t.onFalu : t.ink;
  return (
    <Pressable
      {...rest}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 16,
        borderRadius: 12, borderWidth: 1, borderColor: primary ? t.falu : t.line, backgroundColor: primary ? t.falu : t.surface,
        opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
      }, style]}
    >
      {icon && <Icon name={icon} size={16} color={fg} />}
      <T v="bodyStrong" color={fg}>{label}</T>
    </Pressable>
  );
}

export function statusText(item: Pick<FeedItem, 'status' | 'startsIn' | 'endsIn'>) {
  switch (item.status) {
    case 'live': return `On now · ${minutesText(item.endsIn ?? 0)} left`;
    case 'soon': return `Starts in ${minutesText(item.startsIn ?? 0)}`;
    case 'later': return `In ${minutesText(item.startsIn ?? 0)}`;
    case 'ended': return 'Ended';
    default: return '';
  }
}

export function Status({ item }: { item: FeedItem }) {
  const t = useTheme();
  const text = statusText(item);
  const color = item.status === 'live' ? t.patina : item.status === 'soon' ? t.falu : t.muted;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {!!text && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          {item.status === 'live' && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.patina }} />}
          <T v="small" color={color} style={{ fontFamily: item.status === 'live' || item.status === 'soon' ? 'HankenGrotesk_600SemiBold' : undefined, fontSize: 12 }}>{text}</T>
        </View>
      )}
      {item.slot.booking && (
        <View style={{ borderWidth: 1, borderColor: t.line, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 }}>
          <T v="small" color={t.muted} style={{ fontSize: 11 }}>Book first</T>
        </View>
      )}
    </View>
  );
}

export function AddButton({ item, compact }: { item: FeedItem; compact?: boolean }) {
  const t = useTheme();
  const app = useApp();
  const on = app.inPlan(item.listing.id, item.slot.start);
  const press = () => {
    const added = app.togglePlan(item.listing.id, item.slot.start);
    if (added) track('save', item, app.day);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  };
  return (
    <Pressable
      onPress={press}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${on ? 'In my day' : 'Add to my day'}: ${item.listing.address}`}
      hitSlop={8}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
        height: 36, minWidth: 36, paddingHorizontal: compact ? 0 : 12, borderRadius: 18, borderWidth: 1,
        borderColor: on ? t.falu : t.line, backgroundColor: on ? t.falu : t.surface, opacity: pressed ? 0.75 : 1,
      })}
    >
      <Icon name={on ? 'check' : 'plus'} size={16} color={on ? t.onFalu : t.ink} />
      {!compact && <T v="bodyStrong" color={on ? t.onFalu : t.ink} style={{ fontSize: 13 }}>{on ? 'In my day' : 'Add to my day'}</T>}
    </Pressable>
  );
}

export function Section({ title, count, tone }: { title: string; count?: number; tone?: 'live' }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 22, marginBottom: 10 }}>
      <T v="label" color={tone === 'live' ? t.patina : t.muted} style={{ fontSize: 12 }}>{title}</T>
      {count != null && <T v="small" color={t.muted} style={{ fontSize: 12 }}>{count}</T>}
      <View style={{ flex: 1, height: 1, backgroundColor: t.line }} />
    </View>
  );
}
