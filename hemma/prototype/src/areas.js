// Stockholm neighbourhoods the demo covers. Centres are real; streets are real
// streets in each area. Price levels are rough 2026 asking prices per m².

export const AREAS = [
  {
    id: 'sodermalm', name: 'Södermalm', lat: 59.3142, lng: 18.0716, spreadKm: 1.1,
    pricePerM2: 102000, styles: { stenstad: 6, funkis: 3, modern: 1 },
    streets: ['Skånegatan', 'Götgatan', 'Hornsgatan', 'Bondegatan', 'Folkungagatan', 'Ringvägen', 'Katarina Bangata', 'Blekingegatan', 'Tavastgatan', 'Wollmar Yxkullsgatan', 'Krukmakargatan', 'Åsögatan'],
  },
  {
    id: 'vasastan', name: 'Vasastan', lat: 59.3435, lng: 18.0445, spreadKm: 0.9,
    pricePerM2: 106000, styles: { stenstad: 7, funkis: 3 },
    streets: ['Upplandsgatan', 'Odengatan', 'Dalagatan', 'Karlbergsvägen', 'Sankt Eriksgatan', 'Rörstrandsgatan', 'Västmannagatan', 'Torsgatan', 'Tegnérgatan', 'Hälsingegatan'],
  },
  {
    id: 'ostermalm', name: 'Östermalm', lat: 59.3378, lng: 18.0835, spreadKm: 0.8,
    pricePerM2: 118000, styles: { stenstad: 9, funkis: 1 },
    streets: ['Karlavägen', 'Sibyllegatan', 'Linnégatan', 'Valhallavägen', 'Grev Turegatan', 'Banérgatan', 'Storgatan', 'Riddargatan', 'Artillerigatan'],
  },
  {
    id: 'kungsholmen', name: 'Kungsholmen', lat: 59.3318, lng: 18.0300, spreadKm: 0.9,
    pricePerM2: 96000, styles: { stenstad: 5, funkis: 4, modern: 1 },
    streets: ['Fleminggatan', 'Hantverkargatan', 'Sankt Göransgatan', 'Norr Mälarstrand', 'Kungsholmsgatan', 'Pipersgatan', 'Igeldammsgatan', 'Polhemsgatan'],
  },
  {
    id: 'gamlastan', name: 'Gamla stan', lat: 59.3251, lng: 18.0711, spreadKm: 0.25,
    pricePerM2: 104000, styles: { stenstad: 1 },
    streets: ['Österlånggatan', 'Västerlånggatan', 'Stora Nygatan', 'Prästgatan', 'Lilla Nygatan'],
  },
  {
    id: 'hammarby', name: 'Hammarby Sjöstad', lat: 59.3035, lng: 18.0985, spreadKm: 0.6,
    pricePerM2: 82000, styles: { modern: 1 },
    streets: ['Lugnets allé', 'Hammarby allé', 'Sickla kanalgata', 'Luma allé', 'Heliosgången', 'Babordsgatan'],
  },
  {
    id: 'liljeholmen', name: 'Liljeholmen', lat: 59.3100, lng: 18.0230, spreadKm: 0.6,
    pricePerM2: 76000, styles: { modern: 6, funkis: 4 },
    streets: ['Liljeholmsvägen', 'Lövholmsvägen', 'Sjöviksvägen', 'Årstadalsvägen', 'Liljeholmstorget'],
  },
  {
    id: 'arsta', name: 'Årsta', lat: 59.2985, lng: 18.0500, spreadKm: 0.7,
    pricePerM2: 66000, styles: { funkis: 7, modern: 3 },
    streets: ['Årstavägen', 'Svärdlångsvägen', 'Siljansvägen', 'Dalboplan', 'Valla torg'],
  },
  {
    id: 'gardet', name: 'Gärdet', lat: 59.3460, lng: 18.1000, spreadKm: 0.6,
    pricePerM2: 95000, styles: { funkis: 8, stenstad: 2 },
    streets: ['Furusundsgatan', 'Askrikegatan', 'Värtavägen', 'Lindarängsvägen', 'Tessinparken'],
  },
  {
    id: 'solna', name: 'Solna', lat: 59.3640, lng: 18.0000, spreadKm: 1.0,
    pricePerM2: 70000, styles: { funkis: 4, modern: 6 },
    streets: ['Råsundavägen', 'Huvudstagatan', 'Solnavägen', 'Frösundaleden', 'Vintergatan'],
  },
  {
    id: 'bromma', name: 'Bromma', lat: 59.3370, lng: 17.9400, spreadKm: 1.6,
    pricePerM2: 68000, styles: { villa: 7, radhus: 3 },
    streets: ['Ålstensgatan', 'Nockebyvägen', 'Abrahamsbergsvägen', 'Brommavägen', 'Åkeshovsvägen', 'Vällingbyvägen'],
  },
  {
    id: 'nacka', name: 'Nacka', lat: 59.3105, lng: 18.1640, spreadKm: 1.6,
    pricePerM2: 56000, styles: { villa: 5, radhus: 3, modern: 2 },
    streets: ['Värmdövägen', 'Ektorpsvägen', 'Henriksdalsringen', 'Skvaltans väg', 'Vikdalsvägen'],
  },
];

export const AREA_BY_ID = Object.fromEntries(AREAS.map((a) => [a.id, a]));

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
