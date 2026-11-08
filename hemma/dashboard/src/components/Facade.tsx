import { useMemo, useSyncExternalStore } from 'react';
import { DARK_FACADE, facadeSVG, LIGHT_FACADE } from '@core/facade.ts';
import type { AgencyHome } from '../api/types';

const query = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const subscribe = (cb: () => void) => (query?.addEventListener('change', cb), () => query?.removeEventListener('change', cb));
export const useDark = () => useSyncExternalStore(subscribe, () => !!query?.matches);

// The home's first photo, or the same drawn facade buyers see in the app.
// The SVG comes from our own generator, never from a feed.
export function HomeArt({ home }: { home: AgencyHome }) {
  const dark = useDark();
  const svg = useMemo(() => (home.images.length ? null : facadeSVG(home, dark ? DARK_FACADE : LIGHT_FACADE)), [home, dark]);
  if (!svg) return <img src={home.images[0]} alt="" loading="lazy" />;
  return <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: svg }} />;
}
