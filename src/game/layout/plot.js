// A top-down dump of a level, as a PNG, with no renderer anywhere near it.
//
// You cannot look at a level generator. You can only look at its output, and a
// list of two hundred coordinates is not something anyone can review: a plot
// that is tidy and a plot that is random both come out as a wall of numbers. So
// this file draws the level into a pixel buffer and deflates it into a PNG,
// which is a hundred lines and pays for itself the first time it shows you a
// row of stones that is not a row.
//
// It draws the level's PUBLISHED world coordinates, turned back into grid
// coordinates with the layout's own frame, rather than any internal state. If
// the world conversion is wrong the picture is wrong, which is the point.
//
// Ten seeds side by side is the view worth looking at: one level tells you the
// rules hold, ten tell you whether the generator has a personality.

import zlib from 'node:zlib';
import { makeFrame } from './frame.js';

// --- the smallest raster surface that will do ------------------------------
export function createSurface(w, h, bg = [16, 18, 22, 255]) {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(bg, i * 4);
  const px = (x, y, c, alpha = 1) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    if (alpha >= 1) { data.set(c, i); return; }
    for (let k = 0; k < 3; k++) data[i + k] = Math.round(data[i + k] * (1 - alpha) + c[k] * alpha);
    data[i + 3] = 255;
  };
  return {
    w, h, data, px,
    rect(x0, y0, x1, y1, c, alpha = 1) {
      for (let y = Math.round(y0); y <= Math.round(y1); y++) {
        for (let x = Math.round(x0); x <= Math.round(x1); x++) px(x, y, c, alpha);
      }
    },
    line(x0, y0, x1, y1, c, alpha = 1) {
      const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
      for (let s = 0; s <= steps; s++) px(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps, c, alpha);
    },
    disc(cx, cy, r, c, alpha = 1) {
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
          if (Math.hypot(x - cx, y - cy) <= r) px(x, y, c, alpha);
        }
      }
    },
    ring(cx, cy, r, c, alpha = 1) {
      const steps = Math.max(8, Math.ceil(r * 8));
      for (let s = 0; s < steps; s++) {
        const t = (s / steps) * Math.PI * 2;
        px(cx + Math.cos(t) * r, cy + Math.sin(t) * r, c, alpha);
      }
    },
    poly(points, c, alpha = 1) {
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        this.line(a[0], a[1], b[0], b[1], c, alpha);
      }
    },
  };
}

const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, body) {
  const out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'ascii');
  body.copy(out, 8);
  out.writeUInt32BE(CRC(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

export function toPNG(surface) {
  const { w, h, data } = surface;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(data.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- a very small font, for seed numbers ------------------------------------
const GLYPHS = {
  0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'], 3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '001', '001', '001'],
  8: ['111', '101', '111', '101', '111'], 9: ['111', '101', '111', '001', '111'],
  s: ['111', '100', '111', '001', '111'], e: ['111', '100', '110', '100', '111'],
  d: ['110', '101', '101', '101', '110'], ' ': ['000', '000', '000', '000', '000'],
};
export function text(surface, str, x, y, c, scale = 2) {
  let cx = x;
  for (const ch of String(str)) {
    const g = GLYPHS[ch] || GLYPHS[' '];
    for (let r = 0; r < 5; r++) {
      for (let k = 0; k < 3; k++) {
        if (g[r][k] === '1') surface.rect(cx + k * scale, y + r * scale, cx + k * scale + scale - 1, y + r * scale + scale - 1, c);
      }
    }
    cx += 4 * scale;
  }
}

const COLOURS = {
  path: [46, 52, 62, 255],
  wall: [96, 84, 66, 255],
  stone: [206, 200, 186, 255],
  bench: [176, 158, 130, 255],
  pumpkin: [232, 140, 58, 255],
  lantern: [246, 220, 120, 255],
  bush: [104, 150, 96, 255],
  shed: [150, 118, 82, 255],
  fountain: [150, 196, 214, 255],
  hole: [30, 24, 20, 255],
  dirt: [130, 96, 70, 255],
  firefly: [120, 200, 150, 255],
  jack: [255, 120, 40, 255],
  ghost: [120, 220, 255, 255],
  grave: [220, 110, 220, 255],
  gate: [220, 70, 70, 255],
};

// One level, drawn into an existing surface at an offset, in grid coordinates:
// u to the right, v up, which is how the fixed camera sees the level once the
// 45 degrees are taken out of it.
export function drawLayout(surface, layout, { ox = 0, oy = 0, scale = 4, label = null } = {}) {
  const frame = makeFrame(layout.grid.frame);
  const g = layout.grid.bounds;
  const X = (u) => ox + (u - g.minU) * scale;
  const Y = (v) => oy + (g.maxV - v) * scale;
  const toG = (p) => frame.toGrid(p.x, p.z);

  for (const t of layout.corridor.tiles) {
    const p = toG(t);
    surface.rect(X(p.u - 1), Y(p.v + 1), X(p.u + 1) - 1, Y(p.v - 1) - 1, COLOURS.path);
  }
  for (const w of layout.walls) {
    const a = toG(w.a);
    const b = toG(w.b);
    surface.line(X(a.u), Y(a.v), X(b.u), Y(b.v), COLOURS.wall);
  }
  for (const f of layout.fireflies) {
    const p = toG(f);
    surface.px(X(p.u), Y(p.v), COLOURS.firefly);
  }
  for (const p of layout.props) {
    const q = toG(p);
    const c = COLOURS[p.kind] || [255, 0, 255, 255];
    if (p.foot.shape === 'disc') {
      surface.disc(X(q.u), Y(q.v), p.foot.r * scale, c, 0.85);
    } else {
      // The real oriented footprint, not its bounding circle.
      const cs = Math.cos(p.gridYaw);
      const sn = Math.sin(p.gridYaw);
      const pts = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([su, sv]) => {
        const lu = su * p.foot.halfU;
        const lv = sv * p.foot.halfV;
        return [X(q.u + lu * cs + lv * sn), Y(q.v - lu * sn + lv * cs)];
      });
      surface.poly(pts, c);
      surface.disc(X(q.u), Y(q.v), Math.max(1, scale * 0.22), c, 0.6);
    }
  }
  for (const p of layout.powerups) {
    const q = toG(p);
    surface.disc(X(q.u), Y(q.v), Math.max(2, scale * 0.5), COLOURS.jack);
  }
  for (const s of layout.spawns.graves) {
    const q = toG(s);
    surface.ring(X(q.u), Y(q.v), Math.max(3, scale * 0.9), COLOURS.grave);
  }
  const ghost = toG(layout.spawns.ghost);
  surface.disc(X(ghost.u), Y(ghost.v), Math.max(2, scale * 0.7), COLOURS.ghost);
  const gate = toG(layout.gate.keepOut);
  surface.ring(X(gate.u), Y(gate.v), layout.gate.keepOut.radius * scale, COLOURS.gate);
  if (label !== null) text(surface, label, ox + 4, oy + 4, [230, 230, 230, 255], Math.max(1, Math.round(scale / 2)));
}
// A sheet of levels: `cols` across, each one drawn from its own seed.
export function sheet(layouts, { scale = 4, cols = 5, pad = 8 } = {}) {
  const g = layouts[0].grid.bounds;
  const w = Math.ceil((g.maxU - g.minU) * scale);
  const h = Math.ceil((g.maxV - g.minV) * scale);
  const rows = Math.ceil(layouts.length / cols);
  const surface = createSurface(cols * (w + pad) + pad, rows * (h + pad) + pad, [10, 11, 14, 255]);
  layouts.forEach((layout, k) => {
    const cx = k % cols;
    const cy = Math.floor(k / cols);
    drawLayout(surface, layout, {
      ox: pad + cx * (w + pad), oy: pad + cy * (h + pad), scale, label: 'seed ' + layout.seed,
    });
  });
  return toPNG(surface);
}

export default sheet;
