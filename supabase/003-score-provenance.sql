-- What a score was set on. Run after 002-accounts.sql. Idempotent.
--
-- One required column and two speculative ones, in a single migration on
-- purpose: each of these costs the owner a trip to the SQL editor, so the two
-- that are only probably needed ride along with the one that certainly is
-- rather than arriving as a third file next week.

-- REQUIRED. run.js keeps RULES_VERSION and its own comment says a board mixing
-- versions is a board that lies: the rules have already changed three times,
-- most recently when the power pellet went and took the 3000 point chain with
-- it, so a score from version 2 is not comparable with one from version 3. The
-- local board already filters on this and the shared one cannot.
alter table public.scores
  add column if not exists rules_version smallint not null default 3;

create index if not exists scores_board_v_idx
  on public.scores (rules_version, score desc, created_at asc);
create index if not exists scores_level_v_idx
  on public.scores (level_slug, rules_version, score desc);

-- SPECULATIVE, and here only because the migration was happening anyway.
--
-- These two are what an edge function would need to REPLAY a run and decide
-- whether its score is real. The honest position on the board today is written
-- at the foot of schema.sql: anyone holding the publishable key can post any
-- score without playing, and the constraints reject nonsense rather than
-- cheating. The fix is to have the score written by something the player does
-- not control, which is achievable here because the rules already run headless
-- and a level is deterministic given its seed. Storing the seed now means the
-- day that is built, the existing rows are not all worthless.
--
-- `caught_by` is the marker the skeleton that ended the run came out of. It is
-- for the end card ("caught at the leaning cross") and it costs nothing.
alter table public.scores
  add column if not exists seed integer,
  add column if not exists caught_by text check (caught_by is null or char_length(caught_by) <= 40);
