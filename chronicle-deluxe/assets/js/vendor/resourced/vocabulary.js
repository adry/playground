/**
 * The pill vocabulary, cut down to what a loader can afford.
 *
 * The marketing site carries a written colour card of 3,057 names, each paired
 * with the hex it describes — kilns and rope and weather and preserves and dye
 * works and birds, the places colour names actually come from. That card is
 * 83KB of JSON, which is a fair price on a hero that is the page and an absurd
 * one on a spinner that has to be on screen before the app can paint.
 *
 * Two things make it cheap here.
 *
 * The hexes are gone. On the site they did two jobs: they sorted each band
 * dark to light, and they decided which band a name belonged to. The sort is
 * vestigial — since the cloud started computing a mote's fill from where it
 * sits rather than taking it from the pill it wears, nothing downstream reads
 * the stored colour at all. The bucketing is real, but it is a decision that
 * can be made once, here, instead of in every browser: the names arrive
 * already grouped into the eight bands the cloud walks, and the colour they
 * are drawn in comes from the mark, as it does on the site.
 *
 * The order inside a band is load-bearing now. It used to be vestigial — the
 * card sorted each band dark to light and nothing downstream read it back, so
 * a mote drew any name in its hue at random. Hue was never the problem; shade
 * was, and shade is most of what a colour name carries. `assign()` normalises
 * a mote's own lightness across the range the sweep produces and reads that
 * far into the band, so a name written for the deep end lands on a deep pill.
 * Which is why the hexes could go but the ORDER could not: the colour comes
 * from where a mote sits, and the order is what remembers which name belongs
 * at that darkness.
 *
 * And the card is sampled rather than carried whole — 120 names a band, taken
 * at an even stride through the original so the four writing sessions the card
 * was made from are all still represented and the voice does not flatten into
 * one register. 960 names is far more than a loader can show: only a few
 * hundred motes are ever drawn large enough to read, and everything else is a
 * two-pixel smear whose label is a texture, not a word.
 *
 * Retuned against the fill, not against the card.
 *
 * The card's names were written beside the hexes they describe, and on the
 * marketing site that pairing survives where it matters: the readable pills
 * there are drawn in the colour the card gives them, and only the unreadable
 * smears take the sweep. The loader cannot afford the hexes, so *every* pill
 * here — the readable ones included — is filled from where it sits, and a name
 * only has to be honest about the band it landed in rather than about one
 * colour. Judged that way a good deal of the card was wrong on this side of
 * the fence: "Mango Skin" and "Barn Door" sat in the green band, a third of
 * blue named a near-white (sleet, sea fog, hoar frost) or a near-black (lamp
 * off, half dark, wolf hour) that the band's own lightness range never
 * reaches, and violet was largely chalk. Each band was re-read against the
 * hues and shades it actually renders — six columns of hue by six rows of
 * shade, measured off `assign()` rather than assumed — and the names that
 * could not survive the whole grid were replaced in the card's own voice.
 * Names are unique across the eight bands, which the atlas relies on.
 *
 * Stored as eight pipe-joined strings rather than eight arrays of strings,
 * which costs one `split` at startup and saves the quoting on every entry.
 */

/* The order the bands are walked in — around the wheel rather than by name, so
   that crossing the mark crosses the spectrum instead of jumping between
   unrelated hues. `resourced-loader.js` relies on this order matching the hue
   centres it interpolates between. */
export const WHEEL = ['red', 'amber', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink'];

const BANDS = [
  /* red */
  "Cochineal|Sealing Wax|Cranberry Sauce|Telephone Box|Turkey Red|Forge Coal|Brake Light|Ledger Red|Cardinal Feather|Velvet Seat|Holly Berry|Roadster Red|Signal Red|Tram Red|Fire Escape|Madder Root|Ensign Red|Fire Bucket|Antifoul Red|Alarm Bell|Berry Stain|Selvedge Red|Port Buoy|Nail Lacquer|Ember Field|Wildfire Ridge|Racing Stripe|Temple Gate|Boathouse Red|Furnace Door|Opera Sash|Match Head|Hawthorn Berry|Cinnabar Seal|Redcurrant Jelly|Chimney Red|Field Poppy|Passata|Red Lead|Lantern Festival|Beach Hut Red|Doorstep Red|Rosehip Jam|Farmstead Red|Lifeboat Red|Bresaola|Rosehip Syrup|Chilli Oil|Funnel Red|Raspberry Coulis|Rosé Cellar|Fairground Red|Pimento|Taxi Roof|Lighthouse Band|Moorland Fire|Jelly Bean Red|Paprika Tin|Jukebox Red|Village Red|Bittersweet Vine|Shutter Paint|Grenadine|Alpen Rose|Firework Stall|Barberry|Tomato Skin|Cherry Lip|Window Geranium|Yew Berry|Forced Rhubarb|Stubble Fire|Kettle Red|Ruddle Mark|Pinking Shears|Flare Path|Hunting Pink|Valentine Post|Robin's Breast|Bellows Glow|Crayfish Claw|Harbour Rose|Cherry Fool|Garden Wall|Gift Ribbon|Peony Bud|Pimpernel|Fishing Float|Cinema Marquee|Nectarine Skin|Jam Tart|Punch Bowl|Red Campion|Watermelon Heart|Deckchair Stripe|Guava Half|Lamplight Rose|Shepherd's Warning|Tidepool Coral|Ragged Rose|Cliff Thrift|Salmon Leap|Red Valerian|Button Rose|Shrimp Boat|Salmon Run|Pier Light|Sanguine Chalk|Bitters Ice|Vermouth Blush|Salt Flat Rose|Lime Wash Red|Carnation|Coralline|Taffeta Blush|Conch Lip|Dog Rose|Cape Rose|Sugar Rose|Georgette Pink",

  /* amber */
  "Locomotive Rust|Girder Primer|Iron Oxide|Anchor Rust|Trawl Rust|Conker Gloss|Chestnut Husk|Iodine Tincture|Fox Pelt|Hinge Rust|Henna Stain|Quince Paste|Kiln Yard|Annatto Seed|Bracken|Barnacle Rust|Atacama Rock|Pipe Copper|Tanner's Bark|Bottle Amber|Steamer Trunk|Terracotta Pot|Marrakesh Wall|Clay Pantile|Achiote|Caramel Pan|Bronze Ladle|Whisky Cask|Sienna Ground|Copper Kettle|Grouse Feather|Carrot Skin|Tangerine Crate|Peach Stone|Turmeric Root|Satchel Leather|Partridge|Scaffold Rust|Mojave Rock|Chandlery|Toffee Shop|Brogue Tan|Ochre Pit|Cedar Shingle|Rooftop Sienna|Kestrel Wing|Medlar|Crane Boom|Nasturtium|Jute Sack|Satsuma|Broome Cliff|Spice Sack|Brick Dust|Amber Ale|Wallflower Row|Sandstone Ledge|Physalis|Tuscan Noon|Cheddar Rind|Toffee Apple|Chanterelle|Squash Ribs|Yam Flesh|Marmalade|Sepia Print|Pharmacy Glass|Newt Belly|Mimolette|Tree Sap|Praline Crack|Tawny Owl|Ginger Nut|Tart Glaze|Sourdough Crust|Ship's Bell|Cappadocia|Seville Peel|Tiger Lily|Site Helmet|Resin Drop|Barley Malt|Calendula|Honeycomb Snap|Apricot Glaze|Trumpet Bell|Butternut Cut|Chai Skin|Bottle Glow|Stucco Sun|Reliquary|Sea Buckthorn|Mango Cheek|Circus Lantern|Fairground Amber|Glove Tan|Apricot Kernel|Demerara|Pastry Glaze|Silo Amber|Gilder's Cushion|Duck Foot|Onion Skin|Cork Float|Loquat|Carousel Gold|Deer Hide|Old Map|Preserve Jar|Halva|Lamp Oil|Honeydrop|Plane Curl|Barley Sugar|Candlelit Nave|Foundry Sand|Desk Lamp Pool|Marquee Bulb|Filament Glow|Reading Lamp",

  /* yellow */
  "Fenugreek|Thunder Light|Kiln Gold|Brass Rubbing|Gamboge|Hurdle Fence|Malting Floor|Old Gilt|Shellac Flake|Corn Stubble|Tannin Bath|Quercitron|Dijon Jar|Egg Yolk|Parched Field|Chrome Yellow|Cider Vinegar|Rush Mat|Wheatgerm|Ripe Barley|Hop Cone|Orpiment|Weld Bath|Sorghum Field|Pale Ale|Carding Comb|Sisal|Oilskin|Honey Comb|Solder Flux|Drought Grass|Siskin|Thatch|Pickle Brine|Feed Sack|Mustard Seed|Honey Vinegar|Hay Bale|Plover Egg|Tansy Head|Straw Marquetry|Barnyard Straw|Focaccia|Yellow Pea|Linseed|Wind Blown Wheat|Wax Resist|Cheese Rind|Sunflower Field|Hornet Yellow|Harvest Dust|Mustard Field|Pastry Case|Resin Bead|Cornfield Edge|Oriole|Coriander Seed|Raffia|Dune Flower|Marrow Jam|Piccalilli|Safflower|Swede Flesh|Sou'wester|Ragwort|Yellowhammer|Bakehouse|First Press|Sand Verge|Wasp Stripe|Goldfinch|Rapeseed|Dyer's Broom|Yellow Flag|Lager|Shuttle Yellow|Chamomile|Gorse Bloom|Charlock|Rice Wine|Polenta|Lemon Peel|Perry|Signal Wax|Chickpea Flour|Chaff Heap|Finch Breast|Citronella|Straw Hat|Brioche|Herb Butter|Muscat Grape|Quince Flesh|Nectar Run|Meadow Gold|Millet|Dandelion Head|Butter Bean|Nine O'Clock Sun|Lemon Rind Oil|Citron Skin|Firefly Glow|Bee Pollen|Torch Beam|Elderflower Cordial|Wheat Sheaf|Meadow Butter|Buttercup Field|Yuzu Peel|Cornmeal|Mimosa Bough|Custard Tart|Egg Custard|Semolina|Vine Sulphur|Midday Glare|Brimstone Wing|Sponge Cake|Primrose Bank|Duckling",

  /* green */
  "Wall Ivy|Savoy Cabbage|Baize Table|Glen Bottom|Hedge Bank|Casino Felt|Narrowboat Green|Trawler Green|Paddock Rail|Green Glaze|Fulling Green|Quarry Moss|Watercress|Bowling Green|Runner Bean|Downpour Leaf|Ditch Green|Vat Green|Hornbeam|Bargeware|Rose Chafer|Spinach Water|Wheel Green|Harbour Weed|Herringbone Moss|Nettle Patch|Burnside|Cliff Turf|Deck Paint|Polder|Grass Snake|Shutter Green|Fern Crook|Banana Leaf|Vetch|Fishing Net|Vine House|Millpond|Wild Garlic|Loch Shore|Gyokuro|Croft Field|Tourmaline Slice|Thrift Leaf|Green Lane|Lupin Leaf|Dock Leaf|Sencha Bowl|Skein Green|Tide Pool|Rocket Leaf|Green Woodpecker|Larder Green|Heron Reed|Parsley Stem|Nettle Tea|Lizard Flank|Fescue|Paint Kettle|Puffin Grass|Gherkin Jar|Jade Bangle|Reed Bed|Beach Hut Green|Green Flush|Sea Lettuce|Duckweed|Emerald Moth|Cut Grass|Verjus Bottle|Dairy Pasture|Cowfield|Beryl Shard|Marrow Skin|Sap Rise|Starboard Lamp|Parakeet Wing|Osier|Cloche|Samphire|Growing Tip|Katydid|Tree Frog|Dill Frond|Baler Twine|Aloe Blade|Rice Terrace|Verdure Tapestry|Succulent Leaf|Ward Green|Wicker Green|Sorrel Leaf|Crushed Mint|Lime Avenue|Hawthorn Bud|Toile Green|Peridot|Cricket Wing|Greenfinch|Withy Bed|Cucumber Peel|Green Chalcedony|Vine Tendril|Brewer's Hop|Edamame|Bramley Apple|Greenhouse Pane|Poplar Flicker|Aspen Shiver|Grazing Marsh|Willow Warbler|Pea Shoot|Absinthe Spoon|Gooseberry|Greengage|Fennel Stalk|Water Meadow|Dawn Field|Glow Worm|Organza Lime",

  /* teal */
  "Fountain Ink|Sluice Gate|Ballast Tank|Mackerel Back|Regulator Blue|Dock Water|Corrie Tarn|Diving Bell|Lathe Body|Woad Vat|Fjord Water|Copper Sulphate|Sea Wall|Bottle Glass|Anodised|Mallard Head|Cathedral Dome|Downpour|Lacquer Teal|Bench Vice|Winch Blue|Drill Press|Flooded Quarry|Freight Line|Kingfisher Bank|Locker Room|Process Cyan|Mine Water|Mill Pond|Peacock Ore|Engine Enamel|Water Polo|Shipping Lane|Tram Livery|Harbour Mouth|Solder Mask|Boathouse Door|Estuary|Toolroom|Water Butt|Buoy Paint|Bunsen Flame|Verdigris Bell|Church Roof|Shearwater|Camp Enamel|Wrasse|Aniline Teal|Chemist Bottle|Canal Lock|Mussel Rope|Tractor Cab|Pavilion Roof|Twill Blue|Oil Can|Shutter Blue|Baptistery|Spinnaker|Pier Paint|Crevasse|Wading Depth|Workshop Wall|Dinghy Hull|Switchboard|Coolant|Shallow Reef|Trawl Net|Corridor Dado|Copper Patina|Sea Holly|Counting House|Neap Tide|Carousel Paint|Gannet Dive|Hammam Tile|Apatite|Ferry Rail|Turquoise Ore|Lagoon Shelf|Fish Crate|Seafront Bench|Stamp Teal|Crane Livery|Promenade Rail|Plunge Pool|Cursor Teal|Sweet Foil|Standpipe|Screen Wash|Market Awning|Thermal Bath|Trade Bead|Vacuum Flask|Antifreeze|Dragonfly|Soapstone Teal|Net Float|Argon Tube|Lido Tile|Bandstand|Tide Line|Copperas Vat|Nurse's Tunic|Anemone|Verditer|Rock Pool|Bathing Hut|Bathing Machine|Cullet Heap|Faience|Offing|Pressed Glass|Rinse Aid|Glacier Melt|Cold Tap|Budgerigar|Bay Shallows|Soda Siphon|Meltwater|Glaze Crackle",

  /* blue */
  "Smalt|Antifoul Blue|Woad Blue|Marking Blue|Bunsen Blue|Tractor Blue|Lapis Fleck|Indigo Vat|Reservoir Blue|Sodalite|Overdye|Ultramarine Chip|Roundel Blue|Ledger Ink|Slide Stain|Beacon Blue|Mechanic Blue|Cobalt Slip|Reagent Blue|Regatta Blue|Biro Blue|Ensign Blue|Blueprint Roll|Manuscript Blue|Worsted Blue|Away Strip|Terrace Blue|Colour Bar|Blotter Blue|Chore Coat|Shibori Fold|Junction Blue|Gentian|Kit Bag|Lancet Blue|Denim Dusk|Pump Blue|Motorway Sign|Boiler Suit|Undertow|Cranesbill|Binder Blue|Delphinium|Stitch Resist|Rigger Blue|Garage Blue|Tug Blue|Indigo Rinse|Sign Glow|Lane Rope|Marginalia|Burgee Blue|Trawler Rope|Ferry Blue|Delft Rim|Anorak Blue|Clematis Blue|Flag Ripple|Pennant|Franking Blue|Jean Jacket|Dungaree Blue|Par Avion|Scaffold Blue|Crate Stencil|Nitrile Blue|Selvedge Rinse|Tarpaulin Blue|Work Shirt|Cloakroom Blue|Enamel Mug|Pilot Boat|Book Cloth|Agapanthus|Gas Ring|Speedwell|Oxford Cloth|Rosette Blue|Lab Coat Blue|Monitor Glow|Pallet Blue|Library Blue|Goggle Blue|Charge Light|Campanula|Water Main|Butcher Stripe|Wing Mirror|Runway Light|Dust Jacket|Air Mail|Filing Blue|Borage Blue|Channel Swim|Glaze Pool|Sail Cover|Cornflower Field|Dolly Blue|Cleat Blue|Bathing Cap|Scrubs Blue|Stoop Blue|Glider Blue|Exercise Book|Jay Feather|Windscreen Wash|Cabin Window|Ruled Line|Blue Ice|Jib Sheet|Saucer Blue|Veranda Blue|Squared Paper|Pool Towel|Ticking Stripe|Docket Blue|Scullery Blue|Chambray|Starch Blue|Defrost Blue",

  /* violet */
  "Gentian Ink|Indigo Carmine|Dioxazine Violet|Purple Emperor|Logwood Bath|Hollow Iris|Monkshood|Storm Lupin|Carbon Violet|Salvia Violet|Aniline Bloom|Blackcurrant Cordial|Bramble Stain|Permanganate|Copying Pencil|Ink Ribbon|Wood Bugle|Ink Bloom|Screenprint Violet|Dusk Vetch|Damson Cheese|Iolite|Whelk Purple|Ultramarine Violet|Dye Vat|Violet Enamel|Squall Violet|Overprint Violet|Plum Skin|Manganese Bloom|Bilberry|Butterfly Bruise|Bishop's Cope|Purpurite|Methyl Violet|Bottle Violet|Field Larkspur|Hedge Violet|Grain Violet|Velveteen Violet|Purple Sprouting|Marsh Violet|Tidewater Iris|Sweet Violet|Lenten Violet|Dyer's Skein|Millstone Violet|Signal Violet|Bearded Iris|Lobelia|Litho Violet|Muscari|Columbine|Chapel Glass|Wild Pansy|Heather Moor|Cudbear|Knapweed|Purple Loosestrife|Cobalt Violet|Pasque Flower|Kiln Violet|Fig Skin|Orchil Lichen|Quinacridone|Ground Ivy|Wood Betony|Mauveine Vat|Bell Heather|Hyacinth Bell|Bunting Violet|Devil's Bit|Blue Vetch|Teasel|Aubretia|Meadow Cranesbill|Twill Violet|Tweed Violet|Lupin Field|Sea Holly Bloom|Hyssop Bloom|Clematis Violet|Fair Isle Violet|Amethyst Seam|Anodised Violet|Stamp Violet|Grosgrain Violet|Corduroy Violet|Verbena|Litmus Violet|Rosette Violet|Violet Sailcloth|Bluebell Rain|Sugilite|Crocus|Self Heal|Alpine Bellflower|Cold Vetch|Damask Violet|Mudstone Violet|Salt Marsh Violet|Wisteria Cool|Chive Flower|Fluorspar Violet|Sea Lavender|Catmint|Vinca Bloom|Heliotrope|Comfrey Bell|Foxglove Bell|Buddleia|Mimeograph|Michaelmas Aster|Cambric Violet|Dame's Violet|Scabious|Honesty Bloom|Clary Bloom|Hellebore|Iodine Haze",

  /* pink */
  "Magenta Vat|Beetroot Stain|Carmine Lake|Dyer Cochineal|Pressed Cyclamen|Rosebay|Erythrite|Petal Preserve|Fuchsine|Amaranth|Offset Magenta|Cinema Curtain|Rose Opal|Cerise Ribbon|Radish Skin|Cerise Ledger|Thulite|Velveteen Pink|Rhodonite|Dahlia Head|Petunia|Pink Jasper|Lipstick Blot|Snake's Head|Pink Tourmaline|Kir Royale|Manganese Glaze|Surveyor's Pink|Fuchsia Bell|Sweet William|Seaside Rock|Rhodolite|Permanent Rose|Rhodamine|Rose Campion|Litmus Rose|Hymnal Ribbon|Trawler Twine|Archil|Tayberry|Clematis|Rose Jam|Ragged Robin|Oleander|Herb Robert|Strawberry Lace|Corncockle|Cosmos Bloom|Judas Blossom|Prize Rosette|Prickly Pear|Aniline Rose|Allium Head|Fig Cloth|Bougainvillea|Pink Spinel|Ledger Rose|Nerine|Salvia Bloom|Opera Rose|Loosestrife|Toile Pink|Busy Lizzie|Eosin Pink|Hollyhock|Phlox|Cleome|Grosgrain Pink|Cherryade|Chenille Rose|Bee Orchid|Blotter Rose|Marsh Orchid|Centaury|Sainfoin|Toadflax|Proof Rose|Bengal Rose|Hibiscus Cordial|Foxglove Pink|Betony|Enamel Rose|Musk Mallow|Restharrow|Tea Cosy Rose|Rubber Eraser|Dianthus|Trifle Layer|Jelly Shoe|Betting Slip|Sea Thrift|Milliner's Rose|Peony Head|Pink Praline|Godetia|Bath House|Pear Drop Pink|Bougainvillea Dust|Taffeta Pink|Hat Box Rose|Pink Lemonade|Pink Lustre|Plasterwork Rose|Cistus|Tutu Net|Candy Stall|Turkish Delight|Lychee Skin|Bunting Pink|Candlewick Pink|Sweet Pea|Pink Wafer|Cuttle Pink|Tea Gown|Sugar Mouse|Battenberg Pink|Holi Powder|Raspberry Vinegar|Magenta Chalk|Chalk Cyclamen",
];

/**
 * The names of one band, at most `limit` of them.
 *
 * Trimmed from the front rather than sampled again: the stride was already
 * applied when the file was written, so any prefix is as evenly spread through
 * the original card as the whole thing is.
 */
export function band(i, limit) {
  const all = BANDS[i].split('|');
  if (!limit || limit >= all.length) return all;
  if (limit === 1) return [all[0]];
  /* An even stride, not a prefix.
     This used to be `all.slice(0, limit)`, which was fine while a band was in
     no particular order. The bands are sorted dark to light now and the loader
     reads that order to match a name to the shade it lands on, so a prefix
     would hand it the darkest `limit` names and leave the pale half of every
     band unreachable — the atlas would be a third of the spectrum and the top
     of the mark would run out of names to be honest with. Striding keeps both
     ends and the distribution between them. */
  const out = [];
  for (let n = 0; n < limit; n++) out.push(all[Math.round((n * (all.length - 1)) / (limit - 1))]);
  return out;
}

/** How many names the card holds in total, for sizing the atlas against. */
export const TOTAL = BANDS.reduce((n, b) => n + b.split('|').length, 0);
