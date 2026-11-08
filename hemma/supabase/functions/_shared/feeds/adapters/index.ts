import type { Adapter } from '../types.ts';
import { hemmaJson } from './hemma-json.ts';
import { hemmaXml } from './hemma-xml.ts';

// Add a source system's format here, and to the feed_sources.format check.
export const ADAPTERS: Record<string, Adapter> = {
  [hemmaJson.id]: hemmaJson,
  [hemmaXml.id]: hemmaXml,
};
