-- Run notes and tags, saved budget scenarios, and an anonymous log of questions Neon could not answer.

alter table public.runs
  add column notes text not null default '' check (char_length(notes) <= 500),
  add column tags  text[] not null default '{}' check (cardinality(tags) <= 5);

create function public.set_run_notes(p_run_id uuid, p_notes text, p_tags text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tags text[];
begin
  select coalesce(array_agg(t order by t), '{}') into v_tags from (
    select distinct left(btrim(x), 24) as t from unnest(coalesce(p_tags, '{}')) x where btrim(x) <> '' limit 5
  ) s;
  update public.runs set notes = left(coalesce(p_notes, ''), 500), tags = v_tags
    where id = p_run_id and user_id = auth.uid();
  if not found then
    raise exception 'Run not found.' using errcode = 'P0002';
  end if;
end $$;
grant execute on function public.set_run_notes(uuid, text, text[]) to authenticated;
grant execute on function public.set_run_notes(uuid, text, text[]) to service_role;

-- ---------------------------------------------------------------- saved scenarios
create table public.scenarios (
  id         uuid primary key default gen_random_uuid(),
  run_id     uuid not null references public.runs on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  spend      jsonb not null,           -- {channel: weekly spend}
  created_at timestamptz not null default now()
);
create index scenarios_run on public.scenarios (run_id);
alter table public.scenarios enable row level security;
revoke all on public.scenarios from anon, authenticated;
grant select on public.scenarios to authenticated;
create policy scenarios_read_own on public.scenarios for select to authenticated
  using (user_id = (select auth.uid()));

create function public.save_scenario(p_run_id uuid, p_name text, p_spend jsonb) returns public.scenarios
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  s public.scenarios;
begin
  if not exists (select 1 from public.runs where id = p_run_id and user_id = v_uid and status = 'finished') then
    raise exception 'Scenarios can only be saved on your own finished runs.' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_spend) <> 'object' or (select count(*) from jsonb_object_keys(p_spend)) > 30 then
    raise exception 'That scenario is not valid.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.scenarios where run_id = p_run_id) >= 10 then
    raise exception 'You have 10 saved scenarios on this run. Delete one first.' using errcode = 'P0001';
  end if;
  insert into public.scenarios (run_id, user_id, name, spend)
    values (p_run_id, v_uid, left(btrim(p_name), 60), p_spend) returning * into s;
  return s;
end $$;

create function public.delete_scenario(p_id uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.scenarios where id = p_id and user_id = auth.uid();
$$;
grant execute on function public.save_scenario(uuid, text, jsonb), public.delete_scenario(uuid) to authenticated;
grant execute on function public.save_scenario(uuid, text, jsonb), public.delete_scenario(uuid) to service_role;
grant all on public.scenarios to service_role;

-- ---------------------------------------------------------------- Neon: questions with no answer
-- Anonymous: no user id, no IP. Only the text, a count and the first and last time it was asked.
create table public.neon_misses (
  question   text primary key check (char_length(question) between 3 and 200),
  asked      integer not null default 1,
  first_at   timestamptz not null default now(),
  last_at    timestamptz not null default now()
);
alter table public.neon_misses enable row level security;
revoke all on public.neon_misses from anon, authenticated;
grant all on public.neon_misses to service_role;

create function public.log_neon_miss(p_question text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  q text := lower(left(btrim(regexp_replace(coalesce(p_question, ''), '\s+', ' ', 'g')), 200));
begin
  if char_length(q) < 3 then return; end if;
  if (select count(*) from public.neon_misses) >= 5000 then
    delete from public.neon_misses where question in (select question from public.neon_misses order by last_at limit 500);
  end if;
  insert into public.neon_misses (question) values (q)
    on conflict (question) do update set asked = public.neon_misses.asked + 1, last_at = now();
end $$;
grant execute on function public.log_neon_miss(text) to anon, authenticated, service_role;
