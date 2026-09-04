import * as THREE from 'three';
import { toyMaterial, PALETTE, SEGMENTS, contactShadow } from './style.js';

// A squat ribbed jack-o'-lantern in the house vinyl-toy style: smooth lobes, a
// curved tapering stem, and a carved face that glows from inside.
//
// Everything curved here is generated parametrically rather than assembled from
// primitives, for one reason: the ribs. A lathe or a scaled sphere cannot make
// a lobed silhouette, and a low-segment lobed silhouette reads as faceted --
// exactly the look style.js rules out. So the body is one smooth parametric
// surface, sampled densely enough that the outline never shows a straight run.
//
// The shell is opaque and real holes would need CSG, so the face is built as
// emissive patches *projected onto the same surface function* as the shell and
// pushed out along the local normal by a hair. Because they are evaluated from
// the identical math, they follow the ribs instead of floating over them.

// --- Shape constants -------------------------------------------------------
// Authored against the ghost (1.6 tall, hem near 0.2): body ~0.39 tall and
// ~0.80 across, stem on top, ~0.6 overall.
const BODY_R = 0.40;   // equator radius before the ribs bite into it
const BODY_H = 0.345;  // half-height of the un-dished profile
// Nearer 2 is nearer a true ellipsoid. The earlier 2.5 squared off the
// shoulders and flattened the poles, which is what read as not round enough.
const SQUASH = 2.08;
const DIP = 0.26;      // how hard the poles are pulled back in, making the stem dish
const RIB_SHARP = 1.5; // >1 narrows the groove and widens the lobe crest

// The face looks along +x+z so it meets the preview/game camera square-on at
// spin 0; the lobe crest sits at the same angle so the face lands on a bulge.
const FACE_YAW = Math.PI / 4;

// Tessellation. SEGMENTS is sized for plain round surfaces; a lobed one needs
// several times that many steps around, or the grooves stair-step, so the
// counts here scale the house numbers up rather than reusing them blind.
const RINGS = SEGMENTS.height * 3;

// What the lamp, the carving and its bloom look like at the bottom and the top
// of the flicker's swing. All three are driven off the one value, which is what
// makes the light and the face read as the same flame.
const LAMP = { min: 1.05, max: 3.10 };     // PointLight intensity
const GLOW = { min: 0.88, max: 1.38 };     // face emissiveIntensity
const BLOOM = { min: 0.09, max: 0.32 };    // halo opacity

// The flame's two ends: a dull ember at the bottom of a gutter, bright flame at
// the top of a flare.
const EMBER = new THREE.Color('#ff6a24').convertSRGBToLinear();
const FLAME = new THREE.Color(PALETTE.glow).convertSRGBToLinear();

// Small deterministic PRNG: same seed, same pumpkin, and nothing at module scope.
function makeRng(seed) {
  let s = (Math.imul(seed | 0, 1103515245) + 12345) >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
}

// Smooth 1D value noise. Layered at a few rates this is what makes the light
// read as a flame: white noise reads as a failing bulb, a sine reads as a pulse.
function makeNoise(seed) {
  const hash = (n) => {
    const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  return (t) => {
    const i = Math.floor(t);
    const f = t - i;
    const u = f * f * (3 - 2 * f); // smoothstep, so the derivative is continuous
    return hash(i) * (1 - u) + hash(i + 1) * u;
  };
}

export function createPumpkin({ seed = 1, scale = 1 } = {}) {
  const rand = makeRng(seed);
  const noise = makeNoise(seed);

  // Per-seed variation, kept small: these are the same toy, not different ones.
  const lobes = 9 + Math.floor(rand() * 3);          // 9..11
  // Shallower grooves: deep ones cut the round silhouette into a gear.
  const ribDepth = 0.085 + rand() * 0.025;
  const bodyR = BODY_R * (0.96 + rand() * 0.08);
  const bodyH = BODY_H * (0.96 + rand() * 0.08);
  // The stem leans relative to the *face*, not to world axes, so the bend reads
  // from the angle the face is being seen from.
  const side = rand() < 0.5 ? -1 : 1;
  const aStem = side * (0.38 + rand() * 0.16) * Math.PI;   // out to one side
  const flickerPhase = rand() * 100;

  // --- The body surface ----------------------------------------------------
  // s runs -1 (bottom pole) .. +1 (top pole); a is the angle around, measured
  // from the middle of the front lobe.

  // Superellipse profile: full through the middle, flat-shouldered at the poles.
  const profileR = (s) => Math.pow(Math.max(0, 1 - Math.pow(Math.abs(s), SQUASH)), 1 / SQUASH);

  // Pull the last stretch of each pole back toward the centre so the top and
  // bottom sit in a shallow dish, the way a pumpkin does around its stem.
  const profileY = (s) => {
    const t = Math.max(0, (Math.abs(s) - 0.55) / 0.45);
    return bodyH * (s - Math.sign(s) * DIP * t * t);
  };

  // Grooves, deepest at a = ±pi/lobes, zero at the crest so the front lobe is a
  // clean bulge for the face to sit on.
  const rib = (a) => 1 - ribDepth * Math.pow(0.5 - 0.5 * Math.cos(lobes * a), RIB_SHARP);

  // Because of the dish, the lowest point of the shell is a ring rather than the
  // pole. Find it numerically and stand the prop on it, so y = 0 is the ground.
  let lowest = Infinity;
  for (let i = 0; i <= 400; i++) lowest = Math.min(lowest, profileY(-1 + (2 * i) / 400));
  const yBase = -lowest;

  const surface = (a, s, target) => {
    const r = bodyR * profileR(s) * rib(a);
    const u = a + FACE_YAW;
    return target.set(r * Math.sin(u), profileY(s) + yBase, r * Math.cos(u));
  };

  // Numeric normal. Cross(d/da, d/ds) points outward for this parameterisation
  // (checked at the equator), which also fixes the triangle winding below.
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpC = new THREE.Vector3();
  const tmpD = new THREE.Vector3();
  const tmpN = new THREE.Vector3();
  const surfaceNormal = (a, s, target) => {
    const e = 2e-3;
    const sc = Math.min(0.999, Math.max(-0.999, s));
    surface(a + e, sc, tmpA).sub(surface(a - e, sc, tmpB));
    surface(a, Math.min(0.999, sc + e), tmpC).sub(surface(a, Math.max(-0.999, sc - e), tmpD));
    return target.crossVectors(tmpA, tmpC).normalize();
  };

  // --- Shell mesh ----------------------------------------------------------
  const radial = Math.max(lobes * 18, SEGMENTS.radial);
  const shellGeo = (() => {
    const verts = [];
    const colors = [];
    const idx = [];
    const p = new THREE.Vector3();

    const skin = new THREE.Color(PALETTE.pumpkinSkin).convertSRGBToLinear();
    const shade = new THREE.Color(PALETTE.pumpkinShade).convertSRGBToLinear();
    const c = new THREE.Color();

    const pushColor = (a, s) => {
      // Paint the grooves with the palette's shade colour. Real shading already
      // darkens them; this keeps them readable when the key light is head-on.
      const g = Math.pow(0.5 - 0.5 * Math.cos(lobes * a), 0.9);
      c.copy(skin).lerp(shade, g * 0.20);
      // A touch more shade in the last of the underside, standing in for the
      // contact occlusion a prop this simple gets no other way. Kept small:
      // overdoing it turns the palette's orange into a muddy red.
      const low = Math.max(0, -s - 0.55) / 0.45;
      c.lerp(shade, low * low * 0.12);
      colors.push(c.r, c.g, c.b);
    };

    // Bottom pole (index 0).
    surface(0, -1, p); verts.push(p.x, p.y, p.z); pushColor(0, -1);

    // s is distributed by angle so the fast-changing shoulders get the samples.
    for (let j = 1; j < RINGS; j++) {
      const s = -Math.cos((Math.PI * j) / RINGS);
      for (let i = 0; i < radial; i++) {
        const a = (i / radial) * Math.PI * 2;
        surface(a, s, p);
        verts.push(p.x, p.y, p.z);
        pushColor(a, s);
      }
    }

    // Top pole (last index).
    surface(0, 1, p); verts.push(p.x, p.y, p.z); pushColor(0, 1);
    const top = verts.length / 3 - 1;

    const ring = (j, i) => 1 + (j - 1) * radial + (i % radial);
    for (let i = 0; i < radial; i++) idx.push(0, ring(1, i + 1), ring(1, i));
    for (let j = 1; j < RINGS - 1; j++) {
      for (let i = 0; i < radial; i++) {
        const a0 = ring(j, i), a1 = ring(j, i + 1);
        const b0 = ring(j + 1, i), b1 = ring(j + 1, i + 1);
        idx.push(a0, a1, b0, a1, b1, b0);
      }
    }
    for (let i = 0; i < radial; i++) idx.push(ring(RINGS - 1, i), ring(RINGS - 1, i + 1), top);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setIndex(idx);
    g.computeVertexNormals(); // shared vertices, wrapped seam -> no visible facets
    return g;
  })();

  // Vertex colours carry the whole hue, so the material's own colour is white.
  const shellMat = toyMaterial('#ffffff', { vertexColors: true, roughness: 0.78 });
  const shell = new THREE.Mesh(shellGeo, shellMat);
  shell.castShadow = true;
  shell.receiveShadow = true;

  // --- Mapping face coordinates onto the shell -----------------------------
  // Face shapes are authored in (X across the surface, Y height above ground)
  // so they keep their proportions; this inverts the profile to get back to s.
  // S_HI runs well past the widest part of the body on purpose: the reference's
  // eyes sit high enough that their apexes land near s = 0.67, and a table that
  // stopped at the shoulder would clamp them onto the crown.
  const S_LO = -0.78, S_HI = 0.86, S_N = 512;
  const yTable = new Float32Array(S_N + 1);
  for (let i = 0; i <= S_N; i++) yTable[i] = profileY(S_LO + ((S_HI - S_LO) * i) / S_N) + yBase;
  const sOfY = (y) => {
    let lo = 0, hi = S_N;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (yTable[mid] < y) lo = mid; else hi = mid;
    }
    const span = yTable[hi] - yTable[lo] || 1;
    const f = (y - yTable[lo]) / span;
    return S_LO + ((S_HI - S_LO) * (lo + f)) / S_N;
  };

  // Sit the carving 3mm proud of the shell. Because the patches are tessellated
  // finely enough that their own chord error is under a tenth of a millimetre,
  // this only has to clear the shell's polygonal approximation -- and staying
  // this tight matters: any more and the carving breaks the silhouette when the
  // face is seen edge-on.
  const FACE_LIFT = 0.003;
  // The seed rescales the shell a few percent in each axis, so the face has to
  // ride that scale instead of sitting at fixed heights. Authored absolutely,
  // the eyes -- which sit high on the shoulder -- ran off the crown of a
  // small-seeded body and got clamped. Scaling X keeps the same angle round the
  // body, scaling Y the same fraction of its height, so every seed wears the
  // same face.
  const FACE_SX = bodyR / BODY_R;
  const FACE_SY = bodyH / BODY_H;
  const facePoint = (X, Y, lift, target) => {
    const s = sOfY(Y * FACE_SY);
    // Angular mapping uses the un-ribbed radius, so the face is not stretched
    // and squeezed as it crosses the grooves -- it just drapes over them.
    const a = (X * FACE_SX) / Math.max(0.05, bodyR * profileR(s));
    surface(a, s, target);
    surfaceNormal(a, s, tmpN);
    return target.addScaledVector(tmpN, lift);
  };

  // Builds one geometry from a list of patches, each a 2D sampler over the unit
  // square projected onto the shell. Everything is a grid so the tessellation
  // stays dense and evenly shaped; triangles are authored as degenerate grids
  // (the base edge collapsed to a point at v = 1).
  const patchGeometry = (defs, lift) => {
    const verts = [];
    const idx = [];
    const p = new THREE.Vector3();
    let base = 0;
    for (const { nx, ny, sampler } of defs) {
      for (let j = 0; j <= ny; j++) {
        for (let i = 0; i <= nx; i++) {
          const [X, Y] = sampler(i / nx, j / ny);
          facePoint(X, Y, lift, p);
          verts.push(p.x, p.y, p.z);
        }
      }
      const vi = (i, j) => base + j * (nx + 1) + i;
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          idx.push(vi(i, j), vi(i + 1, j), vi(i, j + 1), vi(i + 1, j), vi(i + 1, j + 1), vi(i, j + 1));
        }
      }
      base += (nx + 1) * (ny + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };

  // Triangle: base edge at v = 0, collapsing to the apex at v = 1.
  const triSampler = (ax, ay, blx, bly, brx, bry) => (u, v) => [
    (blx + (brx - blx) * u) * (1 - v) + ax * v,
    (bly + (bry - bly) * u) * (1 - v) + ay * v,
  ];

  // --- The carved face -------------------------------------------------------
  // These numbers are solved off .ref/ref-pumpkin.png, not eyeballed. Each
  // landmark in the photo was measured in pixels, both pumpkins were pinned to
  // their own silhouette (axis, widest row, width) so the two could be laid over
  // each other, and every point was then run back through this camera to find
  // the (X, Y) on this shell that lands on it. Two earlier passes were laid out
  // by feel and both came out with the same tell: a face that had slid down the
  // belly. On the reference the eyes are up on the shoulder, near s = 0.67, and
  // the mouth's corners sit only a little below the equator.
  //
  // Everything below is authored against the nominal BODY_R / BODY_H; facePoint
  // rescales it onto whatever body the seed actually built.

  // Eyes. Big tilted triangles, not the tidy symmetric ones we had: on the
  // reference each base slopes down toward the nose by about 15 degrees and the
  // apex leans back out over the outer corner, which is what stops them reading
  // as a pair of tents. The outer corner also reaches much further round the
  // body than the inner one -- the eyes are set wide.
  const EYE = {
    apexX: 0.1393, apexY: 0.4807,   // apex, high on the shoulder
    outX: 0.2004, outY: 0.4049,     // outer base corner, the high end of the base
    inX: 0.0988, inY: 0.3791,       // inner base corner, dropped toward the nose
  };
  const eye = (dir) => triSampler(
    EYE.apexX * dir, EYE.apexY,
    EYE.outX * dir, EYE.outY,
    EYE.inX * dir, EYE.inY,
  );

  // Nose: a small apex-up triangle, and small is the point. It measures about a
  // third of an eye by area on the reference; ours used to be nearly half, which
  // is what made the middle of the face look crowded.
  const NOSE_W = 0.0362, NOSE_TIP = 0.3975, NOSE_BASE = 0.3344;
  const nose = triSampler(0, NOSE_TIP, -NOSE_W, NOSE_BASE, NOSE_W, NOSE_BASE);

  // Mouth. A wide, fairly flat band -- it reaches past the outer corner of each
  // eye -- that hooks up into a point at each end. The hook is late: across the
  // middle two thirds both edges are almost level, and only the last fifth
  // sweeps up. Parabolas through the same three points gave a droopy banana,
  // which is what the old grin was.
  const MW = 0.2213;      // half width
  const M_TOP = 0.2645;   // upper edge at the centre
  const M_BOT = 0.1883;   // lower edge at the centre
  const M_TIP = 0.2924;   // where the two edges meet, at the lifted corners
  const topAt = (q) => M_TOP + (M_TIP - M_TOP) * Math.pow(q, 3.2);
  const botAt = (q) => M_BOT + (M_TIP - M_BOT) * Math.pow(q, 6.0);

  // Teeth are blocks, not spikes. A plateau with only the outer fifth of each
  // flank ramped gives a trapezoid with shoulders you can actually see; the
  // little linear spikes we had before merged into the grin and read as a W.
  // ramp is the fraction of the half width given over to the flank: small keeps
  // the sides near vertical, which is what the reference's teeth do. Smoothstep
  // rather than a straight line so the shoulder is a corner and not a staircase
  // across the sampling grid.
  const block = (d, ramp) => {
    const t = Math.min(1, Math.max(0, (1 - d) / ramp));
    return t * t * (3 - 2 * t);
  };
  const TOOTH_X = 0.134, TOOTH_HW = 0.039, TOOTH_DROP = 0.60, TOOTH_RAMP = 0.16;
  const LOW_HW = 0.078, LOW_RISE = 0.62, LOW_DOME = 0.42, LOW_RAMP = 0.22;

  const mouth = (u, v) => {
    const x = -MW + 2 * MW * u;
    const q = Math.abs(x) / MW;
    const top0 = topAt(q);
    const bot0 = botAt(q);
    const gap = top0 - bot0;
    // Two teeth hang down from the upper edge, just inside the eyes.
    let top = top0;
    for (const tx of [-TOOTH_X, TOOTH_X]) {
      top -= gap * TOOTH_DROP * block(Math.abs(x - tx) / TOOTH_HW, TOOTH_RAMP);
    }
    // One broad tooth rises from the lower edge in the middle. Its top is given
    // a slight dome because a top that is flat in these coordinates projects as
    // a sagging one -- the surface is falling away from the camera across it.
    const dLow = Math.abs(x) / LOW_HW;
    const bottom = bot0 + gap * LOW_RISE * (1 - LOW_DOME * dLow * dLow) * block(dLow, LOW_RAMP);
    return [x, top + (bottom - top) * v];
  };

  // The mouth needs the samples: at 96 across, a tooth flank fell inside a
  // single column and its shoulders came out as a staircase. 240 puts two or
  // three columns in the flank, which is enough for the smoothstep to read.
  const FACE_SHAPES = [
    { nx: 12, ny: 12, sampler: eye(-1), cx: -0.1462, cy: 0.4216 },
    { nx: 12, ny: 12, sampler: eye(1), cx: 0.1462, cy: 0.4216 },
    { nx: 8, ny: 8, sampler: nose, cx: 0, cy: 0.3554 },
    { nx: 240, ny: 10, sampler: mouth, cx: 0, cy: 0.2264 },
  ];

  const faceGeo = patchGeometry(FACE_SHAPES, FACE_LIFT);

  // Emissive, so it ignores the scene lights entirely and reads as light on its
  // way out rather than as an orange sticker. Its intensity is driven by the
  // same flicker value as the lamp, which is what ties the two together.
  const faceMat = new THREE.MeshStandardMaterial({
    color: 0x1a0a00,
    emissive: new THREE.Color(PALETTE.glow),
    emissiveIntensity: (GLOW.min + GLOW.max) / 2,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const face = new THREE.Mesh(faceGeo, faceMat);
  // No shadows: it is coplanar with the shell, and a caster there only produces
  // acne. It is light, not matter.
  face.castShadow = false;
  face.receiveShadow = false;

  // A wider, fainter copy sitting just under the bright one. Additive, so it
  // spills warmth onto the shell around each cut, the way light leaking out of
  // a real carving lifts the skin around the hole.
  const haloGeo = patchGeometry(
    FACE_SHAPES.map(({ nx, ny, sampler, cx, cy }) => ({
      nx,
      ny,
      sampler: (u, v) => {
        const [X, Y] = sampler(u, v);
        // 1.24, not the 1.5 this started at. The bloom is a scaled copy, so its
        // width grows with the shape it surrounds; once the face was resized to
        // the reference, 1.5 stopped reading as light spilling round a cut and
        // started reading as a thick orange outline drawn on the shell -- worst
        // at the eyes, where scaling a triangle about its centroid pulls the
        // apex out into a spike.
        return [cx + (X - cx) * 1.24, cy + (Y - cy) * 1.24];
      },
    })),
    FACE_LIFT * 0.45,
  );
  const haloMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.glow),
    transparent: true,
    opacity: (BLOOM.min + BLOOM.max) / 2,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.renderOrder = 1;

  // --- Stem ----------------------------------------------------------------
  // A swept tube with its own radius profile rather than a CylinderGeometry:
  // it has to bend, taper, flare where it meets the shell and round off at the
  // tip, and none of that is a primitive.
  const stemTop = profileY(1) + yBase;
  const lean = new THREE.Vector2(Math.sin(aStem + FACE_YAW), Math.cos(aStem + FACE_YAW));
  // The control points lean progressively rather than all at once, so the stem
  // bends along its length instead of kinking at one joint.
  const stemCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, stemTop - 0.035, 0),
    new THREE.Vector3(lean.x * 0.006, stemTop + 0.045, lean.y * 0.006),
    new THREE.Vector3(lean.x * 0.042, stemTop + 0.105, lean.y * 0.042),
    new THREE.Vector3(lean.x * 0.105, stemTop + 0.150, lean.y * 0.105),
    new THREE.Vector3(lean.x * 0.170, stemTop + 0.172, lean.y * 0.170),
  ]);
  const stemRadius = (t) => {
    const taper = 0.052 * (1 - 0.42 * Math.pow(t, 1.2));
    const flare = 1 + 1.05 * Math.exp(-t / 0.11);     // spreads where it meets the dish
    // A hemispherical roll-off rather than a flat disc: the tip of a toy stem
    // is a soft nub, and a truncated cone reads as a cut-off pencil.
    const cap = t > 0.82 ? Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.82) / 0.18, 2))) : 1;
    return taper * flare * cap;
  };
  const stemGeo = sweep(stemCurve, stemRadius, SEGMENTS.curve * 2, SEGMENTS.radial);
  const stemMat = toyMaterial(PALETTE.stem, { roughness: 0.86 });
  const stem = new THREE.Mesh(stemGeo, stemMat);
  stem.castShadow = true;
  stem.receiveShadow = true;

  // --- The lamp inside -----------------------------------------------------
  // A point light was wrong here. Three does not occlude lights without a
  // shadow map, so an omnidirectional lamp inside an opaque shell lit the
  // ground evenly all the way round -- including behind the pumpkin, where no
  // light can actually get out. Turning shadows on does not fix it either: the
  // shell has no real holes, so it would block everything.
  //
  // What the light physically does is leave through the cuts, so it is a cone
  // aimed out of the face and tilted down at the floor. Wide and very soft,
  // because three separate openings scatter it rather than one aperture.
  const LIGHT_DISTANCE = 2.8;
  const light = new THREE.SpotLight(
    new THREE.Color(PALETTE.glow),
    (LAMP.min + LAMP.max) / 2,
    LIGHT_DISTANCE * scale,
    0.98,  // half-cone, wide enough that the pool is not a torch beam
    0.9,   // penumbra: almost all edge, so there is no visible cone rim
    1.5,
  );
  light.position.set(0, yBase * 0.9, 0);
  light.castShadow = false;

  // The target is parented to the group, so the cone turns with the pumpkin
  // instead of staying pinned to a world direction.
  const faceDir = new THREE.Vector3(Math.sin(FACE_YAW), 0, Math.cos(FACE_YAW));
  const lightTarget = new THREE.Object3D();
  // Local units: the group is scaled below, so these must not be pre-scaled.
  lightTarget.position.copy(faceDir).multiplyScalar(1.15);
  lightTarget.position.y = -0.5;
  light.target = lightTarget;

  const group = new THREE.Group();
  const contact = contactShadow({ radius: 0.46, opacity: 0.4 });
  group.add(shell, face, halo, stem, light, lightTarget, contact);
  group.scale.setScalar(scale);

  const lightHome = light.position.clone();

  return {
    group,
    update(time) {
      // A candle mostly burns near full and occasionally ducks. Summed smooth
      // noise on its own only wanders about its middle, which is why the first
      // version read as a dimmer being nudged rather than a flame. So the
      // steady part sits high, and a separate sparse guttering term pulls it
      // down.
      const t = time + flickerPhase;
      const swing = (f, o) => (noise(t * f + o) - 0.5) * 2; // -1..1

      const steady = 0.84 + 0.10 * swing(1.3, 0) + 0.07 * swing(6.1, 13.2) + 0.04 * swing(15.7, 41.7);

      // Only the top of this slow channel counts, so dips are occasional and
      // brief rather than rhythmic; squaring the ramp keeps their onset soft.
      const g = noise(t * 0.62 + 77.3);
      const gutter = g > 0.70 ? (g - 0.70) / 0.30 : 0;
      const dip = gutter * gutter * 0.52 * (0.55 + 0.45 * noise(t * 9.3 + 5.1));

      const level = Math.min(1, Math.max(0, steady - dip)); // 0 = guttering, 1 = flaring

      const at = (range) => range.min + (range.max - range.min) * level;
      light.intensity = at(LAMP);
      // Lamp, carving and bloom all come off the one value: that is the whole
      // trick. The carving's range is shallower because a real cut-out stays
      // near saturation even as the spill on the ground drops away.
      faceMat.emissiveIntensity = at(GLOW);
      haloMat.opacity = at(BLOOM);
      // A guttering flame reddens as it drops, so the colour rides the same
      // value rather than sitting at a fixed warm white.
      light.color.copy(EMBER).lerp(FLAME, level);

      // A candle is not nailed down; a few millimetres of sway makes the pool of
      // light on the ground breathe.
      light.position.set(
        lightHome.x + (noise(t * 0.9 + 5.5) - 0.5) * 0.03,
        lightHome.y + (noise(t * 1.3 + 8.1) - 0.5) * 0.02,
        lightHome.z + (noise(t * 0.8 + 2.7) - 0.5) * 0.03,
      );
    },
    dispose() {
      for (const g of [shellGeo, faceGeo, haloGeo, stemGeo]) g.dispose();
      for (const m of [shellMat, faceMat, haloMat, stemMat]) m.dispose();
      contact.userData.dispose();
      group.clear();
    },
  };
}

// Sweeps a circular cross-section of varying radius along a curve. Frenet
// frames keep the tube from twisting; radius(t) does the taper, the flare and
// the rounded tip.
//
// Normals are analytic rather than from computeVertexNormals. Where the radius
// rolls off to nothing at the tip the triangles go degenerate, and averaged
// face normals there come out as a dark pinched spot; the closed form tilts
// smoothly to point straight along the axis instead.
function sweep(curve, radius, along, around) {
  const frames = curve.computeFrenetFrames(along, false);
  const verts = [];
  const nors = [];
  const idx = [];
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();

  const h = 0.5 / along;
  const lo = (t) => Math.max(0, t - h);
  const hi = (t) => Math.min(1, t + h);
  const speedAt = (t) => curve.getPoint(lo(t)).distanceTo(curve.getPoint(hi(t))) / (hi(t) - lo(t));

  for (let j = 0; j <= along; j++) {
    const t = j / along;
    const c = curve.getPoint(t);
    const T = curve.getTangent(t);
    const N = frames.normals[j];
    const B = frames.binormals[j];
    const r = radius(t);
    // Slope of the radius profile, in units of the curve's own arc length.
    const slope = (radius(hi(t)) - radius(lo(t))) / ((hi(t) - lo(t)) * speedAt(t));
    for (let i = 0; i < around; i++) {
      const phi = (i / around) * Math.PI * 2;
      const cs = Math.cos(phi);
      const sn = Math.sin(phi);
      p.copy(c).addScaledVector(N, cs * r).addScaledVector(B, sn * r);
      verts.push(p.x, p.y, p.z);
      n.set(0, 0, 0).addScaledVector(N, cs).addScaledVector(B, sn).addScaledVector(T, -slope).normalize();
      nors.push(n.x, n.y, n.z);
    }
  }
  const vi = (j, i) => j * around + (i % around);
  for (let j = 0; j < along; j++) {
    for (let i = 0; i < around; i++) {
      idx.push(vi(j, i), vi(j, i + 1), vi(j + 1, i), vi(j, i + 1), vi(j + 1, i + 1), vi(j + 1, i));
    }
  }
  // Close the (hidden) base with a fan. The far end needs no cap: its radius
  // already rolls off to a point.
  const capStart = verts.length / 3;
  const c0 = curve.getPoint(0);
  const t0 = curve.getTangent(0);
  verts.push(c0.x, c0.y, c0.z);
  nors.push(-t0.x, -t0.y, -t0.z);
  for (let i = 0; i < around; i++) idx.push(capStart, vi(0, i + 1), vi(0, i));

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nors, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
