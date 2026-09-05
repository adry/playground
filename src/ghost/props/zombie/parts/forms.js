import * as THREE from 'three';

// The zombie's surface vocabulary. CLEAN VOLUMES ONLY.
//
// This file replaces `parts/skin.js` from the third pass, and the reason it
// exists at all is the shape of that pass's failure, recorded in
// ../POSTMORTEM.md. That build was ONE parametric shell with every feature
// carved into it: the sockets, the nasal aperture and the mouth were recesses
// pressed into the head's own grid, and the dark was painted on by keeping
// different quads of that grid. Every feature then fought the grid, and the
// postmortem's whole second section is the bill: staircased boundaries, a
// surface that folded over itself, normals disagreeing across a zone edge, and
// five constructions for one eye socket.
//
// None of those failures is a failure of care. They are all the same failure:
// two things measured against one shared parameterisation, disagreeing.
//
// So there is no shared parameterisation here. The vocabulary is closed
// volumes, and the ONE structural idea that makes the head work is this:
//
//   ============================================================
//   A FEATURE IS DEFINED RADIALLY AGAINST THE HOST'S OWN RADIUS
//   FUNCTION, NOT AGAINST AN INVERSE OF IT.
//   ============================================================
//
// `closedRadial` builds a volume that is STAR-SHAPED about its own centre:
// its surface is `dir * R(dir)` for a smooth positive R. Every feature that
// sits in such a volume -- a socket, the nasal aperture, the mouth, the chest
// window -- is built by `grommet`, which evaluates THE SAME R at THE SAME
// direction and offsets along that ray:
//
//     dish point  =  dir * (R(dir) - sink),   sink >= 0
//     rim  point  =  dir * (R(dir) + jut)
//
// Three of the postmortem's hardest problems stop existing at that line:
//
//  * The dish cannot escape the host. It is at or inside the host's surface
//    along its own ray, for every direction, by construction. Failure 4 in
//    section 2.1 was a bowl whose silhouette left the head once the walk
//    turned it twenty degrees; this one provably cannot, at any rotation,
//    because the containment is a property of the geometry and not of a
//    viewing angle. `assertInsideRadial` checks it rather than trusting it.
//
//  * The dish cannot disagree with the host by a fraction of a millimetre.
//    Failures 2 and 3 reached the surface through `frontUV`, an INVERSE of
//    the base ellipsoid, while the shell had a brow, a cheek, a crown swell
//    and three octaves of lumps on top of that. Here nothing is inverted:
//    the direction is constructed first and R is evaluated on it. There is
//    no second opinion to disagree with.
//
//  * There are NO COLOUR ZONES INSIDE ONE SURFACE. Every material boundary on
//    this model is a real geometric edge between two separate volumes, so
//    section 2.2's whole family of problems -- the zone predicate flipping
//    across a band of cells, the comb edge, the two zones computing different
//    normals along a shared boundary -- has nowhere to occur. The host's own
//    cut is ragged at grid resolution, and the rim band is cut LARGER than
//    the cut and covers it, which is exactly how the chest cavity's lip
//    ribbon works and the one construction the postmortem says to lift
//    wholesale.
//
// WINDING. Section 2.3: the old vocabulary wound every surface inside out and
// a closed shape hid it completely. Rather than reason about it, a hole was
// cut in a test sphere before a line of this file was written. In THIS
// parameterisation -- v running from the +Y pole down to the -Y pole, u the
// azimuth -- the quad order (i,j) (i+1,j) (i+1,j+1) (i,j+1) gives OUTWARD
// normals. `assertOutward` re-checks it on every closed volume at build time,
// because section 2.2 also records a fix that was reported and had not landed.
//
// NO ALPHA ANYWHERE. There is no environment map in this scene, so a card has
// nothing to reflect. Every torn edge and every hole is geometry.

// VALUE FIRST, HUE SECOND.
//
// The ghost is white and the skeleton is bone, and both are loved because you
// can read them as a shape from across the room. At 105 px hue does almost
// nothing; what the eye resolves is a light mass, a dark mass and where the
// boundary between them is.
//
// So this figure is three values and that is all: a LIGHT head, a DARK coat,
// DARK boots, with light green limbs between them. The head is the brightest
// thing on it, because the head is the character. Every earlier pass had the
// cloth within a few per cent of the skin's value and the torso came out as
// one mottled area, which is what "muddy" meant.
//
// Nine colours, down from sixteen. Everything the deletions took with them --
// the muscle, the jacket lining, the shorts, the ear shadow -- is gone from
// here too, because a palette entry nobody uses is a suggestion to use it.
export const PALETTE = {
  // Pale sick green, and lighter than it was. It has to hold its own beside a
  // white sheet without going grey, and it has to be light enough that two
  // sunken sockets read as holes in it at 105 px.
  skin: '#a6c47f',
  // The coat and the boots are the other two rungs of a THREE-STEP LADDER, and
  // the steps have to be even. Relative luminance against the skin:
  //
  //     skin  1.00     coat  0.59     boot  0.22
  //
  // The coat spent one round at 0.36, which is nearly the boots, and the
  // effect was not a dark mass but a VOID: the garment lost all its own form,
  // every fold and edge in it went to the same black, and the figure read as a
  // head and two legs with a hole between them. A mass needs to be dark enough
  // to separate and light enough to still be shaded.
  jacket: '#6b7060',
  boot: '#2b2825',
  bootSole: '#1d1b19',
  // NOT BLACK. Flat black in a big round socket is a Roswell grey, not a
  // corpse. Dark red-purple is what is in an empty orbit, it takes the key
  // light as a colour rather than as a value, and it ties the sockets to the
  // wound.
  socket: '#48222f',
  socketDeep: '#24111a',
  flesh: '#6e2f2b',
  bone: '#ddd2b8',
  tooth: '#efe8d2',
  nail: '#2e251d',
};

export function zombieMaterials() {
  const mk = (color, roughness = 0.86) => new THREE.MeshStandardMaterial({
    color: new THREE.Color(color), roughness, metalness: 0.0,
  });
  return {
    skin: mk(PALETTE.skin, 0.90),
    jacket: mk(PALETTE.jacket, 0.95),   // cloth, the roughest thing on the model
    boot: mk(PALETTE.boot, 0.82),
    bootSole: mk(PALETTE.bootSole, 0.90),
    socket: mk(PALETTE.socket, 1.0),
    socketDeep: mk(PALETTE.socketDeep, 1.0),
    flesh: mk(PALETTE.flesh, 0.74),
    bone: mk(PALETTE.bone, 0.74),
    tooth: mk(PALETTE.tooth, 0.58),
    nail: mk(PALETTE.nail, 0.66),
  };
}

export function disposeMaterials(mats) { for (const m of Object.values(mats)) m.dispose(); }

// --- small helpers ------------------------------------------------------------

export const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
export const mix = (a, b, t) => a + (b - a) * t;
export function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
// A smooth hump, 0 outside [a, b], 1 at the middle. Used wherever a shape
// modifier has to act over a band and vanish cleanly at both ends -- which is
// how the crown swell and the jaw taper avoid moving the crown and the chin
// off their landmark heights.
export function hump(a, b, x) {
  const m = (a + b) / 2;
  return x < m ? smoothstep(a, m, x) : smoothstep(b, m, x);
}

export function geoFrom(points, indices) {
  const g = new THREE.BufferGeometry();
  const arr = new Float32Array(points.length * 3);
  for (let i = 0; i < points.length; i++) {
    arr[i * 3] = points[i].x; arr[i * 3 + 1] = points[i].y; arr[i * 3 + 2] = points[i].z;
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

export function put(parent, geometry, material, { pos = null, rot = null, scale = null, name = '' } = {}) {
  const m = new THREE.Mesh(geometry, material);
  if (pos) m.position.copy(pos);
  if (rot) m.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);
  if (scale) { if (typeof scale === 'number') m.scale.setScalar(scale); else m.scale.copy(scale); }
  if (name) m.name = name;
  parent.add(m);
  return m;
}

// Move a node's origin to the centre of what it holds, without moving the
// geometry a millimetre in world space.
//
// This is for the SHED pieces. The contract says each detachable piece is "a
// self-contained subtree whose world transform is meaningful when reparented",
// and a rib node parked at the chest joint is not: reparent it and let it
// tumble and it swings about a point 100 mm away from the rib, which reads as
// the rib being flung on a string. Recentred, it tumbles about itself.
export function recentre(node) {
  const box = new THREE.Box3();
  const p = new THREE.Vector3();
  const meshes = node.children.filter((c) => c.isMesh);
  if (!meshes.length) return;
  for (const m of meshes) {
    m.updateMatrix();
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) box.expandByPoint(p.fromBufferAttribute(pos, i).applyMatrix4(m.matrix));
  }
  const c = box.getCenter(new THREE.Vector3());
  for (const m of meshes) m.position.sub(c);
  node.position.add(c);
}

export function triangleCount(object3D) {
  let n = 0;
  object3D.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    n += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
  });
  return n;
}

// --- the assertions ----------------------------------------------------------
//
// Both of these exist because of POSTMORTEM 2.2: "a reported fix is not a
// landed fix. Grep for the symbol afterwards, or assert it." They run at build
// time, cost microseconds, and throw.

// Every vertex normal points away from the volume's own centre. This is the
// standing check against the winding trap of section 2.3, which cost the last
// build most of its duration because a closed shape conceals it perfectly.
export function assertOutward(geometry, centre, name) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  let inward = 0;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).sub(centre);
    n.fromBufferAttribute(nor, i);
    const len = p.length();
    if (len < 1e-9) continue;                 // a pole vertex on the centre line
    if (p.dot(n) / len < -1e-4) inward++;
  }
  // A dented surface legitimately has a few vertices whose normal leans back
  // toward the centre, so the test is on the BULK, not on every vertex.
  if (inward > pos.count * 0.12) {
    throw new Error(`zombie/forms: '${name}' is wound inside out (${inward}/${pos.count} vertices face inward). See POSTMORTEM 2.3.`);
  }
}

// Every vertex of a feature is at or inside the host's own radial surface.
//
// This is the guarantee that replaces four rounds of tuning in POSTMORTEM 2.1.
// A dish built as `dir * (R(dir) - sink)` cannot escape its host for any sink
// >= 0, so this can only fail if the construction stops being radial -- which
// is precisely the class of edit that broke the last build without saying so.
export function assertInsideRadial(geometry, centre, R, name, slack = 1e-6) {
  const pos = geometry.attributes.position;
  const p = new THREE.Vector3();
  let worst = -Infinity, worstAt = null;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).sub(centre);
    const len = p.length();
    if (len < 1e-9) continue;
    const over = len - R(p.clone().divideScalar(len));
    if (over > worst) { worst = over; worstAt = p.clone(); }
  }
  if (worst > slack) {
    throw new Error(
      `zombie/forms: '${name}' pokes ${worst.toFixed(5)} outside its host at ` +
      `(${worstAt.x.toFixed(3)}, ${worstAt.y.toFixed(3)}, ${worstAt.z.toFixed(3)}). ` +
      `A feature dish must be dir*(R(dir) - sink) with sink >= 0. See POSTMORTEM 2.1 failure 4.`);
  }
  return worst;
}

// --- closedRadial -------------------------------------------------------------
//
// A closed volume that is STAR-SHAPED about its own centre: the surface is
// `dir * R(dir)`. Everything on this model that has a feature set into it --
// the cranium, the chest -- is one of these, because star-shapedness is what
// makes the containment guarantee above a one-line proof.
//
// `skip(dir)` is called at each quad's CENTRE DIRECTION; return true to omit
// the quad. The resulting hole is ragged at grid resolution and is meant to
// be: a grommet's rim band is cut larger than the hole and covers it. That is
// the chest cavity's lip-ribbon trick, and it is the only honest way to cut a
// smooth outline out of a quad grid without conforming the mesh to it.
//
// Poles are real fans off a single vertex rather than a degenerate row, so
// there are no zero-area triangles and no black speck at the crown.
// Concentrate grid samples around `at`. The map is
//     f(t) = t - (k / 2pi) sin(2pi (t - at))
// whose derivative is 1 - k cos(2pi (t - at)), so at `at` the step is (1 - k)
// of uniform and the local density is 1 / (1 - k).
//
// u is periodic and can use this directly. v is NOT: it runs pole to pole, and
// the raw map shifts BOTH ENDS, which pushes v past 1 at the crown and folds
// the mesh back over the top pole. Subtracting f(0) pins both ends exactly,
// because f(1) - f(0) is identically 1. (POSTMORTEM notes the same trap; it is
// a property of the warp, not of what it is used for.)
//
// Used here for ONE thing only: the size of the cells a feature's hole is cut
// out of. There is no zone painting on this model and no predicate deciding
// which side of an outline a quad falls on, so none of the rest of section 2.2
// applies -- the warp cannot make a boundary comb, because there is no
// boundary on this surface to comb.
export function concentrate(k, at) {
  const f = (t) => t - (k / (2 * Math.PI)) * Math.sin(2 * Math.PI * (t - at));
  const f0 = f(0);
  return (t) => f(t) - f0;
}

export function closedRadial({ uSteps = 64, vSteps = 40, R, skip = null, uAt = null, vAt = null }) {
  const dirs = [];
  const pts = [];
  const rings = vSteps - 1;                    // interior latitude rings
  const uOf = uAt || ((x) => x);
  const vOf = vAt || ((x) => x);
  const dirAt = (i, j) => {
    const a = 2 * Math.PI * uOf((((i % uSteps) + uSteps) % uSteps) / uSteps);
    const t = Math.PI * vOf((j + 1) / vSteps);
    return v3(Math.sin(t) * Math.cos(a), Math.cos(t), Math.sin(t) * Math.sin(a));
  };
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < uSteps; i++) {
      const d = dirAt(i, j);
      dirs.push(d);
      pts.push(d.clone().multiplyScalar(R(d)));
    }
  }
  const top = v3(0, 1, 0), bot = v3(0, -1, 0);
  const iTop = pts.length; pts.push(top.clone().multiplyScalar(R(top)));
  const iBot = pts.length; pts.push(bot.clone().multiplyScalar(R(bot)));

  const at = (i, j) => (j * uSteps) + (((i % uSteps) + uSteps) % uSteps);
  // The centre direction of a quad, for the skip test. Normalised, so the
  // predicate is a pure function of direction and cannot be confused by the
  // radius the quad happens to sit at.
  const quadDir = (i, j0, j1) => {
    const d = new THREE.Vector3();
    d.add(dirAt(i, j0)).add(dirAt(i + 1, j0)).add(dirAt(i + 1, j1)).add(dirAt(i, j1));
    return d.normalize();
  };
  const idx = [];
  for (let j = 0; j < rings - 1; j++) {
    for (let i = 0; i < uSteps; i++) {
      if (skip && skip(quadDir(i, j, j + 1))) continue;
      const A = at(i, j), B = at(i + 1, j), C = at(i + 1, j + 1), D = at(i, j + 1);
      idx.push(A, B, C, A, C, D);            // OUTWARD; see the winding note above
    }
  }
  // pole fans
  const poleDir = (i, pole) => {
    const d = pole.clone().add(dirAt(i, pole.y > 0 ? 0 : rings - 1)).add(dirAt(i + 1, pole.y > 0 ? 0 : rings - 1));
    return d.normalize();
  };
  for (let i = 0; i < uSteps; i++) {
    if (!skip || !skip(poleDir(i, top))) idx.push(iTop, at(i + 1, 0), at(i, 0));
    if (!skip || !skip(poleDir(i, bot))) idx.push(iBot, at(i, rings - 1), at(i + 1, rings - 1));
  }
  const g = geoFrom(pts, idx);
  g.userData.dirs = dirs;
  return g;
}

// --- grommet ------------------------------------------------------------------
//
// A feature set into a `closedRadial` host: an eye socket, the nasal aperture,
// the mouth, the chest window. Two surfaces, both defined against the host's
// own R, so neither can drift against it or against the other.
//
//   dish  rho in [0, rhoIn]      dir * (R(dir) - sink(s))      s = rho/rhoIn
//   rim   rho in [rhoIn, rhoOut] dir * (R(dir) + jut(s, phi))  s along the band
//
// They share the ring at rho = rhoIn EXACTLY: the same phi samples, the same
// R, and jut(0) == -sink(1) by definition, so the two meshes meet vertex for
// vertex. They stay separate meshes because the lip of a socket is a real
// crease and a crease is where two normals SHOULD differ -- unlike the painted
// zones of POSTMORTEM 2.2.3, where a shared vertex buffer was the fix.
//
// `outline(phi)` is the feature's angular half-extent about its own axis, in
// radians. It is the TRUE analytic outline: the rim's edge is exactly this
// curve at whatever phi resolution is asked for, so the visible boundary of
// the feature never staircases no matter how coarse the host's grid is.
export function grommet({
  R,                     // the host's radius function, dir -> scalar
  axis,                  // unit direction from the host's centre to the feature
  up,                    // reference direction for phi = 0 being +U
  outline,               // phi -> angular half-extent, radians
  depth,                 // how far the dish floor sinks below the host surface
  seat,                  // how far the shared rim/dish ring sits below it
  jutMax,                // phi -> crest height of the rim band above the host
  rhoIn = 0.90, rhoOut = 1.34,
  // Where the dish STARTS, as a fraction of rhoIn. 0 gives a closed dish with
  // a floor, which is what an eye socket or a mouth trough is. Anything above
  // 0 gives an annulus with no floor -- a funnel you can see THROUGH -- which
  // is what the chest cavity's lip is, because what belongs behind that
  // opening is the flesh column, not a plate of skin.
  dishFrom = 0,
  // A SUNKEN COLLAR instead of a raised rim.
  //
  // The rim band's job is to hide the host's ragged cut, and it can do that
  // from either side. Standing PROUD it covers the cut from outside, which is
  // what an orbital rim wants to be anyway. But a feature that must not have a
  // raised lip round it -- a nasal aperture, a lipless mouth -- gets a rim it
  // does not want, and on a small feature that rim has to be wide, which puts
  // skin where the next feature needs to be. The nasal aperture's rim reached
  // 9 mm over the top of the grin and read as an upper lip on a face that is
  // supposed to be lipless.
  //
  // Sunk instead, the band lies just UNDER the host all the way out, the host
  // covers it, and the ragged cut becomes invisible for a better reason than
  // being hidden: both sides of it are the same colour and 2 mm apart. The
  // visible edge of the dark is then the material change at rho = rhoIn, which
  // is analytic, and the band may run as wide as it likes because none of it
  // shows. `outerLift` is read as a sink in this mode.
  sunken = false,
  phiSteps = 56, dishSteps = 9, rimSteps = 7,
  floorFlat = 0.66,      // fraction of the dish that is at FULL depth
  outerLift = 0.0016,    // the rim's outer edge, clear of the host's chords
  zeroAt = 0.06, peakAt = 0.30,
}) {
  const A = axis.clone().normalize();
  let V = up.clone().sub(A.clone().multiplyScalar(up.dot(A)));
  if (V.lengthSq() < 1e-12) V = new THREE.Vector3(0, 1, 0).sub(A.clone().multiplyScalar(A.y));
  V.normalize();
  const U = new THREE.Vector3().crossVectors(V, A).normalize();

  // direction at (rho, phi): tilt the axis away by rho * outline(phi)
  const dirAt = (rho, phi) => {
    const th = rho * outline(phi);
    const s = Math.sin(th), c = Math.cos(th);
    return new THREE.Vector3()
      .addScaledVector(A, c)
      .addScaledVector(U, s * Math.cos(phi))
      .addScaledVector(V, s * Math.sin(phi))
      .normalize();
  };

  // The dish. sink is `depth` over the flat floor and climbs to `seat` at the
  // rim, so the wall occupies the outer (1 - floorFlat) of the radius and is
  // steep. A gentle dish fills with bounce light and turns grey; this one
  // holds its own shadow, which is the whole point of the feature.
  const sink = (s) => mix(depth, seat, smoothstep(floorFlat, 1.0, s));

  const closed = dishFrom <= 0;
  const dishPts = [];
  if (closed) {
    const d = dirAt(0, 0);
    dishPts.push(d.clone().multiplyScalar(R(d) - depth));
  }
  const j0 = closed ? 1 : 0;
  for (let j = j0; j <= dishSteps; j++) {
    const s = mix(dishFrom, 1, j / dishSteps);
    for (let i = 0; i < phiSteps; i++) {
      const phi = 2 * Math.PI * (i / phiSteps);
      const d = dirAt(s * rhoIn, phi);
      dishPts.push(d.clone().multiplyScalar(R(d) - sink(s)));
    }
  }
  const base = closed ? 1 : 0;
  const dAt = (i, j) => base + (j - j0) * phiSteps + (((i % phiSteps) + phiSteps) % phiSteps);
  const dishIdx = [];
  // The dish is seen from OUTSIDE the host looking in, so its triangles face
  // back along the feature axis: the reverse of the host's own winding.
  if (closed) for (let i = 0; i < phiSteps; i++) dishIdx.push(0, dAt(i, 1), dAt(i + 1, 1));
  for (let j = j0; j < dishSteps; j++) {
    for (let i = 0; i < phiSteps; i++) {
      const a = dAt(i, j), b = dAt(i + 1, j), c = dAt(i + 1, j + 1), d = dAt(i, j + 1);
      dishIdx.push(a, c, b, a, d, c);
    }
  }

  // The rim band. jut(0) == -seat, so its inner ring IS the dish's outer ring.
  const jut = (s, phi) => {
    if (sunken) return mix(-seat, -outerLift, smoothstep(0, 1, s));
    const peak = jutMax(phi);
    if (s < zeroAt) return mix(-seat, 0, smoothstep(0, zeroAt, s));
    if (s < peakAt) return mix(0, peak, smoothstep(zeroAt, peakAt, s));
    return mix(peak, outerLift, smoothstep(peakAt, 1.0, s));
  };
  const rimPts = [];
  for (let j = 0; j <= rimSteps; j++) {
    const s = j / rimSteps;
    const rho = mix(rhoIn, rhoOut, s);
    for (let i = 0; i < phiSteps; i++) {
      const phi = 2 * Math.PI * (i / phiSteps);
      const d = dirAt(rho, phi);
      rimPts.push(d.clone().multiplyScalar(R(d) + jut(s, phi)));
    }
  }
  const rAt = (i, j) => j * phiSteps + (((i % phiSteps) + phiSteps) % phiSteps);
  const rimIdx = [];
  for (let j = 0; j < rimSteps; j++) {
    for (let i = 0; i < phiSteps; i++) {
      const a = rAt(i, j), b = rAt(i + 1, j), c = rAt(i + 1, j + 1), d = rAt(i, j + 1);
      rimIdx.push(a, c, b, a, d, c);
    }
  }

  return {
    dish: geoFrom(dishPts, dishIdx),
    rim: geoFrom(rimPts, rimIdx),
    // The predicate the host uses to omit its own quads. Cut BETWEEN the two
    // rho bounds so the ragged edge lands under the rim band with a margin at
    // both ends, and test on DIRECTION so it is independent of the radius.
    // `cellAngle` is the host grid's worst cell size in radians. The cut lands
    // on cell boundaries, so the real edge is rhoCut plus or minus half a cell
    // measured in units of the feature's own outline -- and the rim band only
    // hides it if that whole band lies inside [rhoIn, rhoOut].
    //
    // This is checked rather than eyeballed because the failure is silent from
    // most angles and unmistakable from one: on a nasal aperture six degrees
    // across, cut out of a grid with four-and-a-half degree cells, the rim
    // missed the ragged edge entirely and the background showed through the
    // face in square notches.
    // The narrowest the outline ever gets, which is what sets how ragged the
    // cut is in units of the feature's own size.
    minOutline: (() => {
      let smallest = Infinity;
      for (let i = 0; i < 128; i++) smallest = Math.min(smallest, outline(2 * Math.PI * i / 128));
      return smallest;
    })(),
    cut: (rhoCut, cellAngle = 0) => {
      if (cellAngle > 0) {
        let smallest = Infinity;
        for (let i = 0; i < 128; i++) smallest = Math.min(smallest, outline(2 * Math.PI * i / 128));
        const half = 0.5 * cellAngle / smallest;      // half a cell, in rho units
        if (rhoCut - half < rhoIn + 0.02 || rhoCut + half > rhoOut - 0.02) {
          throw new Error(
            `zombie/forms: a feature's rim cannot cover its cut. The ragged edge runs ` +
            `rho ${(rhoCut - half).toFixed(3)} to ${(rhoCut + half).toFixed(3)} and the rim only ` +
            `spans ${rhoIn} to ${rhoOut}. Widen the rim, shrink the host's cells, or make the feature bigger.`);
        }
      }
      return (dir) => {
      const c = Math.max(-1, Math.min(1, dir.dot(A)));
      const th = Math.acos(c);
      if (th < 1e-9) return true;
      const x = dir.dot(U), y = dir.dot(V);
      const phi = Math.atan2(y, x);
      return th < rhoCut * outline(phi);
      };
    },
    dirAt, axis: A, U, V,
  };
}

// An angular ellipse outline, the common case. `ax` and `ay` are the angular
// half-extents in the grommet's U and V directions.
export const ellipseOutline = (ax, ay) => (phi) => {
  const c = Math.cos(phi) / ax, s = Math.sin(phi) / ay;
  return 1 / Math.hypot(c, s);
};

// --- limbs and blobs ----------------------------------------------------------

// A tapered tube from a to b with rounded caps, optionally bowed sideways.
// Soft flesh, so it is barely waisted: `waist` is 0.86 here against the
// skeleton's bony 0.62.
export function limb(a, b, r0, r1, {
  radial = 12, segments = 10, waist = 1.0, bow = null, capA = true, capB = true,
} = {}) {
  const axis = b.clone().sub(a);
  const len = axis.length();
  const dir = axis.clone().divideScalar(len);
  let side = new THREE.Vector3(1, 0, 0);
  if (Math.abs(dir.dot(side)) > 0.9) side.set(0, 0, 1);
  const nx = new THREE.Vector3().crossVectors(dir, side).normalize();
  const ny = new THREE.Vector3().crossVectors(dir, nx).normalize();

  const centreAt = (t) => {
    const p = a.clone().lerp(b, t);
    if (bow) p.addScaledVector(bow, Math.sin(Math.PI * t));
    return p;
  };
  const radAt = (t) => mix(r0, r1, t) * mix(1, waist, Math.sin(Math.PI * t));

  const pts = [];
  const rings = segments + 1;
  for (let j = 0; j < rings; j++) {
    const t = j / segments;
    const c = centreAt(t), r = radAt(t);
    for (let i = 0; i < radial; i++) {
      const ang = 2 * Math.PI * (i / radial);
      pts.push(c.clone().addScaledVector(nx, Math.cos(ang) * r).addScaledVector(ny, Math.sin(ang) * r));
    }
  }
  const at = (i, j) => j * radial + (((i % radial) + radial) % radial);
  const idx = [];
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < radial; i++) {
      const A = at(i, j), B = at(i + 1, j), C = at(i + 1, j + 1), D = at(i, j + 1);
      idx.push(A, C, B, A, D, C);
    }
  }
  // Caps as domes rather than flat discs: a flat disc on the end of a limb
  // gives a hard rim that catches the key light as a bright line.
  const cap = (t, r, outward) => {
    const c = centreAt(t);
    const steps = 3;
    let prev = [];
    for (let i = 0; i < radial; i++) prev.push(at(i, t === 0 ? 0 : segments));
    for (let k = 1; k <= steps; k++) {
      const f = k / steps;
      const rr = r * Math.cos(f * Math.PI / 2);
      const off = r * Math.sin(f * Math.PI / 2) * (outward ? 1 : -1);
      const row = [];
      if (k === steps) {
        const p = c.clone().addScaledVector(dir, off);
        pts.push(p); const ii = pts.length - 1;
        for (let i = 0; i < radial; i++) row.push(ii);
      } else {
        for (let i = 0; i < radial; i++) {
          const ang = 2 * Math.PI * (i / radial);
          pts.push(c.clone().addScaledVector(dir, off)
            .addScaledVector(nx, Math.cos(ang) * rr).addScaledVector(ny, Math.sin(ang) * rr));
          row.push(pts.length - 1);
        }
      }
      for (let i = 0; i < radial; i++) {
        const A = prev[i], B = prev[(i + 1) % radial], C = row[(i + 1) % radial], D = row[i];
        if (outward) { if (C === D) idx.push(A, C, B); else idx.push(A, C, B, A, D, C); }
        else { if (C === D) idx.push(A, B, C); else idx.push(A, B, C, A, C, D); }
      }
      prev = row;
    }
  };
  if (capB) cap(1, radAt(1), true);
  if (capA) cap(0, radAt(0), false);
  return geoFrom(pts, idx);
}

// A ball. Squash and stretch by axis; this is the workhorse for joint bulbs,
// the ears, the spine knobs and every soft mass on the body.
export function ovoid(rx, ry, rz, { uSteps = 18, vSteps = 12, warp = null } = {}) {
  return closedRadial({
    uSteps, vSteps,
    R: (d) => {
      const base = 1 / Math.hypot(d.x / rx, d.y / ry, d.z / rz);
      return warp ? base * warp(d) : base;
    },
  });
}

// A rounded block, as a superellipsoid: the trunk segments, the boot, a tooth.
// Star-shaped about its centre, so a `grommet` can be set into it -- which is
// exactly what the chest cavity needs.
export function roundBoxR(hw, hh, hd, n = 3.2) {
  return (d) => {
    const t = Math.pow(
      Math.pow(Math.abs(d.x / hw), n) + Math.pow(Math.abs(d.y / hh), n) + Math.pow(Math.abs(d.z / hd), n),
      -1 / n);
    return t;
  };
}
export function roundBox(hw, hh, hd, { n = 3.2, uSteps = 22, vSteps = 14, warp = null, skip = null } = {}) {
  const base = roundBoxR(hw, hh, hd, n);
  return closedRadial({ uSteps, vSteps, skip, R: warp ? (d) => base(d) * warp(d) : base });
}

// An arc of tube: a rib, a lapel roll, the wire of a stitch.
export function arcTube(points, r0, r1, { radial = 8 } = {}) {
  const pts = [];
  const n = points.length;
  const frames = [];
  for (let j = 0; j < n; j++) {
    const a = points[Math.max(0, j - 1)], b = points[Math.min(n - 1, j + 1)];
    const t = b.clone().sub(a).normalize();
    let s = new THREE.Vector3(0, 1, 0);
    if (Math.abs(t.dot(s)) > 0.9) s.set(1, 0, 0);
    const nx = new THREE.Vector3().crossVectors(t, s).normalize();
    const ny = new THREE.Vector3().crossVectors(t, nx).normalize();
    frames.push({ c: points[j], nx, ny, r: mix(r0, r1, j / (n - 1)) });
  }
  for (const f of frames) {
    for (let i = 0; i < radial; i++) {
      const ang = 2 * Math.PI * (i / radial);
      pts.push(f.c.clone().addScaledVector(f.nx, Math.cos(ang) * f.r).addScaledVector(f.ny, Math.sin(ang) * f.r));
    }
  }
  const at = (i, j) => j * radial + (((i % radial) + radial) % radial);
  const idx = [];
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < radial; i++) {
      const A = at(i, j), B = at(i + 1, j), C = at(i + 1, j + 1), D = at(i, j + 1);
      idx.push(A, C, B, A, D, C);
    }
  }
  // flat end caps, buried in whatever the arc springs from
  const capAt = (j, flip) => {
    const f = frames[j];
    pts.push(f.c.clone()); const ci = pts.length - 1;
    for (let i = 0; i < radial; i++) {
      const A = at(i, j), B = at(i + 1, j);
      if (flip) idx.push(ci, A, B); else idx.push(ci, B, A);
    }
  };
  capAt(0, true); capAt(n - 1, false);
  return geoFrom(pts, idx);
}

// --- cloth --------------------------------------------------------------------
//
// TWO SHEETS AND A RIM ON EVERY CUT EDGE (POSTMORTEM 2.6). A single sheet is
// invisible edge-on and its torn hem has no thickness, which is what makes a
// garment read as a decal. `sheet2` builds an outer and an inner surface off
// the same parameterisation and walls every open edge between them, so the
// cloth is a genuine closed solid with a measurable thickness.
//
//   point(u, v)   the outer surface, u across the garment, v down it
//   normalAt      which way is "out" -- used to offset the inner sheet
//   keep(u, v)    false to omit a quad, which is how the holes are made
//
// Because it is closed, the rims of the holes come for free: any quad edge
// with no neighbour is walled.
export function sheet2({
  uSteps, vSteps, point, normalAt, thickness, keep = null, closedU = false,
}) {
  const uN = closedU ? uSteps : uSteps + 1;
  const vN = vSteps + 1;
  const outer = [], inner = [];
  for (let i = 0; i < uN; i++) {
    for (let j = 0; j < vN; j++) {
      const u = i / uSteps, v = j / vSteps;
      const p = point(u, v);
      const n = normalAt(u, v).normalize();
      outer.push(p.clone().addScaledVector(n, thickness / 2));
      inner.push(p.clone().addScaledVector(n, -thickness / 2));
    }
  }
  const pts = outer.concat(inner);
  const OI = (i, j) => (((i % uN) + uN) % uN) * vN + j;
  const II = (i, j) => outer.length + OI(i, j);
  const live = [];
  const idx = [];
  for (let i = 0; i < uSteps; i++) {
    live.push([]);
    for (let j = 0; j < vSteps; j++) {
      const u = (i + 0.5) / uSteps, v = (j + 0.5) / vSteps;
      const on = keep ? !!keep(u, v) : true;
      live[i].push(on);
      if (!on) continue;
      const a = OI(i, j), b = OI(i + 1, j), c = OI(i + 1, j + 1), d = OI(i, j + 1);
      idx.push(a, b, c, a, c, d);
      const A = II(i, j), B = II(i + 1, j), C = II(i + 1, j + 1), D = II(i, j + 1);
      idx.push(A, C, B, A, D, C);
    }
  }
  // Wall every open edge. This is what rims the torn hem and every hole.
  const alive = (i, j) => (i >= 0 && i < uSteps && j >= 0 && j < vSteps) ? live[i][j] : false;
  const wall = (o0, o1) => {
    const i0 = o0[0], j0 = o0[1], i1 = o1[0], j1 = o1[1];
    idx.push(OI(i0, j0), II(i0, j0), II(i1, j1), OI(i0, j0), II(i1, j1), OI(i1, j1));
  };
  for (let i = 0; i < uSteps; i++) {
    for (let j = 0; j < vSteps; j++) {
      if (!live[i][j]) continue;
      if (!alive(i, j - 1)) wall([i + 1, j], [i, j]);
      if (!alive(i, j + 1)) wall([i, j + 1], [i + 1, j + 1]);
      if (!alive(i - 1, j)) wall([i, j], [i, j + 1]);
      if (!alive(i + 1, j)) wall([i + 1, j + 1], [i + 1, j]);
    }
  }
  return geoFrom(pts, idx);
}

// A sawtooth along a hem, in 0..1 of the garment's width, returning how far up
// the cloth is eaten away at that u. Real geometry, because there is no alpha.
export function tatterAt(u, teeth, depth, seed = 0) {
  const t = u * teeth + seed;
  const k = Math.floor(t);
  const f = t - k;
  const h = (Math.sin(k * 12.9898 + seed * 78.233) * 43758.5453) % 1;
  const amp = depth * (0.35 + 0.65 * Math.abs(h));
  return amp * (1 - Math.abs(2 * f - 1));
}
