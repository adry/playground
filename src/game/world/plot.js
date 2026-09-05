// A region of the world, drawn as a PNG, with no renderer anywhere near it.
//
// Same argument as layout/plot.js and the same raster surface, imported rather
// than rewritten: you cannot look at a generator, only at its output, and a
// list of six hundred coordinates is not something anyone can review. What is
// different is that there is no level to draw, so the picture is a WINDOW: give
// it a centre and a size and it streams whatever is there, which is also a
// perfectly good test that streaming works.
//
// It is drawn in GRID coordinates, u to the right and v up, because that is
// what the fixed camera sees once the 45 degrees are taken out, and it is the
// frame rule 5 is stated in. A row that looks like a row here looks like a row
// on screen.

import { createSurface, toPNG, text } from '../layout/plot.js';
import { gridBoxOf, worldBoxOf } from './field.js';

const C = {
  bg: [14, 16, 20, 255],
  chunk: [30, 34, 42, 255],
  path: [52, 58, 68, 255],
  pathEdge: [70, 78, 92, 255],
  fence: [214, 176, 96, 255],
  gate: [90, 230, 140, 255],
  sweep: [60, 130, 90, 255],
  stone: [206, 200, 186, 255],
  bench: [176, 158, 130, 255],
  pumpkin: [232, 140, 58, 255],
  lantern: [246, 220, 120, 255],
  bush: [104, 150, 96, 255],
  hole: [24, 20, 18, 255],
  dirt: [130, 96, 70, 255],
  grave: [220, 110, 220, 255],
  firefly: [150, 255, 190, 255],
  flyHalo: [70, 150, 110, 255],
  jack: [255, 120, 40, 255],
  walk: [90, 190, 255, 255],
  spawn: [120, 220, 255, 255],
  label: [225, 228, 232, 255],
};

// One region of the world into a surface. `walk` is an optional list of world
// [x, z] the checker actually walked, which is the thing that turns a picture
// of a generator into a picture of a game.
export function drawRegion(world, {
  centre = { x: 0, z: 0 }, size = 160, scale = 5, walk = null, label = null,
} = {}) {
  const frame = world.frame;
  // The picture is a grid aligned square, because that is what the camera sees.
  // A grid square is a diamond in world, so the box everything is QUERIED with
  // is the world bounding box of the picture and not the picture itself, or the
  // four corners of the image come out half empty.
  const want = {
    minX: centre.x - size / 2, maxX: centre.x + size / 2,
    minZ: centre.z - size / 2, maxZ: centre.z + size / 2,
  };
  const g = gridBoxOf(frame, want);
  const box = worldBoxOf(frame, g);
  world.ensureAround(centre.x, centre.z, size * 1.1);
  const w = Math.ceil((g.maxU - g.minU) * scale);
  const h = Math.ceil((g.maxV - g.minV) * scale);
  const s = createSurface(w, h, C.bg);
  const X = (u) => (u - g.minU) * scale;
  const Y = (v) => (g.maxV - v) * scale;
  const G = (x, z) => frame.toGrid(x, z);

  // Chunk seams, faint, so you can see that they are not visible in anything
  // else that is drawn on top of them.
  for (const chunk of world._store.built()) {
    const corners = [
      [chunk.box.minX, chunk.box.minZ], [chunk.box.maxX, chunk.box.minZ],
      [chunk.box.maxX, chunk.box.maxZ], [chunk.box.minX, chunk.box.maxZ],
    ].map(([x, z]) => G(x, z));
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      s.line(X(a.u), Y(a.v), X(b.u), Y(b.v), C.chunk);
    }
  }

  // Paths, as ribbons: the centreline plus its two edges, so the clear width is
  // visible rather than implied.
  for (const p of world.paths(box)) {
    for (let i = 1; i < p.points.length; i++) {
      const a = G(p.points[i - 1][0], p.points[i - 1][1]);
      const b = G(p.points[i][0], p.points[i][1]);
      const dx = b.u - a.u;
      const dv = b.v - a.v;
      const len = Math.hypot(dx, dv) || 1;
      const nu = -dv / len;
      const nv = dx / len;
      const half = p.width / 2;
      for (let t = -half; t <= half; t += 0.35) {
        s.line(X(a.u + nu * t), Y(a.v + nv * t), X(b.u + nu * t), Y(b.v + nv * t), C.path);
      }
      s.line(X(a.u + nu * half), Y(a.v + nv * half), X(b.u + nu * half), Y(b.v + nv * half), C.pathEdge);
      s.line(X(a.u - nu * half), Y(a.v - nv * half), X(b.u - nu * half), Y(b.v - nv * half), C.pathEdge);
    }
  }

  // Props, on their real oriented footprints rather than their circles.
  for (const p of world.props(box)) {
    const q = G(p.x, p.z);
    const c = C[p.kind] || [255, 0, 255, 255];
    if (p.foot.shape === 'disc') {
      s.disc(X(q.u), Y(q.v), Math.max(1, p.foot.r * scale), c, 0.85);
    } else {
      const cs = Math.cos(p.gridYaw);
      const sn = Math.sin(p.gridYaw);
      const pts = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([su, sv]) => {
        const lu = su * p.foot.halfU;
        const lv = sv * p.foot.halfV;
        return [X(q.u + lu * cs + lv * sn), Y(q.v - lu * sn + lv * cs)];
      });
      if (p.kind === 'hole') s.rect(
        Math.min(...pts.map((a) => a[0])), Math.min(...pts.map((a) => a[1])),
        Math.max(...pts.map((a) => a[0])), Math.max(...pts.map((a) => a[1])), C.hole, 0.8,
      );
      s.poly(pts, c);
      s.disc(X(q.u), Y(q.v), Math.max(1, scale * 0.18), c, 0.55);
    }
  }

  // Fences, thick, because they are the thing the picture is about. A gate is a
  // gap in them and is drawn as the gap it is, with its sweep disc.
  for (const b of world.barriers(box)) {
    const a = G(b.x0, b.z0);
    const e = G(b.x1, b.z1);
    for (const off of [-0.09, 0, 0.09]) {
      s.line(X(a.u) + off * scale, Y(a.v), X(e.u) + off * scale, Y(e.v), C.fence);
      s.line(X(a.u), Y(a.v) + off * scale, X(e.u), Y(e.v) + off * scale, C.fence);
    }
  }
  for (const gate of world.gates(box)) {
    const a = G(gate.x0, gate.z0);
    const e = G(gate.x1, gate.z1);
    s.line(X(a.u), Y(a.v), X(e.u), Y(e.v), C.gate);
    s.disc(X(a.u), Y(a.v), Math.max(2, scale * 0.28), C.gate);
    s.disc(X(e.u), Y(e.v), Math.max(2, scale * 0.28), C.gate);
    const sw = G(gate.sweep.x, gate.sweep.z);
    s.ring(X(sw.u), Y(sw.v), gate.sweep.r * scale, C.sweep, 0.75);
  }

  // Graves, power pellets and fireflies. The fireflies get a halo because there
  // are so few of them that a single pixel would be a lie about how much they
  // matter.
  for (const gr of world.graves(box)) {
    const q = G(gr.x, gr.z);
    s.ring(X(q.u), Y(q.v), Math.max(3, scale * 1.1), C.grave, 0.9);
  }
  for (const p of world.powerups(box)) {
    const q = G(p.x, p.z);
    s.disc(X(q.u), Y(q.v), Math.max(3, scale * 0.62), C.jack);
    s.ring(X(q.u), Y(q.v), Math.max(6, scale * 1.5), C.jack, 0.4);
  }
  for (const f of world.fireflies(box)) {
    const q = G(f.x, f.z);
    s.ring(X(q.u), Y(q.v), Math.max(7, scale * 1.6), C.flyHalo, 0.55);
    s.ring(X(q.u), Y(q.v), Math.max(4, scale * 0.95), C.flyHalo, 0.8);
    s.disc(X(q.u), Y(q.v), Math.max(2, scale * 0.42), C.firefly);
  }

  // The walk, which is the only thing here that is not the world: it is the
  // player the checker simulated, drawn so the spacing can be judged against
  // the distance somebody actually has to cover.
  if (walk && walk.length > 1) {
    for (let i = 1; i < walk.length; i++) {
      const a = G(walk[i - 1][0], walk[i - 1][1]);
      const b = G(walk[i][0], walk[i][1]);
      if (a.u < g.minU - 4 && b.u < g.minU - 4) continue;
      s.line(X(a.u), Y(a.v), X(b.u), Y(b.v), C.walk, 0.9);
    }
    const a = G(walk[0][0], walk[0][1]);
    s.disc(X(a.u), Y(a.v), Math.max(3, scale * 0.8), C.walk);
  }

  const sp = G(world.spawn.x, world.spawn.z);
  if (sp.u > g.minU && sp.u < g.maxU && sp.v > g.minV && sp.v < g.maxV) {
    s.ring(X(sp.u), Y(sp.v), Math.max(4, scale * 1.4), C.spawn);
    s.ring(X(sp.u), Y(sp.v), world.START_CLEAR * scale, C.spawn, 0.25);
  }

  if (label !== null) text(s, label, 6, 6, C.label, Math.max(1, Math.round(scale / 2)));
  return s;
}

export function regionPNG(world, opts) {
  return toPNG(drawRegion(world, opts));
}

export default regionPNG;
