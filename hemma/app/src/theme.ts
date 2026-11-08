// Hemma's palette: a cool, slightly green paper; Falu red for actions;
// copper-roof patina for "on now"; ochre for sponsored. Same tokens as the
// web prototype, in light and dark.
import { useColorScheme } from 'react-native';
import { DARK_FACADE, LIGHT_FACADE, type FacadePalette } from '@core/facade.ts';

export interface Theme {
  dark: boolean;
  paper: string;
  surface: string;
  sunken: string;
  ink: string;
  muted: string;
  line: string;
  falu: string;
  onFalu: string;
  patina: string;
  patinaSoft: string;
  ochre: string;
  ochreFill: string;
  ochreSoft: string;
  warn: string;
  warnSoft: string;
  facade: FacadePalette;
}

const light: Theme = {
  dark: false,
  paper: '#F1F4F2',
  surface: '#FFFFFF',
  sunken: '#E7ECE9',
  ink: '#12201D',
  muted: '#5A6A66',
  line: '#D8E0DC',
  falu: '#A3382A',
  onFalu: '#FFFFFF',
  patina: '#237563',
  patinaSoft: '#DCEFE9',
  ochre: '#8A5F05',
  ochreFill: '#F2C14E',
  ochreSoft: '#FBF1D8',
  warn: '#B4471B',
  warnSoft: '#FBE6DC',
  facade: LIGHT_FACADE,
};

const dark: Theme = {
  dark: true,
  paper: '#0D1513',
  surface: '#15201E',
  sunken: '#1B2725',
  ink: '#E3EBE8',
  muted: '#93A39F',
  line: '#263532',
  falu: '#E26B57',
  onFalu: '#1A0B08',
  patina: '#5FC2A9',
  patinaSoft: '#14322B',
  ochre: '#F0C35E',
  ochreFill: '#E8B743',
  ochreSoft: '#2C2412',
  warn: '#F08A5D',
  warnSoft: '#34200F',
  facade: DARK_FACADE,
};

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export const font = {
  display: 'FamiljenGrotesk_600SemiBold',
  displayBold: 'FamiljenGrotesk_700Bold',
  body: 'HankenGrotesk_400Regular',
  bodyMedium: 'HankenGrotesk_500Medium',
  bodySemi: 'HankenGrotesk_600SemiBold',
};

export const space = { gutter: 16, gap: 10 };
