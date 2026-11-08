import type { Area } from './types.ts';

export interface DemoArea extends Area {
  spreadKm: number;
  pricePerM2: number;
  styles: Record<string, number>;
  // A point on each real street, roughly, so demo homes land near their street
  // rather than in the water. Approximate; real feeds send exact coordinates.
  streets: [name: string, lat: number, lng: number][];
}

// Stockholm neighbourhoods the demo covers. Centres are real; streets are real
// streets in each area, each with an approximate point on it. Price levels are rough 2026 asking prices per m².

export const AREAS: DemoArea[] = [
  {
    id: 'sodermalm', name: 'Södermalm', lat: 59.3142, lng: 18.0716, spreadKm: 1.1,
    pricePerM2: 102000, styles: { stenstad: 6, funkis: 3, modern: 1 },
    streets: [['Skånegatan', 59.3137, 18.079], ['Götgatan', 59.312, 18.0738], ['Hornsgatan', 59.3172, 18.05], ['Bondegatan', 59.3124, 18.085], ['Folkungagatan', 59.315, 18.08], ['Ringvägen', 59.309, 18.07], ['Katarina Bangata', 59.3127, 18.083], ['Blekingegatan', 59.3097, 18.076], ['Tavastgatan', 59.3188, 18.058], ['Wollmar Yxkullsgatan', 59.3166, 18.064], ['Krukmakargatan', 59.3165, 18.056], ['Åsögatan', 59.3116, 18.078]],
  },
  {
    id: 'vasastan', name: 'Vasastan', lat: 59.3435, lng: 18.0445, spreadKm: 0.9,
    pricePerM2: 106000, styles: { stenstad: 7, funkis: 3 },
    streets: [['Upplandsgatan', 59.342, 18.053], ['Odengatan', 59.343, 18.055], ['Dalagatan', 59.344, 18.04], ['Karlbergsvägen', 59.345, 18.042], ['Sankt Eriksgatan', 59.342, 18.035], ['Rörstrandsgatan', 59.3405, 18.0315], ['Västmannagatan', 59.342, 18.048], ['Torsgatan', 59.345, 18.0335], ['Tegnérgatan', 59.3385, 18.056], ['Hälsingegatan', 59.346, 18.043]],
  },
  {
    id: 'ostermalm', name: 'Östermalm', lat: 59.3378, lng: 18.0835, spreadKm: 0.8,
    pricePerM2: 118000, styles: { stenstad: 9, funkis: 1 },
    streets: [['Karlavägen', 59.338, 18.085], ['Sibyllegatan', 59.336, 18.079], ['Linnégatan', 59.3365, 18.085], ['Valhallavägen', 59.343, 18.08], ['Grev Turegatan', 59.3365, 18.076], ['Banérgatan', 59.337, 18.095], ['Storgatan', 59.3355, 18.083], ['Riddargatan', 59.3345, 18.083], ['Artillerigatan', 59.3355, 18.081]],
  },
  {
    id: 'kungsholmen', name: 'Kungsholmen', lat: 59.3318, lng: 18.0300, spreadKm: 0.9,
    pricePerM2: 96000, styles: { stenstad: 5, funkis: 4, modern: 1 },
    streets: [['Fleminggatan', 59.3335, 18.035], ['Hantverkargatan', 59.3315, 18.04], ['Sankt Göransgatan', 59.333, 18.028], ['Norr Mälarstrand', 59.3292, 18.035], ['Kungsholmsgatan', 59.3315, 18.045], ['Pipersgatan', 59.3305, 18.046], ['Igeldammsgatan', 59.334, 18.024], ['Polhemsgatan', 59.331, 18.037]],
  },
  {
    id: 'gamlastan', name: 'Gamla stan', lat: 59.3251, lng: 18.0711, spreadKm: 0.25,
    pricePerM2: 104000, styles: { stenstad: 1 },
    streets: [['Österlånggatan', 59.324, 18.073], ['Västerlånggatan', 59.3245, 18.069], ['Stora Nygatan', 59.3245, 18.0676], ['Prästgatan', 59.3245, 18.0705], ['Lilla Nygatan', 59.324, 18.067]],
  },
  {
    id: 'hammarby', name: 'Hammarby Sjöstad', lat: 59.3035, lng: 18.0985, spreadKm: 0.6,
    pricePerM2: 82000, styles: { modern: 1 },
    streets: [['Lugnets allé', 59.3045, 18.105], ['Hammarby allé', 59.303, 18.097], ['Sickla kanalgata', 59.3028, 18.102], ['Luma allé', 59.3042, 18.096], ['Heliosgången', 59.3046, 18.0975], ['Babordsgatan', 59.3048, 18.101]],
  },
  {
    id: 'liljeholmen', name: 'Liljeholmen', lat: 59.3100, lng: 18.0230, spreadKm: 0.6,
    pricePerM2: 76000, styles: { modern: 6, funkis: 4 },
    streets: [['Liljeholmsvägen', 59.3095, 18.023], ['Lövholmsvägen', 59.3118, 18.024], ['Sjöviksvägen', 59.308, 18.031], ['Årstadalsvägen', 59.307, 18.033], ['Liljeholmstorget', 59.3105, 18.0225]],
  },
  {
    id: 'arsta', name: 'Årsta', lat: 59.2985, lng: 18.0500, spreadKm: 0.7,
    pricePerM2: 66000, styles: { funkis: 7, modern: 3 },
    streets: [['Årstavägen', 59.298, 18.05], ['Svärdlångsvägen', 59.299, 18.044], ['Siljansvägen', 59.2985, 18.056], ['Dalboplan', 59.2995, 18.048], ['Valla torg', 59.295, 18.047]],
  },
  {
    id: 'gardet', name: 'Gärdet', lat: 59.3460, lng: 18.1000, spreadKm: 0.6,
    pricePerM2: 95000, styles: { funkis: 8, stenstad: 2 },
    streets: [['Furusundsgatan', 59.345, 18.099], ['Askrikegatan', 59.347, 18.1], ['Värtavägen', 59.342, 18.1], ['Lindarängsvägen', 59.342, 18.11], ['Tessinparken', 59.348, 18.101]],
  },
  {
    id: 'solna', name: 'Solna', lat: 59.3640, lng: 18.0000, spreadKm: 1.0,
    pricePerM2: 70000, styles: { funkis: 4, modern: 6 },
    streets: [['Råsundavägen', 59.363, 18.001], ['Huvudstagatan', 59.351, 17.99], ['Solnavägen', 59.356, 18.02], ['Frösundaleden', 59.368, 18.02], ['Vintergatan', 59.36, 17.995]],
  },
  {
    id: 'bromma', name: 'Bromma', lat: 59.3370, lng: 17.9400, spreadKm: 1.6,
    pricePerM2: 68000, styles: { villa: 7, radhus: 3 },
    streets: [['Ålstensgatan', 59.327, 17.958], ['Nockebyvägen', 59.329, 17.925], ['Abrahamsbergsvägen', 59.336, 17.953], ['Brommavägen', 59.339, 17.937], ['Åkeshovsvägen', 59.342, 17.925], ['Vällingbyvägen', 59.347, 17.922]],
  },
  {
    id: 'nacka', name: 'Nacka', lat: 59.3105, lng: 18.1640, spreadKm: 1.6,
    pricePerM2: 56000, styles: { villa: 5, radhus: 3, modern: 2 },
    streets: [['Värmdövägen', 59.311, 18.165], ['Ektorpsvägen', 59.301, 18.19], ['Henriksdalsringen', 59.3125, 18.115], ['Skvaltans väg', 59.306, 18.16], ['Vikdalsvägen', 59.312, 18.175]],
  },
];

export const AREA_BY_ID: Record<string, DemoArea> = Object.fromEntries(AREAS.map((a) => [a.id, a]));

// Where "near me" starts when the browser will not share a position, or the
// real one is nowhere near the demo listings.
export const DEMO_SPOTS = [
  { id: 'medborgarplatsen', label: 'Medborgarplatsen', lat: 59.3141, lng: 18.0736 },
  { id: 'odenplan', label: 'Odenplan', lat: 59.3429, lng: 18.0498 },
  { id: 'fridhemsplan', label: 'Fridhemsplan', lat: 59.3322, lng: 18.0294 },
  { id: 'karlaplan', label: 'Karlaplan', lat: 59.3389, lng: 18.0907 },
  { id: 'slussen', label: 'Slussen', lat: 59.3195, lng: 18.0723 },
  { id: 'liljeholmen', label: 'Liljeholmen', lat: 59.3108, lng: 18.0228 },
  { id: 'brommaplan', label: 'Brommaplan', lat: 59.3383, lng: 17.9393 },
];

export const STOCKHOLM = { lat: 59.3293, lng: 18.0686 };
