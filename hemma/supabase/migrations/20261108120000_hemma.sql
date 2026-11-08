-- Hemma: homes open for viewing, imported from agency feeds, with paid
-- placement for agents who have been approved by hand.
--
-- Who can do what:
--   anyone (anon)      read homes for sale, their viewings, areas, packages and
--                      running boosts; report anonymous usage through track()
--   agent, pending     apply, read their own application
--   agent, approved    read their agency's homes and stats, book boosts
--   admin              review applications, manage agencies and feeds
-- Writes from feeds and payments go through the service role only.

-- ------------------------------------------------------------------ people

create type agent_status as enum ('pending', 'approved', 'rejected', 'suspended');

create table agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  org_number text unique, -- organisationsnummer, how feeds name the agency
  website text,
  -- Launch offer: each agency's first boosts are free (see docs/pricing.md).
  free_boosts int not null default 3 check (free_boosts >= 0),
  created_at timestamptz not null default now()
);

create table admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table agents (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (length(full_name) between 2 and 120),
  email text not null,
  phone text,
  agency_name text not null check (length(agency_name) between 2 and 160),
  org_number text,
  fmi_number text, -- registration number at Fastighetsmäklarinspektionen
  agency_id uuid references agencies (id),
  status agent_status not null default 'pending',
  review_note text,
  applied_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id)
);
create index agents_status_idx on agents (status, applied_at);

create function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid())
$$;

-- The agency an approved agent acts for; null for everyone else.
create function my_agency() returns uuid
language sql stable security definer set search_path = public as $$
  select agency_id from agents where user_id = auth.uid() and status = 'approved'
$$;

-- ------------------------------------------------------------------ feeds

create table feed_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- pull: we fetch `url` on a schedule. push: the source system calls the
  -- feed-push function with signed events (how Mspecs-style webhooks arrive).
  mode text not null default 'pull' check (mode in ('pull', 'push')),
  format text not null check (format in ('hemma-json', 'hemma-xml')),
  url text,
  -- Name of the Edge Function secret holding the pull token or the push
  -- signing key. The secret itself never sits in the database.
  auth_secret_name text,
  -- Set when one feed is one agency; null for feeds that cover many agencies
  -- and name each listing's agency by org number.
  agency_id uuid references agencies (id),
  active boolean not null default true,
  last_run_at timestamptz,
  last_status text,
  last_error text,
  created_at timestamptz not null default now(),
  check (mode = 'push' or url is not null)
);

create table feed_runs (
  id bigint generated always as identity primary key,
  source_id uuid not null references feed_sources (id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'partial', 'failed')),
  seen int not null default 0,
  upserted int not null default 0,
  removed int not null default 0,
  viewings int not null default 0,
  rejected int not null default 0,
  error text
);
create index feed_runs_source_idx on feed_runs (source_id, started_at desc);

-- ------------------------------------------------------------------ homes

create table areas (
  id text primary key,
  name text not null,
  city text not null,
  lat double precision not null,
  lng double precision not null
);

create table listings (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references feed_sources (id) on delete cascade,
  external_id text not null,
  agency_id uuid references agencies (id),
  agency_name text not null,
  agent_name text,
  agent_email text,
  agent_phone text,
  address text not null,
  area_id text references areas (id),
  city text,
  lat double precision not null,
  lng double precision not null,
  type text not null default 'apartment' check (type in ('apartment', 'house', 'townhouse', 'other')),
  tenure text,
  rooms numeric(4, 1),
  size numeric(7, 1),
  price bigint,
  fee int,
  floor int,
  floors int,
  built int,
  description text,
  images text[] not null default '{}',
  url text,
  style text,
  status text not null default 'for_sale' check (status in ('for_sale', 'removed')),
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  unique (source_id, external_id)
);
create index listings_geo_idx on listings (lat, lng) where status = 'for_sale';
create index listings_agency_idx on listings (agency_id);

create table viewings (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  booking_required boolean not null default false,
  booking_url text,
  unique (listing_id, starts_at)
);
create index viewings_time_idx on viewings (starts_at);

-- ------------------------------------------------------------------ boosts

create table packages (
  id text primary key,
  name text not null,
  days int not null check (days between 1 and 31),
  price_sek int not null check (price_sek >= 0), -- excl. VAT
  tier int not null,
  active boolean not null default true
);

-- Prices set below Hemnet's Raketen (about 1,120-1,400 kr for 3-5 days at the
-- top) and Boneo's Boost (1,125 kr). Reasoning and sources: docs/pricing.md.
insert into packages (id, name, days, price_sek, tier) values
  ('day', 'Day', 1, 249, 1),
  ('weekend', 'Viewing weekend', 3, 549, 2),
  ('week', 'Week', 7, 949, 3);

-- Switches an admin can change without a deploy.
create table settings (
  key text primary key,
  value jsonb not null
);
insert into settings values
  ('launch_discount', '{"percent": 50, "until": "2027-03-31"}');

-- What a package costs today, after any launch discount.
create function package_price(p_package text) returns int
language sql stable security definer set search_path = public as $$
  select case
    when (s.value ->> 'until')::date >= (now() at time zone 'Europe/Stockholm')::date
      then round(p.price_sek * (100 - (s.value ->> 'percent')::int) / 100.0)::int
    else p.price_sek end
  from packages p left join settings s on s.key = 'launch_discount'
  where p.id = p_package
$$;

-- Sponsored spots sold per area and viewing day.
create function spots_per_area_day() returns int language sql immutable as $$ select 3 $$;

create table promotions (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings (id) on delete cascade,
  agency_id uuid not null references agencies (id),
  package_id text not null references packages (id),
  starts_on date not null,
  ends_on date not null check (ends_on >= starts_on),
  tier int not null,
  amount_sek int not null,
  status text not null default 'pending_payment' check (status in ('pending_payment', 'active', 'cancelled', 'expired')),
  -- An unpaid booking holds its spot for this long, then lets it go.
  hold_until timestamptz not null default now() + interval '30 minutes',
  stripe_session_id text unique,
  paid_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index promotions_dates_idx on promotions (starts_on, ends_on) where status in ('active', 'pending_payment');

-- ------------------------------------------------------------------ usage

-- Anonymous: a random id per app install, never an account or an IP.
create table events (
  id bigint generated always as identity primary key,
  listing_id uuid not null references listings (id) on delete cascade,
  kind text not null check (kind in ('impression', 'open', 'save', 'directions', 'call', 'agency_link')),
  sponsored boolean not null default false,
  feed_day date,
  device_id text,
  created_at timestamptz not null default now()
);
create index events_listing_idx on events (listing_id, created_at);

-- ------------------------------------------------------------------ access

alter table agencies enable row level security;
alter table admins enable row level security;
alter table agents enable row level security;
alter table feed_sources enable row level security;
alter table feed_runs enable row level security;
alter table areas enable row level security;
alter table listings enable row level security;
alter table viewings enable row level security;
alter table packages enable row level security;
alter table settings enable row level security;
alter table promotions enable row level security;
alter table events enable row level security;

create policy "admins see admins" on admins for select using (is_admin());

create policy "agency visible to its agents and admins" on agencies for select
  using (id = my_agency() or is_admin());
create policy "admins manage agencies" on agencies for all using (is_admin()) with check (is_admin());

create policy "agents read own application" on agents for select using (user_id = auth.uid() or is_admin());
create policy "admins review applications" on agents for update using (is_admin()) with check (is_admin());

create policy "feeds visible to their agency and admins" on feed_sources for select
  using (is_admin() or (agency_id is not null and agency_id = my_agency()));
create policy "admins manage feeds" on feed_sources for all using (is_admin()) with check (is_admin());
create policy "feed runs visible to their agency and admins" on feed_runs for select
  using (is_admin() or exists (select 1 from feed_sources s where s.id = source_id and s.agency_id = my_agency()));

create policy "areas are public" on areas for select using (true);
create policy "packages are public" on packages for select using (active or is_admin());
create policy "settings are public" on settings for select using (true);
create policy "admins change settings" on settings for all using (is_admin()) with check (is_admin());

create policy "homes for sale are public" on listings for select
  using (status = 'for_sale' or agency_id = my_agency() or is_admin());
create policy "viewings of public homes are public" on viewings for select
  using (exists (select 1 from listings l where l.id = listing_id and (l.status = 'for_sale' or l.agency_id = my_agency() or is_admin())));

create policy "running boosts are public" on promotions for select
  using (status = 'active' or agency_id = my_agency() or is_admin());

create policy "admins read events" on events for select using (is_admin());

-- Column-level: buyers never read agents' emails through the API.
revoke select on listings from anon, authenticated;
grant select (id, external_id, agency_id, agency_name, agent_name, agent_phone, address, area_id, city, lat, lng, type, tenure,
  rooms, size, price, fee, floor, floors, built, description, images, url, style, status, first_seen_at, updated_at)
  on listings to anon, authenticated;

-- ------------------------------------------------------------------ buyer API

-- Homes with viewings in a time window inside a box, viewings nested. The app
-- asks for two weeks around the buyer at a time and ranks locally with the
-- shared rules in core/feed.ts.
create function feed_window(
  p_from timestamptz, p_to timestamptz,
  p_min_lat double precision, p_max_lat double precision,
  p_min_lng double precision, p_max_lng double precision
) returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.id), '[]'::jsonb)
  from (
    select l.id, l.address, l.area_id as area, l.city, l.lat, l.lng, l.type, l.tenure, l.rooms, l.size, l.price, l.fee,
      l.floor, l.floors, l.built, l.agency_id as "agencyId", l.agency_name as agency, l.agent_name as agent,
      l.agent_phone as phone, l.description as blurb, l.images, l.url, l.style,
      (select jsonb_agg(jsonb_build_object(
          'id', v.id,
          'start', (extract(epoch from v.starts_at) * 1000)::bigint,
          'end', (extract(epoch from v.ends_at) * 1000)::bigint,
          'booking', v.booking_required,
          'bookingUrl', v.booking_url) order by v.starts_at)
        from viewings v where v.listing_id = l.id and v.starts_at >= p_from and v.starts_at < p_to) as viewings
    from listings l
    where l.status = 'for_sale'
      and l.lat between p_min_lat and p_max_lat
      and l.lng between p_min_lng and p_max_lng
      and exists (select 1 from viewings v where v.listing_id = l.id and v.starts_at >= p_from and v.starts_at < p_to)
  ) x
$$;

create function active_promotions(p_from date, p_to date) returns table (
  id uuid, "listingId" uuid, "packageId" text, "from" date, "to" date, tier int
)
language sql stable security invoker set search_path = public as $$
  select id, listing_id, package_id, starts_on, ends_on, tier from promotions
  where status = 'active' and starts_on <= p_to and ends_on >= p_from
$$;

-- Anonymous usage from the app, in batches. Unknown listings and kinds are
-- dropped rather than failing the batch.
create function track(p_events jsonb, p_device text) returns int
language plpgsql volatile security definer set search_path = public as $$
declare
  n int;
begin
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 200 then
    raise exception 'send an array of at most 200 events';
  end if;
  with parsed as (
    select
      case when e ->> 'listingId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (e ->> 'listingId')::uuid end as listing_id,
      e ->> 'kind' as kind,
      coalesce(e ->> 'sponsored', 'false') = 'true' as sponsored,
      case when e ->> 'day' ~ '^\d{4}-\d{2}-\d{2}$' then (e ->> 'day')::date end as feed_day
    from jsonb_array_elements(p_events) e
  )
  insert into events (listing_id, kind, sponsored, feed_day, device_id)
  select p.listing_id, p.kind, p.sponsored, p.feed_day, left(p_device, 64)
  from parsed p
  where p.listing_id is not null
    and p.kind in ('impression', 'open', 'save', 'directions', 'call', 'agency_link')
    and exists (select 1 from listings l where l.id = p.listing_id);
  get diagnostics n = row_count;
  return n;
end
$$;

-- ------------------------------------------------------------------ agent API

create function apply_as_agent(
  p_full_name text, p_phone text, p_agency_name text, p_org_number text, p_fmi_number text
) returns agents
language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  mail text;
  rec agents;
begin
  if me is null then raise exception 'sign in first'; end if;
  select email into mail from auth.users where id = me;
  insert into agents (user_id, full_name, email, phone, agency_name, org_number, fmi_number)
  values (me, trim(p_full_name), mail, nullif(trim(p_phone), ''), trim(p_agency_name),
          nullif(regexp_replace(coalesce(p_org_number, ''), '\D', '', 'g'), ''), nullif(trim(p_fmi_number), ''))
  on conflict (user_id) do update set
    full_name = excluded.full_name, phone = excluded.phone, agency_name = excluded.agency_name,
    org_number = excluded.org_number, fmi_number = excluded.fmi_number,
    status = case when agents.status = 'rejected' then 'pending'::agent_status else agents.status end,
    applied_at = case when agents.status = 'rejected' then now() else agents.applied_at end
  returning * into rec;
  return rec;
end
$$;

-- Views and actions per home and day, for the calling agent's agency.
-- impressions = distinct devices that saw the home in a feed that day.
create function agency_stats(p_from date, p_to date, p_agency uuid default null) returns table (
  listing_id uuid, day date, impressions bigint, sponsored_impressions bigint, opens bigint, saves bigint,
  directions bigint, calls bigint, agency_links bigint
)
language plpgsql stable security definer set search_path = public as $$
declare
  target uuid := case when is_admin() and p_agency is not null then p_agency else my_agency() end;
begin
  if target is null then raise exception 'only approved agents can see stats'; end if;
  return query
  select e.listing_id, (e.created_at at time zone 'Europe/Stockholm')::date as d,
    count(distinct e.device_id) filter (where e.kind = 'impression'),
    count(distinct e.device_id) filter (where e.kind = 'impression' and e.sponsored),
    count(*) filter (where e.kind = 'open'),
    count(*) filter (where e.kind = 'save'),
    count(*) filter (where e.kind = 'directions'),
    count(*) filter (where e.kind = 'call'),
    count(*) filter (where e.kind = 'agency_link')
  from events e
  join listings l on l.id = e.listing_id
  where l.agency_id = target
    and (e.created_at at time zone 'Europe/Stockholm')::date between p_from and p_to
  group by 1, 2;
end
$$;

-- Spots left for a home's area on each of its viewing days in a range.
create function spots_left(p_listing uuid, p_from date, p_to date) returns table (day date, left_count int)
language sql stable security definer set search_path = public as $$
  with me as (select area_id from listings where id = p_listing),
  days as (
    select distinct (v.starts_at at time zone 'Europe/Stockholm')::date as d
    from viewings v where v.listing_id = p_listing
      and (v.starts_at at time zone 'Europe/Stockholm')::date between p_from and p_to
  )
  select days.d, greatest(0, spots_per_area_day() - (
    select count(distinct p.listing_id)::int
    from promotions p
    join listings l on l.id = p.listing_id
    where l.area_id = (select area_id from me)
      and p.listing_id <> p_listing
      and days.d between p.starts_on and p.ends_on
      and (p.status = 'active' or (p.status = 'pending_payment' and p.hold_until > now()))
      and exists (select 1 from viewings v where v.listing_id = p.listing_id
                  and (v.starts_at at time zone 'Europe/Stockholm')::date = days.d)
  ))
  from days
$$;

-- Hold a sponsored spot while the agent pays. Checks that the agent is
-- approved, the home is their agency's, it has a viewing in the period, and a
-- spot is free on every viewing day covered.
create function reserve_promotion(p_listing uuid, p_package text, p_start date) returns promotions
language plpgsql volatile security definer set search_path = public as $$
declare
  agency uuid := my_agency();
  pkg packages;
  home listings;
  last_day date;
  rec promotions;
begin
  if agency is null then raise exception 'only approved agents can book boosts'; end if;
  select * into home from listings where id = p_listing;
  if home.id is null or home.agency_id is distinct from agency then raise exception 'this home is not listed by your agency'; end if;
  if home.status <> 'for_sale' then raise exception 'this home is no longer for sale'; end if;
  select * into pkg from packages where id = p_package and active;
  if pkg.id is null then raise exception 'unknown package'; end if;
  if p_start < (now() at time zone 'Europe/Stockholm')::date then raise exception 'pick a start date from today on'; end if;
  last_day := p_start + pkg.days - 1;

  -- One booking at a time per area, so two agents cannot take the last spot together.
  perform pg_advisory_xact_lock(hashtext('hemma-area:' || coalesce(home.area_id, home.id::text)));

  if not exists (select 1 from viewings v where v.listing_id = p_listing and v.ends_at > now()
                 and (v.starts_at at time zone 'Europe/Stockholm')::date between p_start and last_day) then
    raise exception 'no viewings in that period, so a boost would not be shown';
  end if;
  if exists (select 1 from spots_left(p_listing, p_start, last_day) s where s.left_count = 0) then
    raise exception 'sold out in this area on one of those days';
  end if;
  if exists (select 1 from promotions p where p.listing_id = p_listing and p.status = 'active'
             and p.starts_on <= last_day and p.ends_on >= p_start) then
    raise exception 'this home already has a boost in that period';
  end if;

  -- Let go of this agent's own unpaid holds on the same home.
  update promotions set status = 'cancelled'
  where listing_id = p_listing and status = 'pending_payment' and created_by = auth.uid();

  -- A free launch boost is live at once; anything else waits for payment.
  if (select free_boosts from agencies where id = agency for update) > 0 then
    update agencies set free_boosts = free_boosts - 1 where id = agency;
    insert into promotions (listing_id, agency_id, package_id, starts_on, ends_on, tier, amount_sek, status, paid_at, created_by)
    values (p_listing, agency, pkg.id, p_start, last_day, pkg.tier, 0, 'active', now(), auth.uid())
    returning * into rec;
  else
    insert into promotions (listing_id, agency_id, package_id, starts_on, ends_on, tier, amount_sek, created_by)
    values (p_listing, agency, pkg.id, p_start, last_day, pkg.tier, package_price(pkg.id), auth.uid())
    returning * into rec;
  end if;
  return rec;
end
$$;

create function cancel_promotion(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  update promotions set status = 'cancelled'
  where id = p_id and status = 'pending_payment' and agency_id = my_agency();
  if not found then raise exception 'only an unpaid booking can be cancelled here'; end if;
end
$$;

-- ------------------------------------------------------------------ admin API

create function review_agent(p_user uuid, p_decision agent_status, p_note text default null, p_agency uuid default null)
returns agents
language plpgsql volatile security definer set search_path = public as $$
declare
  app agents;
  agency uuid := p_agency;
begin
  if not is_admin() then raise exception 'admins only'; end if;
  select * into app from agents where user_id = p_user for update;
  if app.user_id is null then raise exception 'no such application'; end if;
  if p_decision = 'approved' and agency is null then
    select id into agency from agencies where org_number is not null and org_number = app.org_number;
    if agency is null then
      insert into agencies (name, org_number) values (app.agency_name, app.org_number) returning id into agency;
    end if;
  end if;
  update agents set status = p_decision, review_note = p_note, reviewed_at = now(), reviewed_by = auth.uid(),
    agency_id = coalesce(agency, agents.agency_id)
  where user_id = p_user returning * into app;
  return app;
end
$$;

-- ------------------------------------------------------------------ feed import

-- Applies one parsed feed in a single transaction: upserts homes, replaces
-- their upcoming viewings, and marks homes the feed no longer has as removed.
-- Called by the ingest-feeds Edge Function with the service role.
create function ingest_apply(p_source uuid, p_listings jsonb, p_complete boolean default true) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  src feed_sources;
  item jsonb;
  home_id uuid;
  agency uuid;
  n_upserted int := 0;
  n_viewings int := 0;
  n_removed int := 0;
  seen text[] := '{}';
begin
  select * into src from feed_sources where id = p_source;
  if src.id is null then raise exception 'unknown feed source'; end if;

  for item in select * from jsonb_array_elements(p_listings) loop
    agency := src.agency_id;
    if agency is null and nullif(item ->> 'agencyOrgNumber', '') is not null then
      select id into agency from agencies where org_number = item ->> 'agencyOrgNumber';
      if agency is null then
        insert into agencies (name, org_number) values (item ->> 'agencyName', item ->> 'agencyOrgNumber') returning id into agency;
      end if;
    end if;

    insert into listings as l (source_id, external_id, agency_id, agency_name, agent_name, agent_email, agent_phone, address,
      area_id, city, lat, lng, type, tenure, rooms, size, price, fee, floor, floors, built, description, images, url, style,
      status, updated_at, removed_at)
    values (p_source, item ->> 'externalId', agency, item ->> 'agencyName', item ->> 'agentName', item ->> 'agentEmail',
      item ->> 'agentPhone', item ->> 'address',
      (select id from areas where id = item ->> 'area'), item ->> 'city',
      (item ->> 'lat')::double precision, (item ->> 'lng')::double precision, coalesce(item ->> 'type', 'other'),
      item ->> 'tenure', (item ->> 'rooms')::numeric, (item ->> 'size')::numeric, (item ->> 'price')::bigint,
      (item ->> 'fee')::int, (item ->> 'floor')::int, (item ->> 'floors')::int, (item ->> 'built')::int,
      item ->> 'description', coalesce((select array_agg(x) from jsonb_array_elements_text(item -> 'images') x), '{}'),
      item ->> 'url', item ->> 'style', 'for_sale', now(), null)
    on conflict (source_id, external_id) do update set
      agency_id = excluded.agency_id, agency_name = excluded.agency_name, agent_name = excluded.agent_name,
      agent_email = excluded.agent_email, agent_phone = excluded.agent_phone, address = excluded.address,
      area_id = excluded.area_id, city = excluded.city, lat = excluded.lat, lng = excluded.lng, type = excluded.type,
      tenure = excluded.tenure, rooms = excluded.rooms, size = excluded.size, price = excluded.price, fee = excluded.fee,
      floor = excluded.floor, floors = excluded.floors, built = excluded.built, description = excluded.description,
      images = excluded.images, url = excluded.url, style = excluded.style, status = 'for_sale', updated_at = now(),
      removed_at = null
    returning id into home_id;
    n_upserted := n_upserted + 1;
    seen := seen || (item ->> 'externalId');

    -- The feed is the truth for upcoming viewings; past ones stay for history.
    delete from viewings v
    where v.listing_id = home_id and v.starts_at > now()
      and not exists (select 1 from jsonb_array_elements(coalesce(item -> 'viewings', '[]')) w
                      where (w ->> 'start')::timestamptz = v.starts_at);
    insert into viewings (listing_id, starts_at, ends_at, booking_required, booking_url)
    select home_id, (w ->> 'start')::timestamptz, (w ->> 'end')::timestamptz,
      coalesce((w ->> 'booking')::boolean, false), w ->> 'bookingUrl'
    from jsonb_array_elements(coalesce(item -> 'viewings', '[]')) w
    on conflict (listing_id, starts_at) do update set
      ends_at = excluded.ends_at, booking_required = excluded.booking_required, booking_url = excluded.booking_url;
    n_viewings := n_viewings + (select count(*) from jsonb_array_elements(coalesce(item -> 'viewings', '[]')));
  end loop;

  -- A full feed that no longer lists a home means it is sold or withdrawn.
  if p_complete then
    update listings set status = 'removed', removed_at = now()
    where source_id = p_source and status = 'for_sale' and not (external_id = any (seen));
    get diagnostics n_removed = row_count;
  end if;

  return jsonb_build_object('upserted', n_upserted, 'viewings', n_viewings, 'removed', n_removed);
end
$$;

-- A push source says a home is sold or withdrawn.
create function ingest_unpublish(p_source uuid, p_external_ids text[]) returns int
language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  update listings set status = 'removed', removed_at = now()
  where source_id = p_source and external_id = any (p_external_ids) and status = 'for_sale';
  get diagnostics n = row_count;
  return n;
end
$$;

-- Buyers and agents never call the importer or the payment bookkeeping.
revoke execute on function ingest_apply(uuid, jsonb, boolean) from public, anon, authenticated;
revoke execute on function ingest_unpublish(uuid, text[]) from public, anon, authenticated;

-- Called by the Stripe webhook (service role) once payment clears.
create function activate_promotion(p_session text) returns promotions
language plpgsql volatile security definer set search_path = public as $$
declare rec promotions;
begin
  update promotions set status = 'active', paid_at = now()
  where stripe_session_id = p_session and status in ('pending_payment', 'expired')
  returning * into rec;
  return rec;
end
$$;
revoke execute on function activate_promotion(text) from public, anon, authenticated;
