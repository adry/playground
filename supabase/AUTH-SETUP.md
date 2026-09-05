# What the owner has to do in the dashboards

Everything in this file has to be done by the person who owns the Supabase
project and the Google account. None of it can be done from the code, and the
code cannot tell you it is missing: an unconfigured provider looks exactly like
a button that does nothing.

Do them in this order. Steps 1 to 3 are Google sign in; step 4 is email sign in;
step 5 is the two things that break everything else if they are wrong.

There is one thing I need from you before step 1: **the address the site is
deployed at**. Everywhere below it is written `https://YOURSITE`, and every one
of those has to be the real thing, with no trailing slash. If the site is at
`https://graveyard.example.com`, then `https://YOURSITE/editor/` means
`https://graveyard.example.com/editor/`.

Your Supabase project is `arciakudvmdebdqwhouu`, so its address is
`https://arciakudvmdebdqwhouu.supabase.co`. That one is already correct below.

---

## 1. Run the SQL, if you have not

In the Supabase dashboard, **SQL Editor**, run these two, in order:

1. `supabase/schema.sql` (you have already run this one)
2. `supabase/002-accounts.sql`

Until 002 has run, saving a level from the editor will fail and say
"this site needs its database updated before accounts work". The leaderboard
keeps working throughout.

## 2. Make a Google OAuth client

In the **Google Cloud Console**, at <https://console.cloud.google.com>:

1. Pick a project, or make one. Any name.
2. **APIs and Services > OAuth consent screen**. Choose **External**. Fill in the
   app name, your email as the support email, and your email as the developer
   contact. Save. You do not need to submit it for verification: while it is in
   "Testing" you can add yourself and anyone else under **Test users** and they
   can sign in. Publish it when you want strangers to be able to.
3. **APIs and Services > Credentials > Create credentials > OAuth client ID**.
   - Application type: **Web application**
   - Name: anything, for example "Graveyard"
   - **Authorised JavaScript origins**, add both:
     - `https://YOURSITE`
     - `http://localhost:5183`
   - **Authorised redirect URIs**, add exactly one, and it is the SUPABASE
     address rather than yours:
     ```
     https://arciakudvmdebdqwhouu.supabase.co/auth/v1/callback
     ```
     This is the single most common thing to get wrong. Google redirects to
     Supabase, and Supabase then redirects to your site. Your site's address
     never goes in this box.
4. Press create. Copy the **Client ID** and the **Client secret**.

## 3. Switch Google on in Supabase

In the Supabase dashboard, **Authentication > Sign In / Providers > Google**:

1. Turn **Enable Sign in with Google** on.
2. Paste the **Client ID** from step 2.
3. Paste the **Client secret** from step 2.
4. Leave "Skip nonce check" off.
5. Save.

The page shows a callback URL while you are there. It should be exactly the one
you pasted into Google in step 2.4. If it is not, use the one the page shows.

## 4. Email and password

In the Supabase dashboard, **Authentication > Sign In / Providers > Email**:

1. **Enable Email provider**: on.
2. **Confirm email**: your choice, and it changes what people see.
   - **On** is the safe default and what a real site should do. Somebody who
     creates an account is told to check their email, and cannot sign in until
     they click the link. The editor says exactly that.
   - **Off** signs them in immediately. Easier to try, and it means anybody can
     make an account against an address that is not theirs.
   - Whichever you pick, the editor handles it. Turning it on later is fine.
3. If you leave confirmations on, go to **Authentication > URL Configuration**
   and make sure the **Site URL** is right, because that is where the link in
   the email points. See step 5.

## 5. The two URL settings that break everything

In the Supabase dashboard, **Authentication > URL Configuration**:

1. **Site URL**: `https://YOURSITE`

   This is where Supabase sends anybody it does not have a better address for,
   including everyone clicking a confirmation email. If it is still
   `http://localhost:3000`, confirmation emails send your players to a page that
   does not exist on their machine.

2. **Redirect URLs**: add all four, one per line.

   ```
   https://YOURSITE/editor/
   https://YOURSITE/**
   http://localhost:5183/**
   http://127.0.0.1:5183/**
   ```

   Signing in with Google sends the browser away and asks for it to be sent
   back to the page it left, which is `/editor/`. Supabase refuses to redirect
   anywhere that is not on this list, and the failure is silent from the site's
   side: the person comes back to the wrong page, or to an error page, with no
   session. The two localhost lines are for the dev server, which runs on port
   5183; drop them if you never sign in locally.

## 6. CORS, and the answer is that there is nothing to do

Supabase's API gateway already answers cross origin requests from any origin,
for both `/rest/v1/` and `/auth/v1/`, and it already exposes the `Content-Range`
header that the leaderboard reads a player's placing out of. There is no
allowed-origins box for the REST API and you do not have to add your site to
anything.

If a request ever does fail with a CORS error in the browser console, it is
almost certainly not CORS: a 401 with no CORS headers on the error response
reads as a CORS failure in the console, and the real cause is the key or the
policy.

## 7. Worth knowing, not worth doing yet

- **Nothing here is a secret except the Google client secret.** The key in the
  site's source is the publishable key, which is designed to be public. What
  protects the tables is the row level security in the two SQL files.
- **The leaderboard is not tamper proof.** Anyone with the publishable key can
  post a score without playing. The constraints reject nonsense, not cheating.
  The note at the foot of `schema.sql` describes the real fix.
- **Email rate limits.** The built in email sender is limited to a handful of
  messages an hour and is for testing. If people start making accounts, set up
  an SMTP provider under **Authentication > Emails > SMTP Settings**.
