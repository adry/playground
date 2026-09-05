// THE EDITOR'S ONLINE HALF: an account, the levels in it, and the choice to
// make one public.
//
// Everything here is ADDITIVE. The editor was a tool that worked with no
// network and no account, and it still is: build a graveyard, press play, save
// a json file, open one from disk. None of that asks who you are and none of it
// stops working when this file's every request fails. What signing in adds is a
// place to keep levels that is not one laptop's downloads folder, and a link
// you can send somebody.
//
// WHAT SIGNED OUT SAVING DOES, since it is the question this design turns on.
// It does not silently keep anything anywhere. The editor already has two ways
// to not lose work, and both of them are better than a half account: the
// autosave, which survives a reload, and the file the editor writes, which
// survives everything. So `save online` while signed out opens this panel at the sign in
// step and finishes the save afterwards, and the level is untouched if the
// person changes their mind. A queue of things to upload later would be a third
// place work can live, and the first place it can be lost.
//
// PRIVATE UNTIL SOMEBODY SAYS OTHERWISE. 002-accounts.sql defaults is_public to
// false and this never argues with it: saving puts a level in your account,
// making it public is a separate switch with a separate press, and the shareable
// link only exists once it is on.

import {
  client, useTokens, isLevelSlug, cleanName, readName, writeName,
  BOUND_KEY, MAX_TITLE, MAX_DOC_BYTES,
} from './supabase.js';
import {
  accessToken, currentUser, displayName, onChange,
  signInWithGoogle, signInWithEmail, signUpWithEmail, signOut,
} from './auth.js';

// THE ONE LINE THAT PUTS THE TOKEN ON EVERY WRITE. supabase.js deliberately
// does not import auth.js, so that /lab/ never pays for an auth client it has
// no button for; this is the editor handing it down. It runs on import because
// the alternative is a save that works only if the panel has been opened first.
useTokens(accessToken);

// The URL a public level plays at.
//
// `level=<slug>` rather than a parameter of its own, because the game already
// takes one `level` and giving it a second way to be told the same thing is two
// code paths where there was one. isLevelSlug in supabase.js is the rule that
// tells a code from a file URL and it is the same rule at both ends.
export function levelUrl(slug, origin = '') {
  return `${origin}/lab/?game=1&level=${slug}`;
}

// WHICH ROW THE OPEN DOCUMENT IS. Kept in localStorage rather than in the
// document, because normalizeLevel builds a level out of the fields it knows
// and would drop an unknown one on the next load. Its whole job is to make the
// second save an update instead of a second level.
function boundSlug() {
  try { const v = localStorage.getItem(BOUND_KEY); return isLevelSlug(v) ? v : null; } catch { return null; }
}
function bind(slug) {
  try {
    if (slug) localStorage.setItem(BOUND_KEY, slug);
    else localStorage.removeItem(BOUND_KEY);
  } catch { /* private window: saving just makes a new level each time */ }
}

const STYLE_ID = 'graveyard-online-style';

// Prefixed, and kept here rather than in editor/index.html, which is a page
// several things draw into. The tokens are that page's own, read off :root, so
// this is the editor's colours and not a second opinion about them.
const CSS = `
.go-back {
  position: fixed; inset: 0; z-index: 40;
  display: grid; place-items: center;
  background: rgba(9, 11, 15, 0.55);
}
.go {
  width: min(94vw, 460px); max-height: 88vh; overflow-y: auto;
  background: var(--card, #21252d);
  border: 1px solid var(--line, #313742);
  border-radius: var(--r, 7px);
  padding: 14px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5);
  color: var(--ink, #ecead4);
  font: 400 12px/1.5 var(--sans, ui-sans-serif, system-ui, sans-serif);
}
.go h2 {
  margin: 0 0 8px;
  font: 700 10px/1 var(--mono, ui-monospace, monospace);
  letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--faint, #6f7784);
  display: flex; align-items: center; gap: 6px;
}
.go h2 + h2 { margin-top: 16px; }
.go p { margin: 0 0 8px; color: var(--dim, #a2a8b4); }
.go p.bad { color: var(--bad, #e5615a); }
.go p.ok { color: var(--ok, #5fb277); }
.go .row { display: flex; gap: 6px; align-items: center; margin: 0 0 6px; }
.go .row:last-child { margin-bottom: 0; }
.go input[type="text"], .go input[type="email"], .go input[type="password"] {
  flex: 1 1 auto; min-width: 0;
  background: #15181d; color: var(--ink, #ecead4);
  border: 1px solid var(--line, #313742); border-radius: var(--r-sm, 5px);
  padding: 6px 8px; font: 400 11px/1.4 var(--sans, ui-sans-serif, system-ui, sans-serif);
}
.go input.link { font-family: var(--mono, ui-monospace, monospace); }
.go button {
  cursor: pointer; white-space: nowrap;
  background: var(--card-hi, #272c36); color: var(--ink, #ecead4);
  border: 1px solid var(--line, #313742); border-radius: var(--r-sm, 5px);
  padding: 6px 10px; font: 400 11px/1.4 inherit;
}
.go button:hover { background: #2e3440; }
.go button[disabled] { opacity: 0.4; cursor: not-allowed; }
.go button.go-primary {
  background: var(--accent, #f0902a); border-color: var(--accent, #f0902a);
  color: var(--on-accent, #1a1d23); font-weight: 700;
}
.go button.danger { color: var(--bad, #e5615a); }
.go .grow { flex: 1 1 auto; }
.go ul.levels { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.go ul.levels li {
  display: flex; gap: 6px; align-items: center;
  background: #1b1f26; border: 1px solid var(--line-soft, #262b34);
  border-radius: var(--r-sm, 5px); padding: 5px 6px;
}
.go ul.levels li.bound { border-color: var(--accent-dim, #a8641d); }
.go .lname { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.go .when { color: var(--faint, #6f7784); font-size: 10px; }
.go .dot {
  flex: 0 0 auto; font: 600 9px/1.6 var(--mono, ui-monospace, monospace);
  letter-spacing: 0.08em; text-transform: uppercase;
  padding: 0 6px; border-radius: 999px;
  border: 1px solid var(--line, #313742); color: var(--faint, #6f7784);
}
.go .dot[data-public="1"] { color: var(--on-accent, #1a1d23); background: var(--accent, #f0902a); border-color: var(--accent, #f0902a); }
.go .sep { height: 1px; background: var(--line-soft, #262b34); margin: 12px 0; }
`;

function ensureStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.appendChild(style);
}

function el(doc, tag, props = {}, kids = []) {
  const node = doc.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) if (c) node.appendChild(c);
  return node;
}

const when = (iso) => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(t).toISOString().slice(0, 10);
};

// Copy, two ways, because the modern one needs a secure context and the editor
// is sometimes opened over plain http on a machine on the desk. Selecting the
// text is the fallback and it is also what a person would do next anyway.
async function copyFrom(field, button, doc) {
  field.select();
  try {
    await doc.defaultView.navigator.clipboard.writeText(field.value);
    button.textContent = 'copied';
  } catch {
    try { doc.execCommand('copy'); button.textContent = 'copied'; } catch { button.textContent = 'ctrl+c'; }
  }
  setTimeout(() => { button.textContent = 'copy'; }, 1600);
}

// createOnlinePanel({ getDoc, setDoc, guard, say })
//
//   getDoc  the document as it is on screen right now
//   setDoc  put a document into the editor. Used by "open" in the levels list.
//   guard   the editor's own playability check, so a level cannot go out broken
//   say     the editor's status line
//
// Everything it needs is passed in, so the editor's side of this is an import
// and two buttons, and this file can be exercised without an editor at all.
export function createOnlinePanel({
  getDoc, setDoc = null, guard = () => true, say = () => {},
  api = null, page = typeof document !== 'undefined' ? document : null,
}) {
  const board = () => api || client();
  const state = { user: null, levels: null, busy: false, note: '', bad: false, loading: false, form: { email: '', password: '' } };
  let root = null;   // the .go panel body, while it is open
  let intent = null; // what to do as soon as somebody signs in

  // COMING BACK FROM GOOGLE. The redirect lands on this page with `?code=` in
  // the URL, the auth client exchanges it for a session and then cleans the URL
  // up, so this has to be read before anything else looks at it. It is the
  // difference between arriving back in the editor signed in with the panel
  // open where you left it, and arriving back at an editor that looks exactly
  // as it did before you pressed the button.
  const cameBackFromGoogle = Boolean(
    page && page.defaultView && /[?&]code=/.test(page.defaultView.location.search),
  );

  // Told when the Google round trip finishes, which happens on page load rather
  // than in response to a click: the person left this page and came back to it.
  onChange((user) => {
    state.user = user;
    state.levels = null;
    if (user && intent) { const go = intent; intent = null; go(); return; }
    if (user && cameBackFromGoogle && !root) { open(); return; }
    draw();
  });

  // CONSTRUCTING THE AUTH CLIENT ON PAGE LOAD, and not later, which is the only
  // reason this line is here rather than inside open(). The code exchange
  // happens when the client is built; if nothing built it until somebody
  // pressed a button, a person coming back from Google would land on a page
  // that had quietly not finished signing them in.
  currentUser().then((user) => { state.user = user; draw(); });

  function note(text, bad = false) {
    state.note = text;
    state.bad = bad;
    if (text) say(text);
    draw();
  }

  // --- the level this document is ------------------------------------------------

  async function saveCurrent({ makePublic = null } = {}) {
    if (state.busy) return null;
    const level = getDoc();
    if (!level) return null;

    const size = JSON.stringify(level).length;
    if (size > MAX_DOC_BYTES) {
      note(`this level is ${Math.round(size / 1024)} KB and the limit is ${MAX_DOC_BYTES / 1024} KB. Save a json file instead.`, true);
      return null;
    }
    if (!state.user) { open(); intent = () => saveCurrent({ makePublic }); return null; }
    // THE SAME GUARD AS SAVE AND PLAY. A level that cannot be finished is far
    // worse in somebody else's hands than in its author's: they have no editor
    // to see the wedge in and no reason to think the fault is not theirs.
    if (!guard('save')) return null;

    state.busy = true;
    note('saving...');
    const slug = boundSlug();
    let res;
    if (slug) {
      const changes = { doc: level, name: level.name };
      if (makePublic !== null) changes.isPublic = makePublic;
      res = await board().updateLevel(slug, changes);
      // The row is gone, or was never this account's. Falling back to a new
      // level is the right answer: the alternative is telling somebody their
      // work cannot be saved because of a string in localStorage.
      if (!res.ok && !res.offline) {
        bind(null);
        res = await board().publish({
          name: level.name, author: readName(), doc: level,
          owner: state.user.id, isPublic: makePublic === true,
        });
      }
    } else {
      res = await board().publish({
        name: level.name, author: readName(), doc: level,
        owner: state.user.id, isPublic: makePublic === true,
      });
    }
    state.busy = false;
    if (!res.ok) {
      note(`not saved: ${res.reason}. The level is untouched, and saving a file still works.`, true);
      return null;
    }
    bind(res.slug || slug);
    state.levels = null;
    note(makePublic === true ? 'saved, and public.' : 'saved to your account.');
    load();
    return res.slug || slug;
  }

  async function setPublic(slug, on) {
    if (!state.user) return;
    state.busy = true;
    note(on ? 'publishing...' : 'making it private...');
    const res = await board().setPublic(slug, on);
    state.busy = false;
    if (!res.ok) { note(`not changed: ${res.reason}`, true); return; }
    if (state.levels) {
      const row = state.levels.find((l) => l.slug === slug);
      if (row) row.is_public = on;
    }
    note(on ? 'public. Anybody with the link can play it.' : 'private again. The link stops working.');
  }

  async function remove(slug, name) {
    const win = page && page.defaultView;
    if (win && !win.confirm(`delete "${name}"? This cannot be undone.`)) return;
    state.busy = true;
    note('deleting...');
    const res = await board().deleteLevel(slug);
    state.busy = false;
    if (!res.ok) { note(`not deleted: ${res.reason}`, true); return; }
    if (boundSlug() === slug) bind(null);
    state.levels = (state.levels || []).filter((l) => l.slug !== slug);
    note('deleted.');
  }

  async function rename(slug, current) {
    const win = page && page.defaultView;
    const asked = win ? win.prompt('a new name for this level', current) : null;
    if (asked === null) return;
    const name = cleanName(asked, MAX_TITLE);
    if (!name) return;
    state.busy = true;
    const res = await board().updateLevel(slug, { name });
    state.busy = false;
    if (!res.ok) { note(`not renamed: ${res.reason}`, true); return; }
    const row = (state.levels || []).find((l) => l.slug === slug);
    if (row) row.name = name;
    note('renamed.');
  }

  async function openLevel(slug, name) {
    if (!setDoc) return;
    state.busy = true;
    note(`opening ${name}...`);
    const res = await board().fetchLevel(slug);
    state.busy = false;
    if (!res.ok) { note(`could not open it: ${res.reason}`, true); return; }
    bind(slug);
    setDoc(res.level.doc, name);
    note(`opened ${name}. Saving now updates it rather than making a copy.`);
    close();
  }

  async function load() {
    if (!state.user || state.loading) return;
    state.loading = true;
    draw();
    const res = await board().myLevels(state.user.id);
    state.loading = false;
    state.levels = res.ok ? res.levels : [];
    if (!res.ok) note(`could not read your levels: ${res.reason}`, true);
    else draw();
  }

  // --- the panel ------------------------------------------------------------------

  function close() {
    if (!root) return;
    root.parentNode.remove();
    root = null;
    page.removeEventListener('keydown', onKey, true);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  function open() {
    if (!page || root) { draw(); return; }
    ensureStyle(page);
    const back = el(page, 'div', { class: 'go-back' });
    root = el(page, 'div', { class: 'go' });
    back.appendChild(root);
    page.body.appendChild(back);
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    page.addEventListener('keydown', onKey, true);
    draw();
    if (state.user && state.levels === null) load();
  }

  function draw() {
    if (!root || !page) return;
    root.textContent = '';
    root.append(...(state.user ? signedIn() : signedOut()));
    if (state.note) {
      root.appendChild(el(page, 'p', { class: state.bad ? 'bad' : 'ok', text: state.note }));
    }
    root.appendChild(el(page, 'div', { class: 'row' }, [
      el(page, 'span', { class: 'grow' }),
      el(page, 'button', { text: 'close', onclick: close }),
    ]));
  }

  function signedOut() {
    // THE TYPED TEXT LIVES IN `state`, NOT IN THE INPUT. Every redraw rebuilds
    // this panel from scratch, and a redraw happens the moment the button is
    // pressed, to say "signing in...". Reading the value off the element would
    // therefore work exactly once and then hand back an empty string, and a
    // failed password would clear the email as well and make the person type
    // both again.
    const email = el(page, 'input', {
      type: 'email', placeholder: 'email', autocomplete: 'username', value: state.form.email,
      oninput: (e) => { state.form.email = e.target.value; },
    });
    const pass = el(page, 'input', {
      type: 'password', placeholder: 'password', autocomplete: 'current-password', value: state.form.password,
      oninput: (e) => { state.form.password = e.target.value; },
    });

    const go = async (fn, what) => {
      const who = state.form.email.trim();
      const secret = state.form.password;
      if (!who || !secret) { note('an email and a password, first', true); return; }
      state.busy = true;
      note(`${what}...`);
      const res = await fn(who, secret);
      state.busy = false;
      if (!res.ok) { note(res.reason, true); return; }
      if (res.needsConfirmation) {
        note('account made. Check your email for the link, then sign in.');
        return;
      }
      // The password is not kept a moment longer than the request that used it.
      state.form.password = '';
      // onChange redraws, and runs whatever was waiting on somebody signing in.
      note('');
    };

    // A FORM, so that pressing enter in the password field signs you in. Two
    // inputs and a button that only respond to a click is the sort of thing
    // that reads as broken rather than as unfinished.
    const form = el(page, 'form', {
      onsubmit: (e) => { e.preventDefault(); go(signInWithEmail, 'signing in'); },
    }, [
      el(page, 'div', { class: 'row' }, [email]),
      el(page, 'div', { class: 'row' }, [pass]),
      el(page, 'div', { class: 'row' }, [
        el(page, 'button', { class: 'grow', type: 'submit', text: 'sign in' }),
        el(page, 'button', {
          class: 'grow', type: 'button', text: 'create account',
          onclick: () => go(signUpWithEmail, 'making an account'),
        }),
      ]),
    ]);

    return [
      el(page, 'h2', { text: 'sign in' }),
      el(page, 'p', {
        text: 'Your levels are kept in your account, private until you say otherwise. '
          + 'The editor works signed out too: building, playing and saving a file need nobody.',
      }),
      el(page, 'div', { class: 'row' }, [
        el(page, 'button', {
          class: 'grow go-primary',
          type: 'button',
          text: 'continue with Google',
          onclick: async () => {
            note('sending you to Google...');
            const res = await signInWithGoogle();
            // On success the browser has already left this page, so anything
            // after this line only runs when it did not.
            if (!res.ok) note(res.reason, true);
          },
        }),
      ]),
      el(page, 'div', { class: 'sep' }),
      form,
    ];
  }

  function signedIn() {
    const out = [];
    out.push(el(page, 'h2', {}, [
      el(page, 'span', { class: 'grow', text: displayName(state.user) }),
      el(page, 'button', {
        text: 'sign out',
        onclick: async () => {
          const res = await signOut();
          if (!res.ok) { note(res.reason, true); return; }
          state.user = null;
          state.levels = null;
          note('signed out. The editor works exactly the same.');
        },
      }),
    ]));

    // --- this level ---------------------------------------------------------
    const slug = boundSlug();
    const row = (state.levels || []).find((l) => l.slug === slug);
    const level = getDoc();
    out.push(el(page, 'h2', { text: 'this level' }));
    out.push(el(page, 'p', {
      text: slug
        ? `"${(row && row.name) || (level && level.name) || 'this level'}" is in your account. Saving updates it.`
        : 'This level is not in your account yet.',
    }));
    out.push(el(page, 'div', { class: 'row' }, [
      el(page, 'button', {
        class: 'grow go-primary',
        text: slug ? 'save changes' : 'save to my account',
        onclick: () => saveCurrent(),
      }),
      slug ? el(page, 'button', {
        text: row && row.is_public ? 'make private' : 'make public',
        onclick: () => setPublic(slug, !(row && row.is_public)),
      }) : null,
    ]));
    if (slug && row && row.is_public) out.push(linkRow(slug));

    // --- my levels ----------------------------------------------------------
    out.push(el(page, 'h2', {}, [
      el(page, 'span', { class: 'grow', text: 'my levels' }),
      el(page, 'button', { text: 'refresh', onclick: () => { state.levels = null; load(); } }),
    ]));
    if (state.loading) out.push(el(page, 'p', { text: 'reading...' }));
    else if (!state.levels || !state.levels.length) {
      out.push(el(page, 'p', { text: 'nothing here yet. Save this one and it will be.' }));
    } else {
      const list = el(page, 'ul', { class: 'levels' });
      for (const l of state.levels) {
        list.appendChild(el(page, 'li', { class: l.slug === slug ? 'bound' : null }, [
          el(page, 'span', { class: 'lname' }, [
            el(page, 'span', { text: l.name }),
            el(page, 'span', { class: 'when', text: `  ${when(l.updated_at || l.created_at)}` }),
          ]),
          el(page, 'span', { class: 'dot', 'data-public': l.is_public ? '1' : '0', text: l.is_public ? 'public' : 'private' }),
          setDoc ? el(page, 'button', { text: 'open', onclick: () => openLevel(l.slug, l.name) }) : null,
          el(page, 'button', { text: l.is_public ? 'hide' : 'share', onclick: () => setPublic(l.slug, !l.is_public) }),
          el(page, 'button', { text: 'rename', onclick: () => rename(l.slug, l.name) }),
          el(page, 'button', { class: 'danger', text: 'delete', onclick: () => remove(l.slug, l.name) }),
        ]));
      }
      out.push(list);
    }
    return out;
  }

  function linkRow(slug) {
    const origin = page.defaultView ? page.defaultView.location.origin : '';
    const field = el(page, 'input', { type: 'text', class: 'link', readonly: 'readonly', 'aria-label': 'the level link' });
    field.value = levelUrl(slug, origin);
    const copy = el(page, 'button', { class: 'go-primary', text: 'copy' });
    copy.addEventListener('click', () => copyFrom(field, copy, page));
    return el(page, 'div', { class: 'row' }, [field, copy]);
  }

  return {
    // The button beside save. Signed in, it saves; signed out, it opens
    // the panel and saves as soon as there is somebody to save for.
    save: () => saveCurrent(),
    // The button that opens the account and the list.
    open,
    close,
    // For the checks.
    state,
  };
}

export { readName, writeName };
