// ACCOUNTS.
//
// supabase/002-accounts.sql is the contract: a level belongs to somebody, it is
// PRIVATE until they say otherwise, and only a signed in person may write one.
// Scores stay open to guests, because asking a passer-by to make an account
// before the one thing they might do is a wall in the wrong place.
//
// WHY THIS ONE IMPORTS A LIBRARY WHEN THE REST OF THIS DIRECTORY DOES NOT.
//
// The rule so far has been that two tables over PostgREST is a handful of fetch
// calls and not worth a dependency, and src/net/supabase.js is the proof: the
// whole data layer is a few hundred lines and it is tested. That reasoning does
// not survive OAuth. A Google sign in is a redirect out, a PKCE verifier kept
// across it, a code exchange on the way back, a refresh token in storage, a
// timer that renews the access token before it expires, and a lock so that two
// tabs do not refresh at once and invalidate each other. Every one of those is
// a thing that is wrong quietly, for months, in a way no test written by the
// person who got it wrong will catch.
//
// So the auth half is the library's and the data half stays ours. The numbers,
// measured on this project with esbuild and gzip -9:
//
//   @supabase/supabase-js   218 KB minified   57.4 KB gzipped
//   @supabase/auth-js       101 KB minified   24.3 KB gzipped
//
// supabase-js is auth plus PostgREST plus realtime plus storage plus functions,
// and this project uses one of those five and has already written it. auth-js
// is the auth client on its own, it is what supabase-js itself depends on for
// this, and it costs 33 KB gzipped less. For scale: three.js is 136 KB gzipped
// on the same pages.
//
// AND IT IS ONLY ON THE EDITOR. /lab/ never imports this file. The game posts
// scores as a guest, which is what the score policy allows, so the page a
// player lands on does not carry a sign in client it has no button for. When
// the game grows one, this is the file it imports and nothing else changes.

import { GoTrueClient } from '@supabase/auth-js';
import { SUPABASE_URL, SUPABASE_KEY } from './supabase.js';

// Its own key, and versioned, so that a change to what is stored is a new key
// rather than a session that deserialises into something unexpected.
export const AUTH_STORAGE_KEY = 'graveyard.auth.v1';

let shared = null;

// The client, built on first use. Not at import: a page that imports this
// module for one pure function should not start a network client, and the
// constructor reads storage and the URL, both of which need a window.
export function auth() {
  if (shared) return shared;
  shared = new GoTrueClient({
    url: `${SUPABASE_URL}/auth/v1`,
    // The publishable key on the auth endpoint too. It is the gateway's routing
    // key, not a credential: the credential is the password or the OAuth code.
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    storageKey: AUTH_STORAGE_KEY,
    // THE THREE THAT MATTER, and all three are the library earning its place.
    //
    // persistSession keeps the session in localStorage, so a refresh does not
    // sign you out. An editor that logs you out when you reload is worse than
    // an editor with no login in it.
    persistSession: true,
    // autoRefreshToken renews the access token before it expires. A Supabase
    // access token lives an hour; a person draws a graveyard for longer than
    // that, and without this the save at the end of the afternoon is the one
    // that fails.
    autoRefreshToken: true,
    // detectSessionInUrl finishes the Google round trip: the browser comes back
    // to /editor/?code=..., this exchanges it for a session and cleans the URL.
    detectSessionInUrl: true,
    // PKCE rather than the implicit flow, so the thing that comes back in the
    // URL is a one-time code that is worthless without the verifier this
    // browser kept, instead of an access token sitting in the address bar and
    // in every log between here and there.
    flowType: 'pkce',
  });
  return shared;
}

// WHERE GOOGLE COMES BACK TO. The same page the person left, so that signing in
// puts them back in the editor they were already in rather than at the front
// door. It has to be listed in the project's redirect allow list; see the
// instructions in supabase/AUTH-SETUP.md, which is written for the one person
// who can do it.
export function redirectTarget(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return '';
  return `${win.location.origin}${win.location.pathname}`;
}

// Everything below answers the same way: { ok } or { ok: false, reason }.
// Nothing throws, for the same reason nothing in supabase.js throws.
function failed(err) {
  const message = err && err.message ? err.message : 'sign in did not work';
  // The library's own message for a wrong password is "Invalid login
  // credentials", which is right but reads like a machine. The rest are already
  // sentences.
  if (/invalid login credentials/i.test(message)) return 'that email and password do not match';
  if (/email not confirmed/i.test(message)) return 'check your email and confirm the address first';
  if (/user already registered/i.test(message)) return 'there is already an account with that email';
  if (/provider is not enabled/i.test(message)) return 'google sign in is not switched on for this site yet';
  if (/failed to fetch|network/i.test(message)) return 'no connection';
  return message;
}

export async function signInWithGoogle({ win = typeof window !== 'undefined' ? window : null, skipRedirect = false } = {}) {
  try {
    const { data, error } = await auth().signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectTarget(win),
        skipBrowserRedirect: skipRedirect,
      },
    });
    if (error) return { ok: false, reason: failed(error) };
    // With skipBrowserRedirect the URL comes back instead of being followed,
    // which is the only way this call can be checked without a real Google.
    return { ok: true, url: data && data.url };
  } catch (err) {
    return { ok: false, reason: failed(err) };
  }
}

export async function signInWithEmail(email, password) {
  try {
    const { data, error } = await auth().signInWithPassword({ email, password });
    if (error) return { ok: false, reason: failed(error) };
    return { ok: true, user: data.user };
  } catch (err) {
    return { ok: false, reason: failed(err) };
  }
}

export async function signUpWithEmail(email, password) {
  try {
    const { data, error } = await auth().signUp({ email, password });
    if (error) return { ok: false, reason: failed(error) };
    // With email confirmations ON the project returns a user and no session,
    // and nothing else happens until they click the link. That is not a
    // failure and it must not read as one.
    return { ok: true, user: data.user, needsConfirmation: !data.session };
  } catch (err) {
    return { ok: false, reason: failed(err) };
  }
}

export async function signOut() {
  try {
    const { error } = await auth().signOut();
    if (error) return { ok: false, reason: failed(error) };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: failed(err) };
  }
}

// The signed in person, or null. Awaits the client's own initialisation, which
// is what finishes the Google round trip, so calling this on page load is also
// how the page waits for the redirect to be dealt with.
export async function currentUser() {
  try {
    const { data } = await auth().getSession();
    return data && data.session ? data.session.user : null;
  } catch {
    return null;
  }
}

// THE TOKEN THAT GOES ON A WRITE, and the single most important function here.
//
// An authenticated request carries the person's ACCESS TOKEN as the bearer, and
// the publishable key stays in the apikey header. Sending the publishable key
// as the bearer instead is the classic mistake: the request is perfectly valid,
// PostgREST reads it as the anonymous role, and every policy in 002-accounts.sql
// that says `owner = auth.uid()` fails against a null uid. It looks like a
// server bug and it is not one.
//
// getSession refreshes an expired token before returning it, so this is also
// what makes a long afternoon of editing end in a save that works.
export async function accessToken() {
  try {
    const { data } = await auth().getSession();
    return data && data.session ? data.session.access_token : null;
  } catch {
    return null;
  }
}

// Told whenever somebody signs in or out, including when the Google redirect
// completes, so the editor's panel can redraw itself without polling.
export function onChange(fn) {
  try {
    const { data } = auth().onAuthStateChange((event, session) => {
      fn(session ? session.user : null, event);
    });
    return () => { try { data.subscription.unsubscribe(); } catch { /* gone already */ } };
  } catch {
    return () => {};
  }
}

// What to call somebody on screen. Google gives a name, a password account
// gives an email and nothing else, and neither is guaranteed.
export function displayName(user) {
  if (!user) return '';
  const meta = user.user_metadata || {};
  return meta.full_name || meta.name || user.email || 'signed in';
}
