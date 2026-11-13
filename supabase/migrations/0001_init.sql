-- Kawkit: first migration. Tables, row-level security, storage, queue and functions.
-- Users may only read their own rows; every change goes through the functions below.

create extension if not exists pgmq;

create type public.run_status as enum ('queued', 'running', 'finished', 'failed', 'cancelled');

-- ---------------------------------------------------------------- tables

create table public.profiles (
  user_id          uuid primary key references auth.users on delete cascade,
  display_name     text,
  email_on_finish  boolean not null default true,
  delete_requested timestamptz,                 -- set by request_account_deletion()
  created_at       timestamptz not null default now(),
  last_seen_at     timestamptz not null default now()
);

create table public.runs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users on delete cascade,
  name             text not null check (char_length(name) between 1 and 80),
  status           public.run_status not null default 'queued',
  progress         real not null default 0 check (progress between 0 and 1),
  upload_path      text not null,               -- {user_id}/{id}.csv in the uploads bucket
  data_summary     jsonb not null,              -- rows, weeks, channels, controls, warnings
  priors           jsonb not null default '{}', -- per channel: roi_low, roi_high, carryover_weeks, note
  settings         jsonb not null default '{}', -- trend, seasonality, draws
  seed             integer not null,
  queue_msg_id     bigint,                      -- pgmq message while queued or running
  attempts         smallint not null default 0,
  cancel_requested boolean not null default false,
  error            text,
  worker_id        text,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz
);
create index runs_user_created on public.runs (user_id, created_at desc);
create index runs_active on public.runs (created_at) where status in ('queued', 'running');

create table public.run_results (
  run_id       uuid primary key references public.runs on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  diagnostics  jsonb not null,  -- max R-hat, min ESS, divergences, verdict
  fit          jsonb not null,  -- R2, MAPE, holdout MAPE, actual, fitted and band series
  channels     jsonb not null,  -- per channel: ROI, marginal ROI, contribution, half-life, prior vs posterior
  curves       jsonb not null,  -- response-curve bands at 40 spend levels
  default_plan jsonb,           -- optimiser result at default settings
  draws_path   text not null,   -- {user_id}/{run_id}/draws.json in the results bucket (500 draws)
  created_at   timestamptz not null default now()
);

create table public.run_events (
  id       bigint generated always as identity primary key,
  run_id   uuid references public.runs on delete cascade,
  user_id  uuid not null references auth.users on delete cascade,
  type     text not null check (type in ('submitted', 'started', 'progress', 'retried',
           'finished', 'failed', 'cancel_requested', 'cancelled', 'deleted')),
  at       timestamptz not null default now(),
  details  jsonb not null default '{}'
);
create index run_events_user_at on public.run_events (user_id, at desc);

create table public.worker_heartbeat (
  worker_id       text primary key,
  last_seen       timestamptz not null,
  version         text not null,
  running_runs    smallint not null,
  max_concurrency smallint not null
);

select pgmq.create('kawkit_runs');  -- the queue; one message {run_id} per run

-- ---------------------------------------------------------------- row-level security

alter table public.profiles         enable row level security;
alter table public.runs             enable row level security;
alter table public.run_results      enable row level security;
alter table public.run_events       enable row level security;
alter table public.worker_heartbeat enable row level security;

revoke all on public.profiles, public.runs, public.run_results, public.run_events, public.worker_heartbeat
  from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, email_on_finish) on public.profiles to authenticated;
grant select on public.runs, public.run_results, public.run_events to authenticated;
grant select on public.worker_heartbeat to anon, authenticated;

create policy profiles_read_own on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy runs_read_own on public.runs for select to authenticated
  using (user_id = (select auth.uid()));
create policy run_results_read_own on public.run_results for select to authenticated
  using (user_id = (select auth.uid()));
create policy run_events_read_own on public.run_events for select to authenticated
  using (user_id = (select auth.uid()));
create policy heartbeat_read_all on public.worker_heartbeat for select to anon, authenticated
  using (true);

-- ---------------------------------------------------------------- storage

insert into storage.buckets (id, name, public, file_size_limit)
values ('uploads', 'uploads', false, 10485760), ('results', 'results', false, 20971520)
on conflict (id) do nothing;

create policy kawkit_uploads_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy kawkit_uploads_read_own on storage.objects for select to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy kawkit_results_read_own on storage.objects for select to authenticated
  using (bucket_id = 'results' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------- profile on sign-up

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- functions called by users

create function public.submit_run(p_name text, p_upload_path text, p_summary jsonb,
                                  p_priors jsonb default '{}', p_settings jsonb default '{}')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_msg bigint;
begin
  if v_uid is null then
    raise exception 'Sign in to submit a run.' using errcode = '28000';
  end if;
  if p_upload_path !~ ('^' || v_uid::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.csv$') then
    raise exception 'The uploaded file must be in your own folder.' using errcode = '42501';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'uploads' and name = p_upload_path) then
    raise exception 'The uploaded file was not found. Upload it again.' using errcode = 'P0001';
  end if;
  v_id := split_part(split_part(p_upload_path, '/', 2), '.', 1)::uuid;
  if exists (select 1 from public.runs where id = v_id) then
    raise exception 'This file was already submitted.' using errcode = 'P0001';
  end if;

  -- serialise submissions per user so the limits cannot be raced
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 42));

  if (select count(*) from public.runs where user_id = v_uid and status in ('queued', 'running')) >= 3 then
    raise exception 'You already have 3 runs waiting or running (1 running and 2 queued is the limit). Wait for one to finish or cancel one.'
      using errcode = 'P0001';
  end if;
  if (select count(*) from public.run_events
      where user_id = v_uid and type = 'submitted' and at > now() - interval '24 hours') >= 20 then
    raise exception 'You have reached 20 submissions in 24 hours. Try again tomorrow.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.runs where status = 'queued') >= 50 then
    raise exception 'The queue is full (50 runs waiting). Try again in a little while.' using errcode = 'P0001';
  end if;

  insert into public.runs (id, user_id, name, upload_path, data_summary, priors, settings, seed)
  values (v_id, v_uid, left(btrim(p_name), 80), p_upload_path, coalesce(p_summary, '{}'::jsonb),
          coalesce(p_priors, '{}'::jsonb), coalesce(p_settings, '{}'::jsonb),
          floor(random() * 2147483646)::integer + 1);

  select * into v_msg from pgmq.send('kawkit_runs', jsonb_build_object('run_id', v_id));
  update public.runs set queue_msg_id = v_msg where id = v_id;
  insert into public.run_events (run_id, user_id, type) values (v_id, v_uid, 'submitted');
  update public.profiles set last_seen_at = now() where user_id = v_uid;
  return v_id;
end $$;

create function public.cancel_run(p_run_id uuid) returns public.run_status
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  r public.runs;
begin
  select * into r from public.runs where id = p_run_id and user_id = v_uid for update;
  if not found then
    raise exception 'Run not found.' using errcode = 'P0002';
  end if;
  if r.status = 'queued' then
    if r.queue_msg_id is not null then
      perform pgmq.delete('kawkit_runs'::text, r.queue_msg_id);
    end if;
    update public.runs set status = 'cancelled', cancel_requested = true, finished_at = now(), queue_msg_id = null
      where id = p_run_id;
    insert into public.run_events (run_id, user_id, type) values (p_run_id, v_uid, 'cancelled');
    return 'cancelled';
  elsif r.status = 'running' then
    if not r.cancel_requested then
      update public.runs set cancel_requested = true where id = p_run_id;
      insert into public.run_events (run_id, user_id, type) values (p_run_id, v_uid, 'cancel_requested');
    end if;
    return 'running';
  end if;
  return r.status;
end $$;

create function public.queue_position(p_run_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select case when r.status = 'queued' then
    (select count(*)::integer from public.runs o
      where o.status = 'queued' and (o.created_at, o.id) < (r.created_at, r.id))
  else 0 end
  from public.runs r where r.id = p_run_id and r.user_id = auth.uid();
$$;

create function public.rename_run(p_run_id uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.runs set name = left(btrim(p_name), 80) where id = p_run_id and user_id = auth.uid();
  if not found then
    raise exception 'Run not found.' using errcode = 'P0002';
  end if;
end $$;

create function public.request_account_deletion() returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_at timestamptz := now();
  r record;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  -- stop anything still waiting or running
  for r in select id, status, queue_msg_id from public.runs
           where user_id = v_uid and status in ('queued', 'running') loop
    if r.status = 'queued' then
      if r.queue_msg_id is not null then
        perform pgmq.delete('kawkit_runs'::text, r.queue_msg_id);
      end if;
      update public.runs set status = 'cancelled', cancel_requested = true, finished_at = v_at, queue_msg_id = null
        where id = r.id;
    else
      update public.runs set cancel_requested = true where id = r.id;
    end if;
  end loop;
  insert into public.profiles (user_id, delete_requested) values (v_uid, v_at)
    on conflict (user_id) do update set delete_requested = coalesce(public.profiles.delete_requested, v_at);
  return v_at;
end $$;

-- ---------------------------------------------------------------- functions called by the worker

create function public.claim_next_run(p_worker_id text) returns setof public.runs
language plpgsql security definer set search_path = '' as $$
declare
  m record;
  r public.runs;
  v_rid uuid;
begin
  for i in 1..25 loop
    select * into m from pgmq.read('kawkit_runs', 900, 1);
    if not found then
      return;
    end if;
    v_rid := (m.message ->> 'run_id')::uuid;
    select * into r from public.runs where id = v_rid for update;

    if not found or r.status in ('finished', 'failed', 'cancelled') then
      perform pgmq.delete('kawkit_runs'::text, m.msg_id);
      continue;
    end if;

    if r.cancel_requested then
      perform pgmq.delete('kawkit_runs'::text, m.msg_id);
      update public.runs set status = 'cancelled', finished_at = now(), queue_msg_id = null where id = v_rid;
      insert into public.run_events (run_id, user_id, type) values (v_rid, r.user_id, 'cancelled');
      continue;
    end if;

    -- the message came back after a worker died: at most 2 retries
    if r.attempts >= 3 then
      perform pgmq.delete('kawkit_runs'::text, m.msg_id);
      update public.runs set status = 'failed', finished_at = now(), queue_msg_id = null,
        error = 'The model server was interrupted three times while fitting this run. Please submit it again.'
        where id = v_rid;
      insert into public.run_events (run_id, user_id, type, details)
        values (v_rid, r.user_id, 'failed', jsonb_build_object('reason', 'too many attempts'));
      continue;
    end if;

    -- fairness: one run per user at a time
    if exists (select 1 from public.runs o where o.user_id = r.user_id and o.status = 'running' and o.id <> v_rid) then
      perform pgmq.set_vt('kawkit_runs', m.msg_id, 30);
      continue;
    end if;

    insert into public.run_events (run_id, user_id, type, details)
      values (v_rid, r.user_id, case when r.attempts = 0 then 'started' else 'retried' end,
              jsonb_build_object('worker', p_worker_id, 'attempt', r.attempts + 1));
    return query
      update public.runs set status = 'running', started_at = now(), worker_id = p_worker_id,
        attempts = attempts + 1, progress = 0, queue_msg_id = m.msg_id
      where id = v_rid returning *;
    return;
  end loop;
  return;
end $$;

-- extend the visibility time-out, record progress, report whether the user asked to cancel
create function public.run_tick(p_run_id uuid, p_progress real) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  r public.runs;
begin
  select * into r from public.runs where id = p_run_id for update;
  if not found or r.status <> 'running' then
    return true;  -- gone or no longer ours: stop working on it
  end if;
  if r.queue_msg_id is not null then
    perform pgmq.set_vt('kawkit_runs', r.queue_msg_id, 900);
  end if;
  update public.runs set progress = greatest(0, least(1, p_progress)) where id = p_run_id;
  return r.cancel_requested;
end $$;

create function public.finish_run(p_run_id uuid, p_diagnostics jsonb, p_fit jsonb, p_channels jsonb,
                                  p_curves jsonb, p_default_plan jsonb, p_draws_path text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  r public.runs;
begin
  select * into r from public.runs where id = p_run_id for update;
  if not found or r.status <> 'running' then
    return false;
  end if;
  insert into public.run_results (run_id, user_id, diagnostics, fit, channels, curves, default_plan, draws_path)
  values (p_run_id, r.user_id, p_diagnostics, p_fit, p_channels, p_curves, p_default_plan, p_draws_path)
  on conflict (run_id) do update set diagnostics = excluded.diagnostics, fit = excluded.fit,
    channels = excluded.channels, curves = excluded.curves, default_plan = excluded.default_plan,
    draws_path = excluded.draws_path, created_at = now();
  if r.queue_msg_id is not null then
    perform pgmq.delete('kawkit_runs'::text, r.queue_msg_id);
  end if;
  update public.runs set status = 'finished', progress = 1, finished_at = now(), queue_msg_id = null, error = null
    where id = p_run_id;
  insert into public.run_events (run_id, user_id, type, details)
    values (p_run_id, r.user_id, 'finished',
            jsonb_build_object('seconds', round(extract(epoch from now() - r.started_at))));
  return true;
end $$;

-- ends a run as failed or cancelled
create function public.end_run(p_run_id uuid, p_status public.run_status, p_error text default null)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  r public.runs;
begin
  if p_status not in ('failed', 'cancelled') then
    raise exception 'end_run only accepts failed or cancelled';
  end if;
  select * into r from public.runs where id = p_run_id for update;
  if not found or r.status not in ('queued', 'running') then
    return false;
  end if;
  if r.queue_msg_id is not null then
    perform pgmq.delete('kawkit_runs'::text, r.queue_msg_id);
  end if;
  update public.runs set status = p_status, finished_at = now(), queue_msg_id = null, error = p_error
    where id = p_run_id;
  insert into public.run_events (run_id, user_id, type, details)
    values (p_run_id, r.user_id, p_status::text,
            case when p_error is null then '{}'::jsonb else jsonb_build_object('reason', p_error) end);
  return true;
end $$;

-- finished runs beyond the 5 newest, with their file paths
create function public.retention_candidates(p_user_id uuid)
returns table (run_id uuid, user_id uuid, upload_path text)
language sql stable security definer set search_path = '' as $$
  select id, user_id, upload_path from (
    select id, user_id, upload_path,
           row_number() over (order by finished_at desc nulls last, created_at desc) as n
    from public.runs where user_id = p_user_id and status = 'finished'
  ) ranked where n > 5;
$$;

-- failed and cancelled runs older than 7 days; also trims the event log to 30 days
create function public.housekeeping_candidates()
returns table (run_id uuid, user_id uuid, upload_path text)
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.run_events where at < now() - interval '30 days';
  return query
    select id, r.user_id, r.upload_path from public.runs r
    where r.status in ('failed', 'cancelled') and coalesce(r.finished_at, r.created_at) < now() - interval '7 days';
end $$;

-- delete runs after their files are gone; results and events cascade
create function public.delete_runs(p_run_ids uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  insert into public.run_events (run_id, user_id, type, details)
    select null, user_id, 'deleted', jsonb_build_object('run_id', id, 'name', name, 'status', status)
    from public.runs where id = any (p_run_ids);
  delete from public.runs where id = any (p_run_ids);
  get diagnostics n = row_count;
  return n;
end $$;

-- accounts whose deletion was requested, or with no sign-in for 12 months
create function public.accounts_to_delete() returns table (user_id uuid, reason text)
language sql stable security definer set search_path = '' as $$
  select p.user_id, 'requested' from public.profiles p where p.delete_requested is not null
  union
  select u.id, 'inactive' from auth.users u
  where coalesce(u.last_sign_in_at, u.created_at) < now() - interval '12 months';
$$;

-- ---------------------------------------------------------------- function permissions

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.submit_run(text, text, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.cancel_run(uuid) to authenticated;
grant execute on function public.queue_position(uuid) to authenticated;
grant execute on function public.rename_run(uuid, text) to authenticated;
grant execute on function public.request_account_deletion() to authenticated;

grant execute on all functions in schema public to service_role;
grant all on public.profiles, public.runs, public.run_results, public.run_events, public.worker_heartbeat
  to service_role;

-- ---------------------------------------------------------------- live updates

alter publication supabase_realtime add table public.runs, public.worker_heartbeat;
