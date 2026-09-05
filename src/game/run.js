// A RUN: one arena, played until you are caught, and the board it leaves.
//
// THERE ARE NO WAVES ANY MORE. There was a whole difficulty curve here: one
// wave was one generated maze, clearing every firefly in it generated the next
// one harder, and `waveTuning` spent four axes of difficulty over eight waves.
// The owner has replaced the whole idea with a board that refills for ever, so
// there is nothing to clear, nothing to progress to and no curve to spend. What
// is left is the run's own arithmetic: the score, the board and the share text.
//
// WHERE THE DIFFICULTY WENT, since a run with no curve is a run with no shape.
// It is in rules.js now and it is the HERD: one skeleton at the start, one more
// allowed every six fireflies, up to five. That is the curve, it is driven by
// how well the player is doing rather than by how long they have survived, and
// it is the owner's own rule rather than an invention of this file.
//
// This file is headless on purpose, like the rest of src/game. It keeps the
// board and writes the share text; it never touches a mesh.

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
  fireflies: 'integer, collected across the run',
  seed: 'integer, the run seed. every maze derives from it',
  duration: 'seconds of play, rounded',
  caughtBy: 'string, which skeleton ended it, or null if the run was quit',
  at: 'epoch ms',
  version: 'integer, the rules version. a score is only comparable within one',
};

// Bumped whenever a change to the rules would make old scores incomparable: a
// speed, the curve above, the scoring, the maze sizes. A board that mixes
// versions is a board that lies.
//
// THREE. Version 1 was the game with the power pellet in it, where four
// lanterns paid 500 each and a chain of four skeletons paid 3000 on top.
// Version 2 was that game with the pellet removed. Version 3 is a different
// game again: no waves, no clear bonus, a board that refills for ever, a ghost
// twenty per cent faster and a herd that grows from one to five. A run in it is
// unbounded where a version 2 run ended when the arena ran out of fireflies, so
// the scores are not comparable in either direction.
export const RULES_VERSION = 3;

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
  const mins = Math.max(0, Math.round((run.duration || 0) / 6) / 10);
  if (who) lines.push(`${who} after ${mins} minutes in the graveyard.`);
  else lines.push(`${mins} minutes in the graveyard.`);

  lines.push(`${run.score.toLocaleString('en-US')} points, ${run.fireflies} fireflies.`);

  // THE NEAR MISS IS GONE with the thing it was about. It used to say how few
  // fireflies were left to clear the arena, and an arena cannot be cleared any
  // more, so there is no near miss to report: a run does not end short of
  // anything, it ends when something catches you.
  return lines.join('\n');
}

export function shareUrl(run, pageUrl) {
  const text = `${shareText(run)}\n\nGraveyard, a Pac-Man in a cemetery:`;
  const u = new URL('https://x.com/intent/tweet');
  u.searchParams.set('text', text);
  if (pageUrl) u.searchParams.set('url', pageUrl);
  return u.toString();
}
