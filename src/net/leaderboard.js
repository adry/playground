// THE BOARD ON THE END CARD.
//
// src/game/run.js keeps a board of its own in localStorage: ten numbers, no
// names, private to the browser they were made in. That board is not going
// anywhere and this one does not replace it. This is the shared one, and the
// difference between them is the whole reason this file is careful.
//
// A NAME IS PERSONAL DATA AND THE LOCAL BOARD DELIBERATELY HAS NONE. run.js
// says so in a comment written before this existed: storing who you are was
// left as a decision for the owner to make deliberately. They have made it, for
// the SHARED board only. So the name lives here and in the row that goes to the
// database, the local board stays exactly as anonymous as it was, and nothing
// in run.js has to change for either to be true.
//
// WHAT THIS FILE OWES THE GAME, in order of importance:
//
//   THE CARD APPEARS FIRST. attach() is called after the card is built and it
//   returns immediately. Everything below happens afterwards, into a card that
//   is already on screen, and a player who wants to press Again never waits for
//   a request. With no network at all the card is exactly the card that was
//   there before this file existed, plus one line saying the score is unsaved.
//
//   A SCORE THAT DID NOT SAVE SAYS SO. The one thing worse than a board that is
//   down is a board that is down and pretends otherwise. Every failure gets a
//   sentence and a way to try again.
//
//   AND IT IS NOT TAMPER PROOF. Anyone can read the publishable key out of the
//   page and post any score they like without playing; the constraints in
//   supabase/schema.sql reject nonsense, not cheating. That is what an
//   anonymous client-written board IS. The fix is at the foot of schema.sql and
//   it is a bigger job than this file.

import { client, readName, writeName, cleanName, isLevelSlug } from './supabase.js';

export const BOARD_LIMIT = 10;

// The card's own stylesheet lives in lab/index.html and owns `.card`, `.board`,
// `.share` and `.again`. What is added here is added here, in one block, once:
// the alternative is editing a page that three other things are also drawing
// into. Every class is prefixed so nothing can collide with what is already
// there, and the two that are NOT prefixed, `board` and `mine`, are reused on
// purpose because a shared board should look like the local one.
const STYLE_ID = 'graveyard-board-style';
const CSS = `
.gb { margin: 0 0 14px; }
.gb-tabs { display: flex; gap: 4px; justify-content: center; margin: 0 0 8px; }
.gb-tabs button {
  border: 0; cursor: pointer; padding: 4px 10px; border-radius: 999px;
  font: 600 11px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: 0.08em; text-transform: uppercase;
  background: transparent; color: #9aa2b1;
}
.gb-tabs button[aria-pressed="true"] { background: #e5e8ee; color: #2f3542; }
.gb-rows { margin: 0 0 8px; }
.gb-rows li { display: flex; gap: 8px; }
.gb-rows .gb-who { flex: 1 1 auto; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gb-rows .gb-n { flex: 0 0 1.6em; text-align: right; color: #9aa2b1; }
.gb-rows .gb-pts { flex: 0 0 auto; }
.gb-rows .gb-gap { color: #b3b9c5; }
.gb-note {
  margin: 0 0 12px;
  font: 400 11.5px/1.5 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color: #7b8494;
}
.gb-note .gb-bad { color: #a2564f; }
.gb-note button {
  border: 0; background: none; padding: 0; margin-left: 6px; cursor: pointer;
  font: inherit; color: #2f3542; text-decoration: underline;
}
.gb-name { display: flex; gap: 6px; justify-content: center; margin: 0 0 12px; }
.gb-name input {
  flex: 0 1 150px; min-width: 0; padding: 7px 10px; border-radius: 999px;
  border: 1px solid #d8dce4; background: #fff; color: #2f3542;
  font: 400 13px/1 inherit;
}
.gb-name button {
  border: 0; border-radius: 999px; padding: 8px 14px; cursor: pointer;
  background: #e5e8ee; color: #2f3542; font: 600 13px/1 inherit;
}
`;

function ensureStyle(doc) {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.appendChild(style);
}

const NUM = (n) => Number(n || 0).toLocaleString('en-US');

// How long a run lasted, for the row. Minutes past sixty seconds because a
// board full of "184s" is a board of numbers nobody reads.
function shortTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m`;
}

// ATTACH THE SHARED BOARD TO AN END CARD.
//
//   card      the .card element, already built and about to be shown
//   run       { score, fireflies, seconds }
//   levelSlug the published level this run was on, or null
//
// Returns immediately, always. Never throws: a caller that wrapped this in a
// try/catch would be right to, and should not have to.
export function attach(card, { run, levelSlug = null, api = null } = {}) {
  try {
    return mount(card, { run, levelSlug, api: api || client() });
  } catch {
    // A board that cannot even build its own DOM is not a reason for a player
    // to lose their end card.
    return null;
  }
}

function mount(card, { run, levelSlug, api }) {
  if (!card || !api || !api.configured) return null;

  const doc = card.ownerDocument;
  ensureStyle(doc);

  const slug = isLevelSlug(levelSlug) ? levelSlug : null;
  const mine = {
    score: Math.max(0, Math.floor(Number(run && run.score) || 0)),
    fireflies: Math.max(0, Math.floor(Number(run && run.fireflies) || 0)),
    seconds: Math.max(0, Math.floor(Number(run && run.seconds) || 0)),
  };

  const box = doc.createElement('div');
  box.className = 'gb';

  // TWO BOARDS, when the run was on a published level. "Best in the world" and
  // "best in THIS graveyard" are different questions and the second one is the
  // reason somebody sends a friend a level. With no published level there is
  // one board and no tabs, because a row of one tab is furniture.
  let scope = slug ? 'level' : 'global';
  let tabs = null;
  if (slug) {
    tabs = doc.createElement('div');
    tabs.className = 'gb-tabs';
    for (const [key, label] of [['level', 'this graveyard'], ['global', 'everyone']]) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('aria-pressed', String(key === scope));
      b.addEventListener('click', () => {
        if (scope === key) return;
        scope = key;
        for (const other of tabs.children) {
          other.setAttribute('aria-pressed', String(other === b));
        }
        showRows();
      });
      tabs.appendChild(b);
    }
    box.appendChild(tabs);
  }

  const rows = doc.createElement('ol');
  rows.className = 'board gb-rows';
  box.appendChild(rows);

  const note = doc.createElement('p');
  note.className = 'gb-note';
  box.appendChild(note);

  // The share link is the anchor the card ends on, so the board goes in front
  // of it: the order on the card is what happened, then where it puts you, then
  // what to do about it.
  const before = card.querySelector('.share') || card.querySelector('.again');
  if (before) card.insertBefore(box, before);
  else card.appendChild(box);

  // Nothing written into a card that is gone. showCard rebuilds this element
  // from scratch on every run, so a request still in flight from the previous
  // run would otherwise draw its answer into a card nobody is looking at.
  const live = () => box.isConnected;

  const state = {
    // Per scope: the rows, whether they have been asked for, and our placing.
    global: { rows: null, rank: null, failed: null },
    level: { rows: null, rank: null, failed: null },
    posted: false,
    posting: false,
  };

  function say(text, bad = false, retry = null) {
    if (!live()) return;
    note.textContent = '';
    if (!text) return;
    const span = doc.createElement('span');
    if (bad) span.className = 'gb-bad';
    span.textContent = text;
    note.appendChild(span);
    if (retry) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = 'try again';
      b.addEventListener('click', retry);
      note.appendChild(b);
    }
  }

  function drawRows() {
    if (!live()) return;
    const bucket = state[scope];
    rows.textContent = '';
    if (bucket.rows === null) {
      const li = doc.createElement('li');
      li.textContent = bucket.failed || 'reading the board...';
      rows.appendChild(li);
      return;
    }
    if (!bucket.rows.length) {
      const li = doc.createElement('li');
      li.textContent = 'nobody has posted a score here yet';
      rows.appendChild(li);
    }

    // Our own row is the one that matches on every number we sent, and only the
    // FIRST such row is marked: two people called the same thing with the same
    // score is a tie, not a reason to light up both.
    let marked = false;
    bucket.rows.forEach((row, i) => {
      const li = doc.createElement('li');
      const isMine = state.posted && !marked
        && row.score === mine.score
        && row.fireflies === mine.fireflies
        && cleanName(row.name) === cleanName(readName());
      if (isMine) { li.className = 'mine'; marked = true; }

      const n = doc.createElement('span');
      n.className = 'gb-n';
      n.textContent = `${i + 1}`;
      const who = doc.createElement('span');
      who.className = 'gb-who';
      who.textContent = row.name;
      const pts = doc.createElement('span');
      pts.className = 'gb-pts';
      pts.textContent = `${NUM(row.score)} · ${shortTime(row.seconds)}`;
      li.append(n, who, pts);
      rows.appendChild(li);
    });

    // "YOU ARE 47TH" IS THE LINE THAT MAKES SOMEBODY PLAY AGAIN, and it is the
    // only thing the top ten cannot tell a player who is not in it. Shown only
    // when the score actually went in, because a placing for a row that was
    // never written would be a guess.
    if (state.posted && !marked && bucket.rank) {
      const li = doc.createElement('li');
      li.className = 'mine gb-gap';
      const n = doc.createElement('span');
      n.className = 'gb-n';
      n.textContent = `${bucket.rank}`;
      const who = doc.createElement('span');
      who.className = 'gb-who';
      who.textContent = readName() || 'you';
      const pts = doc.createElement('span');
      pts.className = 'gb-pts';
      pts.textContent = `${NUM(mine.score)} · ${shortTime(mine.seconds)}`;
      li.append(n, who, pts);
      rows.appendChild(li);
    }
  }

  async function showRows() {
    drawRows();
    const bucket = state[scope];
    if (bucket.rows !== null || bucket.loading) return;
    bucket.loading = true;
    const at = scope;
    const res = await api.topScores({
      levelSlug: at === 'level' ? slug : null,
      limit: BOARD_LIMIT,
    });
    bucket.loading = false;
    if (!live()) return;
    if (res.ok) bucket.rows = res.rows;
    // A BOARD THAT CANNOT LOAD SHOWS NOTHING, not an error where the numbers
    // should be. The line is quiet and the card is otherwise untouched.
    else bucket.failed = res.reason;
    if (scope === at) drawRows();
    if (res.ok) placeMe(at);
  }

  // Only asked when the answer is not already on screen: a score in the top ten
  // has its placing in front of it, and a request to count the rows above it
  // would be a round trip to learn a number the page already knows.
  async function placeMe(at) {
    const bucket = state[at];
    if (!state.posted || bucket.rank || !bucket.rows) return;
    const inBoard = bucket.rows.some((r) => r.score === mine.score && cleanName(r.name) === cleanName(readName()));
    if (inBoard) return;
    const res = await api.rankOf({ score: mine.score, levelSlug: at === 'level' ? slug : null });
    if (!live() || !res.ok) return;
    bucket.rank = res.rank;
    if (scope === at) drawRows();
  }

  // Posting. The score has already been kept locally by run.js before this runs,
  // so a failure here loses nothing except the shared row, and it says so.
  async function post(name) {
    if (state.posting || state.posted) return;
    state.posting = true;
    say('saving your score...');
    const res = await api.postScore({
      name,
      score: mine.score,
      fireflies: mine.fireflies,
      seconds: mine.seconds,
      levelSlug: slug,
    });
    state.posting = false;
    if (!live()) return;
    if (!res.ok) {
      say(`your score is not on the board: ${res.reason}.`, true, () => post(name));
      return;
    }
    state.posted = true;
    say('');
    // The row we just wrote is not in the copy of the board we are holding, so
    // both scopes are thrown away and asked for again. Two requests at worst,
    // only after a successful post, and it is the difference between a player
    // seeing their own name and wondering whether it worked.
    state.global = { rows: null, rank: null, failed: null };
    state.level = { rows: null, rank: null, failed: null };
    showRows();
  }

  // THE NAME, ASKED FOR ONCE. Not a prompt(): a modal dialogue over a game that
  // has just ended is the browser interrupting the moment the card exists for,
  // and it blocks the page while it is open. A field on the card is the same
  // question asked politely, and it does not stop the board loading behind it.
  const known = readName();
  if (known) {
    post(known);
  } else {
    const form = doc.createElement('form');
    form.className = 'gb-name';
    const input = doc.createElement('input');
    input.type = 'text';
    input.maxLength = 20;
    input.placeholder = 'your name';
    input.setAttribute('aria-label', 'the name to put on the board');
    const go = doc.createElement('button');
    go.type = 'submit';
    go.textContent = 'post';
    form.append(input, go);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const who = writeName(input.value);
      if (!who) { input.focus(); return; }
      form.remove();
      post(who);
    });
    box.insertBefore(form, note.nextSibling);
    say('your score is only in this browser until you put a name to it.');
  }

  showRows();
  return box;
}

export default attach;
