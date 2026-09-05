// A RUN: the endless part, the score that survives a maze, and the board.
//
// One wave is one generated maze. Clear every firefly in it and the next maze
// is generated on the spot, harder, with the score and the lives carried over.
// A run ends when the third life goes, and what it leaves behind is a number
// and a story: how far you got, how many mazes you swept, what caught you.
//
// This file is headless on purpose, like the rest of src/game. It decides the
// difficulty curve, keeps the board and writes the share text; it never touches
// a mesh. That means the whole progression can be simulated by the soak without
// a canvas, which is the only way anyone will find out whether wave 9 is
// possible before a player does.

import { DEFAULT_SPEEDS } from './chase.js';
import { TUNING } from './rules.js';

// --- the curve ---------------------------------------------------------------
//
// Pac-Man raises difficulty on four axes at once and never tells you. The same
// four are available here and three of them are used.
//
// WHY NOT SPEED ALONE. The skeleton's speed is a CADENCE: perform.js drives the
// walk from distance travelled, so steps per second is speed / 0.629. The
// shipped 2.15 is 3.42 steps a second and the measured ceiling before it reads
// as a cartoon scramble is about 4.0, which is 2.49. So speed has roughly 16%
// of headroom in it, total, and a curve that spends it by wave four has nothing
// left and no way to get harder. It is the axis with the least room, so it is
// spent slowest.
//
// The room is in the other three: how long you are hunted rather than how fast,
// how much a power pellet is worth, and how big the maze is.
export function waveTuning(wave) {
  const w = Math.max(1, wave);
  // Speed: 2.15 up to the 2.49 ceiling, reached at wave 8 and held. Two thirds
  // of the total headroom is spent over the first four waves, because the
  // difference between wave 1 and wave 2 has to be FELT or the curve does not
  // read as a curve at all.
  const t = Math.min(1, (w - 1) / 7);
  const walk = 2.15 + (2.49 - 2.15) * Math.sqrt(t);

  // Power: the pellet is the player's only counter-attack, and taking it away
  // is the sharpest difficulty knob in the original. 10.0 s down to 4.0 s.
  // Below 4 it stops being worth crossing a maze for, which turns four pellets
  // into scenery, so that is the floor.
  const power = Math.max(4.0, 10.0 - (w - 1) * 0.9);

  // Scatter: the periods when nothing is hunting you. This is the axis with the
  // most room and the least visible, which is exactly why the original uses it.
  // By wave 6 there is essentially no rest.
  const scatterScale = Math.max(0.15, 1 - (w - 1) * 0.17);

  return {
    // TUNING.waves is the mode schedule, alternating scatter and chase. Only
    // the scatter entries are scaled: shortening the chases would make the game
    // EASIER, which is the opposite of a curve, and the last chase is Infinity
    // and cannot be scaled at all.
    waves: TUNING.waves.map((p) => (
      p.mode === 'scatter' && Number.isFinite(p.t)
        ? { ...p, t: Math.max(1.5, p.t * scatterScale) }
        : p
    )),
    speeds: {
      ...DEFAULT_SPEEDS,
      walk,
      // The flee stays under perform.js's authored 1.25 for ever, so a
      // frightened skeleton always plays the original cycle under pace. It is
      // the one thing that must not get harder: a power pellet whose victims
      // outrun you is a punishment.
      fright: DEFAULT_SPEEDS.fright,
      // Cruise Elroy bites earlier and harder as the waves go up.
      elroy: [
        { left: Math.min(0.45, 0.25 + (w - 1) * 0.03), mul: 1.08 },
        { left: Math.min(0.25, 0.10 + (w - 1) * 0.02), mul: 1.16 },
      ],
    },
    powerTime: power,
    scatterScale,
  };
}

// The maze grows too, but slowly and to a ceiling. A level the player cannot
// see the shape of is not harder, it is just longer, and the camera is fixed.
export function waveCells(wave) {
  const w = Math.max(1, wave);
  if (w <= 2) return [5, 4];
  if (w <= 4) return [6, 4];
  if (w <= 7) return [7, 5];
  return [8, 5];
}

// Each wave is its own maze. Derived from the run's seed so a whole run is
// reproducible from one number, which is what makes a shared score checkable
// later and what lets the soak replay a run that went wrong.
export function waveSeed(runSeed, wave) {
  let a = (runSeed ^ (wave * 0x9e3779b1)) >>> 0;
  a = Math.imul(a ^ (a >>> 16), 2246822507) >>> 0;
  a = Math.imul(a ^ (a >>> 13), 3266489909) >>> 0;
  return (a ^ (a >>> 16)) >>> 0;
}

// A wave cleared is worth something on its own, and it climbs, so a player deep
// in a run is playing for more than the fireflies in front of them.
export function clearBonus(wave) {
  return 500 * Math.max(1, wave);
}

// --- the board ---------------------------------------------------------------
//
// Local for now, by the owner's decision, and deliberately written against a
// shape that a shared table can serve later without the game changing. See
// SCHEMA below: every field a global board would need is already recorded, so
// switching it on is a matter of posting these rows somewhere and merging what
// comes back, not of finding out what a score was made of after the fact.
//
// What is NOT here, and must not be added quietly when the global board is
// switched on: a name, or anything else identifying. The moment this stores who
// you are it stops being a list of numbers in your own browser and becomes
// personal data, and that is a decision for its owner to make deliberately.
export const BOARD_KEY = 'graveyard.board.v1';
export const BOARD_SIZE = 10;

// The row a global board would store, stated once so the local and the shared
// versions cannot drift. `seed` and `wave` together replay the exact run, which
// is what a leaderboard needs to have any defence against invented scores: a
// number with no run behind it cannot be checked, and the headless rules can
// replay one in milliseconds.
export const SCHEMA = {
  score: 'integer, the whole run',
  wave: 'integer, mazes reached (1 based)',
  cleared: 'integer, mazes actually swept',
  fireflies: 'integer, collected across the run',
  eaten: 'integer, skeletons caught',
  seed: 'integer, the run seed. every maze derives from it',
  duration: 'seconds of play, rounded',
  caughtBy: 'string, which skeleton ended it, or null if the run was quit',
  at: 'epoch ms',
  version: 'integer, the rules version. a score is only comparable within one',
};

// Bumped whenever a change to the rules would make old scores incomparable: a
// speed, the curve above, the scoring, the maze sizes. A board that mixes
// versions is a board that lies.
export const RULES_VERSION = 1;

function readStore() {
  // Every read and write is wrapped, and both are allowed to do nothing. A
  // private window, cleared site data or a browser set to block storage all
  // THROW on access rather than returning null, and a leaderboard is not worth
  // taking the game down for.
  try {
    const raw = localStorage.getItem(BOARD_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function loadBoard() {
  return readStore()
    .filter((r) => r && Number.isFinite(r.score) && r.version === RULES_VERSION)
    .sort((a, b) => b.score - a.score)
    .slice(0, BOARD_SIZE);
}

// Returns the row's place, 1 based, or 0 if it did not make the board.
export function submitScore(row) {
  const entry = { ...row, at: Date.now(), version: RULES_VERSION };
  const board = [...loadBoard(), entry].sort((a, b) => b.score - a.score).slice(0, BOARD_SIZE);
  try {
    localStorage.setItem(BOARD_KEY, JSON.stringify(board));
  } catch {
    // Storage full or blocked. The run still happened and the share still
    // works; only the remembering fails.
  }
  const place = board.indexOf(entry);
  return place < 0 ? 0 : place + 1;
}

export function isBest(score) {
  const board = loadBoard();
  return board.length === 0 || score > board[0].score;
}

// --- the share ---------------------------------------------------------------
//
// A score is only fun to post if the post says something. "I scored 14,200" is
// a number; "the flanker got me in maze 5 with 8 fireflies left" is a story,
// and the story is the part someone else reads. So the text leads with what
// happened and carries the number after it.
//
// The four skeletons are named for what they do, and which one ended the run is
// the single most characterful fact available, so it goes first when we have it.
const CAUGHT_BY = {
  chaser: 'The chaser ran me down',
  ambusher: 'The ambusher was waiting for me',
  flanker: 'The flanker cut me off',
  loner: 'The loner finally lost patience',
};

export function shareText(run) {
  const lines = [];
  const who = CAUGHT_BY[run.caughtBy];
  if (who) lines.push(`${who} in maze ${run.wave}.`);
  else lines.push(`Made it to maze ${run.wave}.`);

  lines.push(`${run.score.toLocaleString('en-US')} points, ${run.fireflies} fireflies, ${run.eaten} skeletons eaten.`);

  // The near miss is the bit that makes someone want to try it. Only mentioned
  // when it was genuinely near, because a game that tells you every run was
  // nearly a win is a game nobody believes.
  if (run.remaining > 0 && run.remaining <= 12) {
    lines.push(`${run.remaining} fireflies from clearing it.`);
  }
  return lines.join('\n');
}

export function shareUrl(run, pageUrl) {
  const text = `${shareText(run)}\n\nGraveyard, a Pac-Man in a cemetery:`;
  const u = new URL('https://x.com/intent/tweet');
  u.searchParams.set('text', text);
  if (pageUrl) u.searchParams.set('url', pageUrl);
  return u.toString();
}
