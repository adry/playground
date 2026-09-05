import * as THREE from 'three';
import { registerStone } from '../tombstones.js';
import { PALETTE } from '../style.js';
import { Profile, createSink, sinkToGeometry, latheInto } from '../fountain/lathe.js';

// A memorial sundial: a turned baluster pedestal carrying a horizontal bronze
// gnomon on a round stone dial plate.
//
// Every other piece in the set puts its interest on a VERTICAL face, which this
// camera meets at a shallow angle and squeezes. This one puts it on a
// horizontal one. That is the whole reason it is here, and it is also the one
// thing that makes it awkward to build, because the registry's inscription
// machinery is built around a face that stands up.
//
// Three decisions follow from lying the interest down, and they are the piece:
//
// 1. THE PLATE IS THE REGISTRY'S OWN SLAB, LAID FLAT. With topRadius and
//    bottomRadius both equal to halfWidth and height equal to twice it, the
//    slab builder's four corner circles collapse onto one centre and the
//    outline is an exact circle. Rotated a quarter turn about x, the carved
//    face points at the sky, and the dial gets the whole house treatment for
//    nothing: the same swept rim, the same groove with a shaded upper wall and
//    a lit lower lip, the same normal map, the same mottle. The ledger found
//    this route first. It is spelled out again here because the alternative,
//    a plate of my own with a texture of my own, is a second material, a second
//    canvas and a carving that would not match anything else in the yard.
//
//    Note what CANNOT be done that way, since the next horizontal piece will
//    want it: stripUV maps v as y/h, anchored at zero, so it can place a point
//    anywhere in the strip only by lying about y (pass h = 1 and hand it the v
//    you want, as the urn does). It cannot map a RANGE of a mesh's own height
//    into a band of the strip. On a flat horizontal plate that is worse than
//    inconvenient: every vertex on the top surface has the same y, so an honest
//    call collapses the whole plate onto one texture row, and with y near zero
//    that row is the darkest of the ground grime. The plate here never goes
//    near stripUV; it uses slabUV, the front face mapping, which is planar in
//    x and y and therefore maps the plan view correctly once the slab is tipped.
//
// 2. THE GNOMON CANNOT BE A SWEPT OUTLINE. A blade is a thin triangle, and both
//    of the registry's builders are quarter-round sweeps of a fixed rim radius
//    of 0.062: depth must be at least twice that or the side wall inverts, and
//    every convex corner needs a radius bigger than it or the corner turns
//    inside out. That floors a swept blade at 0.124 thick, and worse, at the
//    smallest legal corner the two arcs at the ends of this blade's 0.18 base
//    would need 0.195 of it, so the base is gone before the triangle is drawn.
//    So the blade is built here instead, as
//    the set of points within rho of a flat triangle. Two flat faces, a roll of
//    radius rho along each edge, a ball of it at each corner, and every normal
//    analytic. It is the same idea as the fountain's rounded box, which is a
//    box grown by a ball, applied to a polygon.
//
// 3. THE SHADOW IS THE INSTRUMENT, AND THIS SCENE IS LIT ALMOST DOWN SUN. The
//    key is fixed at (3.7, 6.0, 2.4), so where the shadow falls is arithmetic
//    rather than luck: 0.735 of the style's height, thrown along the light's own
//    azimuth, which is 237 degrees. The camera looks along 225. Twelve degrees
//    apart in azimuth and 28 in three dimensions means every prop here stands in
//    front of most of its own shadow, and a gnomon, which stands in the middle
//    of the surface its shadow lands on, hides nearly all of it. That is a fact
//    about the scene and not about this prop: no orientation escapes it, and the
//    long note on DIAL_NORTH below says what is left over and how big it is. The
//    shadow still had to be real, and the plate's diameter, the style's height
//    and the offset of the hour lines' convergence are all set so that it lands
//    on the dial rather than in the grass.

// --- proportions -----------------------------------------------------------
//
// The plate is 0.55 across and the piece stands about 1.18, so it meets the
// ghost (about 1.78 on screen) at chest height and the dial reads as something
// a person would stoop over. Widest half extent, which the layout generator
// wants, is the plate's own 0.275, or 0.30 measured on the finished prop, where
// the registry's lean tips a plate at 0.9 out by another 25 mm: the
// base is deliberately a shade narrower so the plate overhangs it and the piece
// reads as a table rather than a post.
//
// The plate went 0.52 to 0.55, the top of the range, for one reason: the rim
// roll is a fixed 0.062 whatever the plate does, so the flat top that can carry
// a dial is only what is left inside it. Six percent on the diameter is sixteen
// percent more dial.
const PLATE_R = 0.275;
const PLATE_T = 0.130; // above the sweep's 0.124 floor, and chunky on purpose
const PLATE_TOP = 0.900;
const PLATE_BOTTOM = PLATE_TOP - PLATE_T;

// The rim roll eats a fixed 0.062 all the way round, so the FLAT top, the part
// that can carry a dial without bending it over a shoulder, is only 0.426
// across. Every radius in the artwork below is measured against this and not
// against the plate.
const EDGE = 0.062;
const FLAT_R = PLATE_R - EDGE;

// Latitude of the dial. Fixed rather than seeded: the hour angles below and the
// blade's own slope have to agree, and draw() and extras() are handed the same
// rng at different points in its sequence, so neither can recover a number the
// other drew. One maker's pattern for the whole yard is the honest way to keep
// them in step.
const LAT = (50 * Math.PI) / 180;
const SIN_LAT = Math.sin(LAT);

// Where the hour lines meet, and where the style stands, as a distance SOUTH of
// the plate's centre. It is not the centre, and the reason is the shadow. The
// style's tip stands 0.225 above the plate and 0.18 north of this point, and
// the key throws 0.735 of a height horizontally, so the tip's shadow lands 0.26
// away and, at the yaw the yard sets, at a radius of 0.18 from the plate's
// middle: just inside the chapter arc at 0.187, which is where an hour mark is
// and where a dial's shadow is supposed to end. Struck from the middle of the
// plate instead, the same shadow lands at 0.256, out over the rim roll and all
// but off the plate, and the instrument is pointing at nothing.
const CENTRE_SOUTH = 0.12;

// --- the blade -------------------------------------------------------------
//
// Authored in its own plane: x north from the style's foot, y up from the top
// of the plate. The right angle is at the NORTH end and the style is the
// hypotenuse rising from the foot toward the pole, which is what a gnomon is
// and also what puts the tall edge at the far side of the plate, where it
// occludes the least of the face.
const BLADE_BASE = 0.18;
const BLADE_RISE = BLADE_BASE * Math.tan(LAT); // 0.215
// Half the thickness of the blade, and the radius of every roll and every
// corner on it, since both come out of the same ball. 0.048 makes it 0.096
// across, under the 0.13 the registry's sweeps floor a limb at, which is the
// whole reason it is built here instead: that floor is twice a fixed rim radius
// and it does not apply to geometry that is not swept. It was 0.055 first, and
// the render said no for the other reason the same number governs: at 0.055 the
// corner ball is a third of the triangle and the apex came back as a blob with
// no point on it.
const BLADE_RHO = 0.048;
// The foot is set slightly ABOVE the plate's top face so the roll of the blade
// sinks 0.038 into the stone. Well past the key's 0.006 normalBias, which is
// the depth under which a tenon makes its own host shadow itself in a dotted
// band that reads as z-fighting.
const BLADE_SINK = 0.010;

// How far the dial's north is turned off the prop's own +z. This is the one
// number on the piece chosen against the camera rather than against the
// reference, and it is worth reading the whole note before moving it.
//
// The thing to know first, because it costs a cycle to rediscover: THIS SCENE
// IS LIT ALMOST DOWN SUN. The camera looks along world azimuth 225 and the key
// throws its shadows to 237, twelve degrees apart, and the two directions are
// only 28 degrees apart in three dimensions. Every prop in this yard therefore
// hides most of its own shadow behind itself, and a sundial, whose shadow is
// cast by a blade standing at the middle of the very surface it lands on, hides
// nearly all of it. No rotation of the dial fixes that. What actually comes out
// past the blade is the far end of the shadow, clear of the blade's north edge
// by a fixed 0.15 of the blade's height, whichever way the piece is turned,
// because that overhang is the light's sideways travel and nothing else. At
// this blade's 0.27 that is a sliver about 40 mm wide. It reads as a soft dark
// edge alongside the blade rather than as a pointer, and it is honest: a dial
// photographed with the sun behind the photographer looks exactly like this.
//
// What the angle CAN buy is the blade's own silhouette. Turned so the dial's
// north runs to world azimuth 315, square across the line of sight, the blade
// shows its whole triangle; turned toward 225 it is edge on and reads as a dark
// bar with the gnomon gone out of it. 78 degrees puts north at 315 at the yard's
// nominal quarter turn, where the blade shows 98 percent of its width, and over
// the whole spread of yaws the layout actually uses, PI/4 minus 0.88 to plus
// 0.66, it never drops below 46 percent. The compensation at that worst yaw is
// that the plate is then fully open to the camera and the fan reads at its best,
// so the piece never loses both of its two readings at once.
//
// The dial reads about five in the afternoon, which is as good an hour as any to
// be dead.
const DIAL_NORTH = (78 * Math.PI) / 180;

// The plate is turned a further half turn about its own axis so that the
// texture's ground grime band, which lives along the BOTTOM of the face canvas
// and cannot be switched off from a registration, lands on the far edge of the
// dial rather than the near one. On an upright stone that band is the dirt it
// stands in. On a plate at chest height it is just a gradient, and it belongs
// where the eye visits least.
const GRIME_AWAY = true;
const SX = GRIME_AWAY ? -1 : 1; // artwork sign that follows that half turn

// --- the dial face ---------------------------------------------------------
//
// Drawn in dial coordinates: world units, origin at the centre of the plate,
// x east, y north. One transform below puts them on the canvas, and the half
// turn above is a single sign in it.
//
// The hour angle. tan(line) = sin(latitude) * tan(15 degrees per hour), taken
// through atan2 so the six o'clock lines, where the tangent runs off to
// infinity, and the early and late lines that fold past ninety degrees, all
// come out without a special case.
function hourAngle(h) {
  const H = (h * 15 * Math.PI) / 180;
  return Math.atan2(SIN_LAT * Math.sin(H), Math.cos(H));
}

// Radii, as fractions of the flat top. Nothing reaches past 0.88 of it. The
// first pass ran the lines out to 0.94 and thickened their last fifth into a
// chapter band, and from above that read as a ring of fat spikes with their
// ends bending over the shoulder of the roll: the rim of this plate is a
// bullnose of the registry's fixed 0.062, so the last eighth of the flat top is
// already turning away from the sky.
const R_RIM = 0.88; // outer end of the hour lines
const R_ARC = 0.88; // the chapter arc they all end on
const R_MERIDIAN = 0.955; // the noon lozenge, alone out past the arc
// Three-hour lines carry more weight than the rest, which is how a real dial is
// read at a glance and, here, how the fan keeps a structure once it is small
// enough that the individual lines have stopped resolving.
const PRINCIPAL = [-6, -3, 0, 3, 6];
const W_HOUR = 0.0032;
const W_PRINCIPAL = 0.0058;
const W_ARC = 0.0030;
// The lines stop short of their own convergence. The blade stands on that patch
// and its shadow lies across it, so a thirteen line star under them is ink that
// nobody ever sees and every one of those lines is paid for twice, once in the
// budget and once in the mush.
const START = 0.085;

// The dial artwork. Exported for one reason only, the same reason the chest
// tomb exports its mark: the only way to weigh a carving is to draw it on a
// bare canvas and count the pixels.
//
// WHY THERE IS NO LETTERING ON IT. This was the piece's open question and it
// took three measured passes to close, so the numbers are here rather than in a
// note nobody keeps.
//
// Twelve numerals never had a chance: at the set's own letter height the ring
// they sit on has a radius of 0.13, so 0.82 of a world unit of circumference,
// and thirteen numerals from VI round to VI want about 1.25 of it. They overlap
// before they are drawn.
//
// Three at 0.072, the brief's own fallback, were drawn and rendered from
// straight overhead at five hundred pixels, which is a good deal kinder than
// anything this prop ships at. XII and the two VIs came back as illegible
// scribbles that made the middle of the plate look dirty, and they cost four
// points of the ink budget to do it.
//
// One XII at the set's real letter height, which is a font size of about 0.13
// since a cap is roughly seven tenths of it, then failed on geometry rather
// than on legibility, and this is the measurement worth keeping: a XII that
// tall is 0.17 wide, and where it would sit, a quarter of a unit out from the
// convergence, the eleven and one o'clock lines are 12 degrees either side of
// it and 0.104 apart. The numeral is half again as wide as the whole gap it has
// to live in. Stopping every line short to clear a pocket for it takes a 60
// degree bite out of the top of the fan, which is the part of the dial the eye
// actually lands on.
//
// So: no letters. The hours are carried by their LINES, which are radial marks
// and lose nothing by being small, and the one non-linear mark on the face is a
// lozenge on the meridian, where the style points and where the shadow arrives.
export function drawDial(ctx, S, rng) {
  const cx = S / 2;
  const cy = S / 2;
  // The canvas is the plate's bounding square, so half of it is the radius.
  const PPU = S / 2 / PLATE_R;
  const px = (x, y) => [cx + SX * x * PPU, cy - SX * y * PPU];

  // The convergence point, in dial coordinates.
  const C = [0, -CENTRE_SOUTH];
  const rimR = FLAT_R * R_RIM;

  // Distance along a ray from C, in direction d, out to radius r about the
  // PLATE's centre. C is off centre, so every hour line is a different length
  // and this is the only honest way to end them all on one circle.
  const reach = (d, r) => {
    const b = C[0] * d[0] + C[1] * d[1];
    const c = C[0] * C[0] + C[1] * C[1] - r * r;
    return -b + Math.sqrt(Math.max(0, b * b - c));
  };
  const at = (d, t) => [C[0] + d[0] * t, C[1] + d[1] * t];

  const stroke = (d, t0, t1, wWorld) => {
    const [x0, y0] = px(...at(d, t0));
    const [x1, y1] = px(...at(d, t1));
    ctx.lineWidth = wWorld * PPU;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };

  ctx.strokeStyle = '#000000';
  ctx.fillStyle = '#000000';

  // Hour lines, six in the morning to six at night, all struck from the style's
  // own foot because that is what a horizontal dial is: nothing on the face
  // means anything except as an angle from that point.
  const ends = [];
  for (let h = -6; h <= 6; h++) {
    // Hand cut and not machine cut. A fraction of a degree on the angle and a
    // hair on the outer end, which is invisible line by line and is also the
    // only thing that makes two castings of this face differ pixel for pixel.
    // The cracked stone's postmortem asks every registered stone for that: its
    // lean varied per seed and its crack did not, and two of them side by side
    // made it obvious.
    const a = hourAngle(h) + (rng() - 0.5) * 0.016;
    const d = [Math.sin(a), Math.cos(a)];
    const w = PRINCIPAL.includes(h) ? W_PRINCIPAL : W_HOUR;
    stroke(d, START, reach(d, rimR * (1 + (rng() - 0.5) * 0.03)), w);
    ends.push(at(d, reach(d, FLAT_R * R_ARC)));
  }

  // The chapter arc: one thin circle about the PLATE's centre, through the
  // outer end of every hour line, drawn only over the half of the plate the
  // fan reaches. Without it the thirteen lines read as a starburst scratched
  // into the stone; with it they read as an instrument, because a scale is a
  // set of marks against a datum and this is the datum.
  {
    const r = FLAT_R * R_ARC * PPU;
    ctx.lineWidth = W_ARC * PPU;
    ctx.beginPath();
    // The arc runs the long way round, from one six o'clock end through north
    // to the other, so the gap in it sits in the empty crescent south of the
    // convergence where there is nothing to join up. Canvas y runs down and the
    // half turn may flip the whole face, so the angles are taken from points
    // that have already been through the mapping rather than from dial ones.
    const m0 = px(...ends[0]);
    const m1 = px(...ends[ends.length - 1]);
    const a0 = Math.atan2(m0[1] - cy, m0[0] - cx);
    const a1 = Math.atan2(m1[1] - cy, m1[0] - cx);
    // Which way round is the long way is decided by where north lands, not
    // assumed: the mapped noon end is on the arc that has to be kept.
    const mid = px(...ends[6]);
    const am = Math.atan2(mid[1] - cy, mid[0] - cx);
    const between = (s, e, t) => {
      const w0 = ((e - s) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      const wt = ((t - s) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      return wt < w0;
    };
    ctx.arc(cx, cy, r, a0, a1, !between(a0, a1, am));
    ctx.stroke();
  }

  // The meridian mark: one small lozenge on the noon line, out past the arc
  // where nothing else goes. It is the only mark on the face that is not a
  // straight line and it is where the style points.
  {
    const d = [Math.sin(hourAngle(0)), Math.cos(hourAngle(0))];
    const t = reach(d, FLAT_R * R_MERIDIAN);
    const L = 0.030;
    const Wd = 0.015;
    const n = [d[1], -d[0]];
    const p = (u, v) => px(C[0] + d[0] * (t + u) + n[0] * v, C[1] + d[1] * (t + u) + n[1] * v);
    ctx.beginPath();
    ctx.moveTo(...p(L / 2, 0));
    ctx.lineTo(...p(0, Wd / 2));
    ctx.lineTo(...p(-L / 2, 0));
    ctx.lineTo(...p(0, -Wd / 2));
    ctx.closePath();
    ctx.fill();
  }
}

// --- the pedestal ----------------------------------------------------------
//
// One lathe from the axis under the foot to the axis on top of the cap, which
// is the fountain's own rule: a closed profile is one watertight surface with
// continuous normals, where a stack of primitives is a stack of creases. It
// also settles the thing LatheGeometry gets wrong for this job, which is that
// it has no end caps at all: run to the axis at both ends and the caps are part
// of the same sweep, with the normals the profile implies rather than none.
//
// The turning is a baluster: a wide low base, a cove into a waist at a fifth of
// the height, a belly at a third, a long taper to a neck, and a collar under
// the flare that takes the plate. The waist is 0.196 across, which keeps every
// limb on the piece over the set's 0.13 floor even though nothing here is swept.
function pedestalProfile(k) {
  const P = new Profile();
  P.moveTo(0, 0);
  P.lineTo(0.200, 0, 4);
  P.arc(0.200, 0.038, 0.038, -Math.PI / 2, 0, 6);
  P.lineTo(0.238, 0.064, 2);
  P.arc(0.200, 0.064, 0.038, 0, Math.PI / 2, 6);
  P.curve([[0.172, 0.112], [0.160, 0.142]], 6);
  P.lineTo(0.158, 0.166, 2);
  P.curve([[0.146, 0.190], [0.122, 0.215], [0.110, 0.250]], 7);
  P.curve([[0.124, 0.305], [0.146, 0.352], [0.150, 0.398]], 10);
  P.curve([[0.142, 0.468], [0.122, 0.545], [0.106, 0.612]], 10);
  P.curve([[0.098, 0.664], [0.100, 0.694]], 5);
  P.curve([[0.124, 0.720], [0.134, 0.734]], 5);
  P.curve([[0.160, 0.760], [0.172, 0.790]], 6);
  P.lineTo(0.176, PLATE_BOTTOM - 0.010, 2);
  P.arc(0.150, PLATE_BOTTOM - 0.010, 0.026, 0, Math.PI / 2, 5);
  P.lineTo(0, PLATE_BOTTOM + 0.016, 3);
  // The whole turning is stretched by the casting's height factor, corner rolls
  // and all. A four percent oval on a 38 mm roll is nothing, and the
  // alternative, scaling only the shaft, moves the joints instead of the piece.
  const pts = P.build();
  if (k !== 1) for (const q of pts) q.y *= k;
  return pts;
}

// --- the blade -------------------------------------------------------------
//
// Every point within rho of a flat convex polygon. Cross section at height s
// through the thickness is the polygon grown outward by sqrt(rho^2 - s^2), and
// growing a convex polygon outward is its own edges pushed out plus an arc of
// that radius centred on each vertex, so the whole surface is one grid: rings
// of arcs, joined by the straight runs between them, from the back face round
// to the front. Nothing is averaged and nothing is triangulated except the two
// flat faces, which are the polygon itself.
function bladeGeometry({ poly, rho, arcSeg = 5, rollSeg = 8 }) {
  const n = poly.length;
  // Outward edge normals. The polygon is counter clockwise, so the outward
  // normal of the edge from i to i+1 is its direction turned right.
  const en = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    en.push([(b[1] - a[1]) / L, -(b[0] - a[0]) / L]);
  }
  // The arc at vertex i runs from the normal of the edge arriving at it to the
  // normal of the edge leaving it, always turning the short way and always
  // outward, which for a convex polygon is counter clockwise.
  const spans = [];
  for (let i = 0; i < n; i++) {
    const p = en[(i + n - 1) % n];
    const q = en[i];
    let a0 = Math.atan2(p[1], p[0]);
    let a1 = Math.atan2(q[1], q[0]);
    while (a1 < a0) a1 += Math.PI * 2;
    spans.push([a0, a1]);
  }

  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  const ringN = n * (arcSeg + 1);
  for (let k = 0; k <= rollSeg; k++) {
    const s = -Math.PI / 2 + (k / rollSeg) * Math.PI;
    const w = rho * Math.cos(s);
    const z = rho * Math.sin(s);
    for (let i = 0; i < n; i++) {
      const [a0, a1] = spans[i];
      for (let j = 0; j <= arcSeg; j++) {
        const a = a0 + (a1 - a0) * (j / arcSeg);
        const dx = Math.cos(a);
        const dy = Math.sin(a);
        pos.push(poly[i][0] + w * dx, poly[i][1] + w * dy, z);
        nor.push(dx * Math.cos(s), dy * Math.cos(s), Math.sin(s));
        uv.push(0.5, 0.5);
      }
    }
  }
  for (let k = 0; k < rollSeg; k++) {
    for (let j = 0; j < ringN; j++) {
      const j2 = (j + 1) % ringN;
      const a = k * ringN + j;
      const b = k * ringN + j2;
      const c = (k + 1) * ringN + j2;
      const d = (k + 1) * ringN + j;
      idx.push(a, c, b, a, d, c);
    }
  }
  // The two flat faces. At the ends of the roll the growth is zero, so those
  // rings ARE the polygon with every vertex repeated, and a fan from the
  // centroid closes each one without a vertex of its own beyond the hub.
  let gx = 0;
  let gy = 0;
  for (const p of poly) {
    gx += p[0] / n;
    gy += p[1] / n;
  }
  for (const side of [-1, 1]) {
    const ring = side < 0 ? 0 : rollSeg;
    const hub = pos.length / 3;
    pos.push(gx, gy, side * rho);
    nor.push(0, 0, side);
    uv.push(0.5, 0.5);
    for (let j = 0; j < ringN; j++) {
      const j2 = (j + 1) % ringN;
      const a = ring * ringN + j;
      const b = ring * ringN + j2;
      if (side > 0) idx.push(hub, a, b);
      else idx.push(hub, b, a);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

// Bronze. The same move the lanterns make for iron, which is the only other
// metal in this scene and the one place the no-environment-map problem has
// already been solved: what reads as metal here is being much darker than the
// stone beside it, not being shiny. The palette's stone taken to a little under
// half its value and tilted warm rather than the lanterns' cool, so a dial
// plate fitting reads as cast bronze and not as a second piece of their
// ironwork. Their own 0.42 came back as chocolate at this size, with no light
// left in it to tell the two faces of the wedge apart, so it is 0.47 here.
//
// The PLATE is not bronze, and that was tested rather than assumed. A dark
// plate is what a real memorial dial has, and it takes two things away at once:
// the engraved fan, which works by being darker than the stone it is cut into,
// and the shadow, which works the same way. Both need a pale ground. So the
// bronze is the blade alone, which is also the only part of a real dial that is
// always metal.
const BRONZE = (() => {
  const c = new THREE.Color(PALETTE.stone);
  const s = c.getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
  const V = 0.47;
  const TILT = [1.24, 1.0, 0.72];
  return c.setRGB(s.r * V * TILT[0], s.g * V * TILT[1], s.b * V * TILT[2], THREE.SRGBColorSpace);
})();

registerStone('sundial', {
  // height is twice halfWidth and both radii are halfWidth, which is what turns
  // the slab builder's rounded rectangle into an exact circle: all four corner
  // centres land on one point. plinth 0 because the registry's plinth is a
  // rounded bar the width of the stone, and what this piece stands on is a
  // turned base that has to be part of the pedestal's own lathe.
  shape: { halfWidth: PLATE_R, height: PLATE_R * 2, depth: PLATE_T, plinth: 0 },
  topRadius: PLATE_R,
  bottomRadius: PLATE_R,

  draw(ctx, w, h, rng) {
    drawDial(ctx, h, rng);
  },

  extras({ body, slab, material, rng, lean, disposables, stripUV }) {
    // How tall this casting is. The plate and the blade are the same on every
    // one of them, so the only thing that can differ at fifty pixels is the
    // pedestal's height, and a row of four seeds with nothing but a lean
    // between them reads as one asset stamped four times.
    const k = 0.955 + rng() * 0.09;
    const plateBottom = PLATE_BOTTOM * k;
    const plateTop = plateBottom + PLATE_T;
    // --- the plate ----------------------------------------------------------
    //
    // Tipped a quarter turn about x so the carved face points at the sky, then
    // a half turn about the new vertical to put the grime band on the far edge,
    // then the dial's own north. The slab is built from y = 0 to y = height
    // with its circle centred half way up, so it is moved by where that centre
    // lands rather than by an offset worked out by hand.
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    if (GRIME_AWAY) q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    const north = DIAL_NORTH + (rng() - 0.5) * 0.16;
    const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), north);
    q.premultiply(spin);
    slab.quaternion.copy(q);
    const centre = new THREE.Vector3(0, PLATE_R, 0).applyQuaternion(q);
    slab.position.set(-centre.x, plateBottom + PLATE_T / 2 - centre.y, -centre.z);

    // --- the pedestal -------------------------------------------------------
    const sink = createSink();
    // 38 rather than the house 48. On a shaft 0.3 across at the size this prop
    // is seen, a facet is under a millimetre off the true circle, and the lathe
    // is already the most expensive thing on the piece.
    latheInto(sink, { profile: pedestalProfile(k), segments: 38 });

    // A lathe's own UVs are a cylindrical wrap, which over the shared material
    // would drag the dial round the outside of the shaft. Every vertex is
    // parked in the plain strip instead, u swept round the piece and v climbing
    // it. Unlike the urn, this one starts on the ground, so v starts low and
    // the foot picks up the grime band the map already carries.
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 1; i < sink.pos.length; i += 3) {
      if (sink.pos[i] < lo) lo = sink.pos[i];
      if (sink.pos[i] > hi) hi = sink.pos[i];
    }
    const span = Math.max(1e-4, hi - lo);
    for (let i = 0, j = 0; i < sink.pos.length; i += 3, j += 2) {
      const x = sink.pos[i];
      const z = sink.pos[i + 2];
      const r = Math.hypot(x, z) || 1;
      const [u, v] = stripUV(x / r, 0.05 + 0.55 * ((sink.pos[i + 1] - lo) / span), 1, 1);
      sink.uv[j] = u;
      sink.uv[j + 1] = v;
    }
    const pedGeo = sinkToGeometry(sink);
    const pedestal = new THREE.Mesh(pedGeo, material);
    pedestal.castShadow = true;
    pedestal.receiveShadow = true;
    disposables.push(pedGeo);
    body.add(pedestal);

    // --- the gnomon ---------------------------------------------------------
    //
    // Authored in its own plane, x north from the style's foot and y up, then
    // stood in the meridian: a quarter turn about y puts that plane's x onto
    // the dial's north, and the dial's own north follows.
    const bladeGeo = bladeGeometry({
      poly: [
        [0, 0],
        [BLADE_BASE, 0],
        [BLADE_BASE, BLADE_RISE],
      ],
      rho: BLADE_RHO,
    });
    const bronze = new THREE.MeshStandardMaterial({
      color: BRONZE,
      // Below the house 0.82, the same allowance the lanterns' ironwork gets:
      // one broad soft highlight is what stops a dark casting going flat black
      // against the pale stone under it.
      roughness: 0.58,
      metalness: 0.0,
    });
    const blade = new THREE.Mesh(bladeGeo, bronze);
    blade.quaternion.copy(spin).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
    blade.position.copy(new THREE.Vector3(0, plateTop + BLADE_SINK, CENTRE_SOUTH).applyQuaternion(spin));
    blade.castShadow = true;
    blade.receiveShadow = true;
    disposables.push(bladeGeo, bronze);
    body.add(blade);

    // The lean stands, because a dial set on a lawn a century ago is never
    // level and the piece is the one in the set that says so out loud: the
    // plate is a horizontal plane and the eye reads a degree of tilt on it that
    // it would never see on an upright face. The sink goes deeper than the
    // registry's own by 8 mm, which is what the lean lifts the far side of a
    // 0.5 base by. Under it the foot floats on the side the lean raises.
    lean.sink -= 0.008;
  },
});
