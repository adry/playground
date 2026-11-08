// The same fields as hemma-json, as XML, for systems that only export XML:
// <listings><listing id="..."><address>...</address>
//   <images><image>https://...</image></images>
//   <viewings><viewing start="..." end="..." booking="true"/></viewings>
// </listing></listings>
import { XMLParser } from 'fast-xml-parser';
import type { Adapter, RawListing } from '../types.ts';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseTagValue: false, // keep "0701740610" and org numbers as text
  trimValues: true,
  isArray: (name) => ['listing', 'image', 'viewing'].includes(name),
});

export const hemmaXml: Adapter = {
  id: 'hemma-xml',
  contentType: 'application/xml',
  parse(body) {
    const doc = parser.parse(body);
    const list = doc?.listings?.listing;
    if (!Array.isArray(list)) throw new Error('expected <listings><listing>...</listing></listings>');
    return list.map((l: Record<string, any>) => ({
      ...l,
      externalId: l.externalId ?? l.id,
      images: l.images?.image ?? [],
      viewings: l.viewings?.viewing ?? [],
    })) as RawListing[];
  },
};
