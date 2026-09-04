// Seeded randomness, in named streams.
//
// mulberry32 is the generator the props already use (see tombstones.js), so a
// level and the props in it are shuffled by the same arithmetic.
//
// The streams are the point. A generator that pulls every number off one
// sequence is one where adding a step to the maze changes every prop in the
// level, which makes a fix impossible to review: you cannot tell what you
// changed from what merely resequenced. rng.fork('props') hashes the tag into
// the seed, so the maze and the props and the fireflies each have their own
// sequence and stay put when a neighbour changes.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashTag(tag, seed) {
  let h = (seed >>> 0) ^ 0x9e3779b9;
  for (let i = 0; i < tag.length; i++) {
    h = Math.imul(h ^ tag.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

export function createRng(seed, tag = '') {
  const next = mulberry32(tag ? hashTag(tag, seed) : seed >>> 0);
  const api = {
    seed,
    next,
    float: (a = 0, b = 1) => a + (b - a) * next(),
    // Inclusive of lo, exclusive of hi.
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo)),
    // Symmetric jitter, the only randomness a tidy arrangement is allowed.
    jitter: (amount) => (next() * 2 - 1) * amount,
    chance: (p) => next() < p,
    pick: (list) => list[Math.floor(next() * list.length)],
    // Weighted pick over [ [item, weight], ... ].
    weighted(pairs) {
      let total = 0;
      for (const [, w] of pairs) total += w;
      let r = next() * total;
      for (const [item, w] of pairs) { r -= w; if (r <= 0) return item; }
      return pairs[pairs.length - 1][0];
    },
    shuffle(list) {
      const out = list.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    // Sample n distinct items, order preserved, which keeps a row of stones in
    // the order the roster lists them rather than in draw order.
    sample(list, n) {
      const idx = api.shuffle(list.map((_, i) => i)).slice(0, n).sort((a, b) => a - b);
      return idx.map((i) => list[i]);
    },
    fork: (childTag) => createRng(seed, tag ? tag + '/' + childTag : childTag),
  };
  return api;
}

export default createRng;
