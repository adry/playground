-- Accounts, ownership and public levels.
--
-- Run this in the Supabase SQL editor AFTER schema.sql. It is idempotent.
--
-- WHAT CHANGES, and why the policies get stricter rather than looser. Until now
-- `levels` was an anonymous pile: anyone could add one and everyone could read
-- all of them. Once people have accounts, a level belongs to somebody, and the
-- default has to be that it is theirs alone. Public is then a choice they make,
-- not the state they land in.

-- --------------------------------------------------------------------------
-- 1. Ownership and visibility on levels.
-- --------------------------------------------------------------------------
alter table public.levels
  add column if not exists owner uuid references auth.users (id) on delete cascade,
  -- Private by default. A person who saves a half-finished graveyard has not
  -- decided to publish it, and defaulting the other way publishes it for them.
  add column if not exists is_public boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists levels_owner_idx on public.levels (owner, updated_at desc);
create index if not exists levels_public_idx on public.levels (is_public, created_at desc)
  where is_public;

-- Existing rows have no owner. They were made before accounts existed, so they
-- are nobody's; leave them public and unowned rather than assigning them to the
-- first person who logs in.
update public.levels set is_public = true where owner is null and is_public = false;

-- --------------------------------------------------------------------------
-- 2. The policies. Replace the anonymous ones wholesale.
-- --------------------------------------------------------------------------
drop policy if exists "levels are public" on public.levels;
drop policy if exists "anyone may publish a level" on public.levels;

-- Read: anything marked public, plus everything you own.
drop policy if exists "read public levels and your own" on public.levels;
create policy "read public levels and your own"
  on public.levels for select
  using (is_public or owner = (select auth.uid()));

-- Write: only signed in, and only as yourself. `owner = auth.uid()` in the
-- check is what stops someone posting a level into another person's account.
drop policy if exists "signed in may create their own levels" on public.levels;
create policy "signed in may create their own levels"
  on public.levels for insert
  to authenticated
  with check (owner = (select auth.uid()));

-- Update and delete: your own only. Note the WITH CHECK as well as the USING:
-- without it you could edit your own row and hand it to somebody else.
drop policy if exists "owners may edit their levels" on public.levels;
create policy "owners may edit their levels"
  on public.levels for update
  to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

drop policy if exists "owners may delete their levels" on public.levels;
create policy "owners may delete their levels"
  on public.levels for delete
  to authenticated
  using (owner = (select auth.uid()));

-- Keep updated_at honest rather than trusting the client to send it.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists levels_touch_updated_at on public.levels;
create trigger levels_touch_updated_at
  before update on public.levels
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------------------------------
-- 3. Scores may now carry who set them, but stay open to guests.
--
-- Signing in to post a score would be a wall in front of the one thing a
-- passer-by might do, so anonymous scores stay. A signed in player gets their
-- runs tied to them, which is what makes "your best" possible later.
-- --------------------------------------------------------------------------
alter table public.scores
  add column if not exists owner uuid references auth.users (id) on delete set null;

create index if not exists scores_owner_idx on public.scores (owner, score desc);

-- A guest may post with no owner. A signed in player may only post as
-- themselves, never as somebody else.
drop policy if exists "anyone may post a score" on public.scores;
create policy "anyone may post a score"
  on public.scores for insert
  with check (owner is null or owner = (select auth.uid()));

-- Reading the board stays open to everyone, which is the point of a board.
