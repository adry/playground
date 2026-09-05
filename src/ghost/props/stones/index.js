// Importing this file is what puts the extra headstones into the set.
//
// Each module beside this one calls registerStone() from ../tombstones.js and
// exports nothing, so nothing references them by name and a bundler would drop
// them. This file is the one place that pulls them in, and the scene or the lab
// imports this rather than knowing the list.
//
// The order here is the order they join VARIANTS, so it is also the order the
// lab lineup shows them in. It runs small to large rather than alphabetically,
// which makes a row of them read as a family instead of a shuffle.
import '../tombstones.js';

import './heart.js';      // 1.08, the smallest
import './boulder.js';    // 1.10, a found stone with one dressed face
import './scroll.js';     // 0.93 tall, 1.46 wide, the only one wider than tall
import './ledger.js';     // lying down
import './bench.js';      // 0.81, furniture
import './book.js';       // 0.81, an open volume on a lectern wedge
import './chest.js';     // 0.85 tall and 1.63 long, a closed box tomb
import './lamb.js';       // 0.87, a child's grave, and the only animal
import './cairn.js';      // 0.90, a heap of field stones and a leaned plaque
import './kerb.js';      // a 2.35 by 0.90 plot, the largest footprint
import './sundial.js';    // 1.15, the only piece whose face points at the sky
import './urn.js';        // 1.55, pedestal and draped vessel
import './column.js';     // 1.23 to 1.38, broken
import './pyramid.js';   // 1.21, the squattest upright
import './wheel.js';      // 1.45, solid disc head
import './stump.js';     // 1.33, a stone pretending to be a sawn trunk
import './cracked.js';    // 1.32, the derelict one
import './twin.js';       // 1.48 tall, 1.32 wide, the double
import './wings.js';      // 1.54, the tall narrow one whose top is the widest
import './draped.js';     // 1.56, a pall laid over the stone
import './celtic.js';     // 1.62, ringed and pierced
import './gothic.js';     // 1.70, tallest and narrowest
import './stele.js';      // 1.73, cornice and palmette
import './vault.js';      // 1.77, the only building, and the widest footprint
import './calvary.js';    // 1.82, a cross standing on three steps
import './obelisk.js';    // 1.85, the tallest thing in the graveyard

export { VARIANTS, createTombstone } from '../tombstones.js';
