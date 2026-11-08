// Text in Hemma's type: Familjen Grotesk for display and times, Hanken
// Grotesk for reading. Numbers that line up use tabular figures.
import { Text, type TextProps } from 'react-native';
import { font, useTheme } from '../theme';

type Variant = 'display' | 'title' | 'heading' | 'body' | 'bodyStrong' | 'small' | 'label' | 'time';

const SIZES: Record<Variant, { family: keyof typeof font; size: number; line: number; spacing?: number; upper?: boolean }> = {
  display: { family: 'displayBold', size: 27, line: 31, spacing: -0.6 },
  title: { family: 'display', size: 21, line: 26, spacing: -0.2 },
  heading: { family: 'display', size: 17, line: 22 },
  body: { family: 'body', size: 15, line: 21 },
  bodyStrong: { family: 'bodySemi', size: 15, line: 21 },
  small: { family: 'body', size: 13, line: 18 },
  label: { family: 'bodySemi', size: 11, line: 14, spacing: 1, upper: true },
  time: { family: 'display', size: 17, line: 20 },
};

export function T({ v = 'body', color, style, children, ...rest }: TextProps & { v?: Variant; color?: string }) {
  const theme = useTheme();
  const s = SIZES[v];
  return (
    <Text
      {...rest}
      style={[
        { fontFamily: font[s.family], fontSize: s.size, lineHeight: s.line, letterSpacing: s.spacing ?? 0, color: color ?? theme.ink, fontVariant: ['tabular-nums'] },
        s.upper && { textTransform: 'uppercase' },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
