// PUBLISH, the button beside `save json`.
//
// WHAT IT IS FOR, and what it is not. `save json` writes a file, and a file is
// how a level is KEPT: it goes into public/levels/, it is committed, it ships
// with the site, it survives this database being turned off. Nothing about that
// changes and nothing here replaces it. Publishing answers a different
// question, the one the file cannot: how do I send this to somebody tonight.
//
// So it posts the document to the `levels` table and hands back a short URL.
// The two doors are independent and a level can go out of both.
//
// THREE THINGS IT IS CAREFUL ABOUT.
//
//   IT RUNS THE SAME GUARD AS SAVE AND PLAY. An unplayable level is exactly
//   what the guard exists to catch, and a level that cannot be finished is far
//   worse in somebody else's hands than in the author's own: they have no
//   editor to see the wedge in, and no reason to believe the fault is not
//   theirs.
//
//   IT DOES NOT ASK THE EDITOR FOR ANYTHING IT COULD NOT SURVIVE LOSING. With
//   no network the publish fails, says why, and the editor is exactly the tool
//   it was a second earlier. The owner works offline; a tool that greys itself
//   out because a fetch failed would be a tool that broke.
//
//   THE URL IS COPYABLE IN ONE CLICK. Nobody transcribes a URL by hand, and a
//   ten character code read off a screen and typed into a phone is how a link
//   becomes a wrong link. The status line cannot hold a button, because it is
//   pointer-events: none by design, so the result comes up in a small panel of
//   its own that closes on Escape or on a click outside it.

import { client, makeSlug, readName, writeName, MAX_DOC_BYTES } from './supabase.js';

const STYLE_ID = 'graveyard-publish-style';

// Prefixed and kept here rather than in editor/index.html, which is a page that
// several things draw into. The tokens are that page's own, read off :root, so
// this panel is the editor's colours and not a second opinion about them.
const CSS = `
.gp-back {
  position: fixed; inset: 0; z-index: 40;
  display: grid; place-items: center;
  background: rgba(9, 11, 15, 0.55);
}
.gp {
  width: min(92vw, 420px);
  background: var(--card, #21252d);
  border: 1px solid var(--line, #313742);
  border-radius: var(--r, 7px);
  padding: 14px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5);
  color: var(--ink, #ecead4);
  font: 400 12px/1.5 var(--sans, ui-sans-serif, system-ui, sans-serif);
}
.gp h2 {
  margin: 0 0 10px;
  font: 700 10px/1 var(--mono, ui-monospace, monospace);
  letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--faint, #6f7784);
}
.gp p { margin: 0 0 10px; color: var(--dim, #a2a8b4); }
.gp p.bad { color: var(--bad, #e5615a); }
.gp .link { display: flex; gap: 6px; margin: 0 0 10px; }
.gp input {
  flex: 1 1 auto; min-width: 0;
  background: #15181d; color: var(--ink, #ecead4);
  border: 1px solid var(--line, #313742); border-radius: var(--r-sm, 5px);
  padding: 6px 8px;
  font: 400 11px/1.4 var(--mono, ui-monospace, monospace);
}
.gp .row { display: flex; gap: 6px; justify-content: flex-end; }
.gp button {
  cursor: pointer;
  background: var(--card-hi, #272c36); color: var(--ink, #ecead4);
  border: 1px solid var(--line, #313742); border-radius: var(--r-sm, 5px);
  padding: 6px 10px; font: 400 11px/1.4 inherit;
}
.gp button.go {
  background: var(--accent, #f0902a); border-color: var(--accent, #f0902a);
  color: var(--on-accent, #1a1d23); font-weight: 700;
}
`;

function ensureStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.appendChild(style);
}

// A panel with a message, and optionally a URL to copy. Returns a handle so the
// caller can swap the message while a request is in flight rather than open a
// second one on top of the first.
function panel(doc, title) {
  ensureStyle(doc);
  const back = doc.createElement('div');
  back.className = 'gp-back';
  const box = doc.createElement('div');
  box.className = 'gp';
  const h = doc.createElement('h2');
  h.textContent = title;
  const p = doc.createElement('p');
  const link = doc.createElement('div');
  link.className = 'link';
  link.hidden = true;
  const field = doc.createElement('input');
  field.type = 'text';
  field.readOnly = true;
  field.setAttribute('aria-label', 'the level url');
  const copy = doc.createElement('button');
  copy.type = 'button';
  copy.className = 'go';
  copy.textContent = 'copy';
  link.append(field, copy);
  const row = doc.createElement('div');
  row.className = 'row';
  const close = doc.createElement('button');
  close.type = 'button';
  close.textContent = 'close';
  row.appendChild(close);
  box.append(h, p, link, row);
  back.appendChild(box);
  doc.body.appendChild(back);

  function shut() {
    back.remove();
    doc.removeEventListener('keydown', onKey, true);
  }
  function onKey(e) { if (e.key === 'Escape') shut(); }
  doc.addEventListener('keydown', onKey, true);
  close.addEventListener('click', shut);
  back.addEventListener('mousedown', (e) => { if (e.target === back) shut(); });

  copy.addEventListener('click', async () => {
    // Two ways, because the modern one needs a secure context and the editor is
    // sometimes opened over plain http on a machine on the desk. Selecting the
    // text is the fallback and it is also what a person would do next anyway.
    field.select();
    try {
      await doc.defaultView.navigator.clipboard.writeText(field.value);
      copy.textContent = 'copied';
    } catch {
      try {
        doc.execCommand('copy');
        copy.textContent = 'copied';
      } catch {
        copy.textContent = 'press ctrl+c';
      }
    }
    setTimeout(() => { copy.textContent = 'copy'; }, 1600);
  });

  return {
    close: shut,
    say(text, bad = false) {
      p.textContent = text;
      p.className = bad ? 'bad' : '';
    },
    show(url) {
      link.hidden = false;
      field.value = url;
      field.focus();
      field.select();
    },
  };
}

// The URL a published level plays at.
//
// `level=<slug>` rather than a parameter of its own, because the game already
// takes one `level` and giving it a second way to be told the same thing is two
// code paths where there was one. src/net/supabase.js's isLevelSlug is the rule
// that tells the two apart and it is the same rule at both ends.
export function levelUrl(slug, origin = '') {
  return `${origin}/lab/?game=1&level=${slug}`;
}

// Builds the button's click handler.
//
//   getDoc   returns the document as it is on screen right now
//   guard    the editor's own playability check. Returns false to stop.
//   say      the editor's status line
//
// Everything it needs is passed in, so the editor's side of this is an import
// and one button, and this file can be exercised without an editor at all.
export function createPublishAction({ getDoc, guard = () => true, say = () => {}, api = null, doc = null }) {
  const page = doc || (typeof document !== 'undefined' ? document : null);
  let busy = false;

  return async function publish() {
    if (busy) return;
    const board = api || client();
    if (!board.configured) {
      say('this build has nowhere to publish to. Save a json file instead.');
      return;
    }
    if (!guard('publish')) return;

    const level = getDoc();
    if (!level) return;

    // Refused here rather than at the far end, because the far end's answer to
    // a document over the column's limit is a 400 with a constraint name in it.
    const size = JSON.stringify(level).length;
    if (size > MAX_DOC_BYTES) {
      say(`this level is ${Math.round(size / 1024)} KB and the limit is ${MAX_DOC_BYTES / 1024} KB. Save a json file instead.`);
      return;
    }

    // THE AUTHOR'S NAME, ASKED ONCE AND SHARED WITH THE BOARD. The same person
    // publishes the level and plays it, so being asked twice for the same
    // string would be the site not paying attention. It is optional: the column
    // is nullable and an anonymous level is a level.
    let author = readName();
    if (!author && page && page.defaultView) {
      const asked = page.defaultView.prompt('a name to publish under? (optional)', '');
      if (asked !== null) author = writeName(asked);
    }

    busy = true;
    const ui = page ? panel(page, 'publish') : null;
    if (ui) ui.say('sending the level...');
    say('publishing...');

    let res;
    try {
      res = await board.publish({ name: level.name, author, doc: level });
    } catch (err) {
      // createClient does not throw. This is here because a button that does
      // nothing is the worst outcome available and it must not be reachable
      // even if that ever stops being true.
      res = { ok: false, reason: err && err.message ? err.message : 'something went wrong' };
    }
    busy = false;

    if (!res.ok) {
      const line = `not published: ${res.reason}. The level is untouched, and save json still works.`;
      if (ui) ui.say(line, true);
      say(line);
      return;
    }

    const origin = page && page.defaultView ? page.defaultView.location.origin : '';
    const url = levelUrl(res.slug, origin);
    if (ui) {
      ui.say('published. Anybody with this link can play it.');
      ui.show(url);
    }
    say(`published as ${res.slug}. It plays at ${url}`);
    return url;
  };
}

// A slug, for anything that wants one without a client. Re-exported so the
// editor never has to know which module owns the alphabet.
export { makeSlug };
