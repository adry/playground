import type { ColorValue } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

type Name = 'plus' | 'check' | 'walk' | 'pin' | 'filter' | 'sort' | 'trash' | 'close' | 'home' | 'radar' | 'calendar' | 'warn' | 'chevron' | 'locate' | 'phone' | 'link';

export function Icon({ name, size = 20, color }: { name: Name; size?: number; color: ColorValue }) {
  const p = { stroke: color, strokeWidth: 2, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'plus' && <Path d="M12 5v14M5 12h14" {...p} strokeWidth={2.4} />}
      {name === 'check' && <Path d="m5 12.5 4.5 4.5L19 7.5" {...p} strokeWidth={2.6} />}
      {name === 'walk' && <><Circle cx={13} cy={4.5} r={1.8} {...p} /><Path d="m9 21 2.5-6 2.5 2.5V21M8 11l3-3.5 3 2 2.5 2.5M11.5 15l1-5.5" {...p} /></>}
      {name === 'pin' && <><Path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" {...p} /><Circle cx={12} cy={9.5} r={2.5} {...p} /></>}
      {name === 'filter' && <Path d="M4 6h16M7 12h10M10 18h4" {...p} strokeWidth={2.2} />}
      {name === 'sort' && <Path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5" {...p} strokeWidth={2.2} />}
      {name === 'trash' && <Path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13" {...p} />}
      {name === 'close' && <Path d="M6 6l12 12M18 6 6 18" {...p} strokeWidth={2.4} />}
      {name === 'home' && <Path d="M3 10.5 12 4l9 6.5M5 9.5V20h14V9.5M10 20v-5h4v5" {...p} />}
      {name === 'radar' && <><Circle cx={12} cy={12} r={9} {...p} /><Circle cx={12} cy={12} r={5} {...p} /><Circle cx={12} cy={12} r={1.2} fill={color} /></>}
      {name === 'calendar' && <><Rect x={4} y={5} width={16} height={15} rx={2} {...p} /><Path d="M8 3v4M16 3v4M4 10h16m-11 5 2 2 4-4" {...p} /></>}
      {name === 'warn' && <Path d="M12 4 2.5 20h19L12 4zM12 10v4.5M12 17.5v.01" {...p} strokeWidth={2.2} />}
      {name === 'chevron' && <Path d="M6 9l6 6 6-6" {...p} strokeWidth={2.4} />}
      {name === 'locate' && <><Circle cx={12} cy={12} r={4} {...p} /><Path d="M12 2v3M12 19v3M2 12h3M19 12h3" {...p} /></>}
      {name === 'phone' && <Path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" {...p} />}
      {name === 'link' && <Path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" {...p} />}
    </Svg>
  );
}
