-- Shareable read-only links to a finished run's results.
-- Anyone holding the token can read the results (not the uploaded file) until it expires or is revoked.

create table public.shares (
  token      uuid primary key default gen_random_uuid(),
  run_id     uuid not null references public.runs on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  revoked_at timestamptz
);
create index shares_run on public.shares (run_id);

alter table public.shares enable row level security;
revoke all on public.shares from anon, authenticated;
grant select on public.shares to authenticated;
create policy shares_read_own on public.shares for select to authenticated
  using (user_id = (select auth.uid()));

-- owner creates a link for one of their finished runs; an active link is reused
create function public.create_share(p_run_id uuid) returns public.shares
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  s public.shares;
begin
  if not exists (select 1 from public.runs where id = p_run_id and user_id = v_uid and status = 'finished') then
    raise exception 'Only your own finished runs can be shared.' using errcode = 'P0002';
  end if;
  select * into s from public.shares
    where run_id = p_run_id and user_id = v_uid and revoked_at is null and expires_at > now()
    order by created_at desc limit 1;
  if found then
    return s;
  end if;
  if (select count(*) from public.shares where user_id = v_uid and revoked_at is null and expires_at > now()) >= 20 then
    raise exception 'You have 20 active links already. Stop sharing one first.' using errcode = 'P0001';
  end if;
  insert into public.shares (run_id, user_id) values (p_run_id, v_uid) returning * into s;
  return s;
end $$;

create function public.revoke_share(p_run_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  update public.shares set revoked_at = now()
    where run_id = p_run_id and user_id = auth.uid() and revoked_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- anyone with a valid token: the run's name and results, nothing that identifies the owner
create function public.get_shared_run(p_token uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'name', r.name,
    'finished_at', r.finished_at,
    'expires_at', s.expires_at,
    'weeks', r.data_summary -> 'weeks',
    'result', jsonb_build_object(
      'run_id', res.run_id, 'diagnostics', res.diagnostics, 'fit', res.fit, 'channels', res.channels,
      'curves', res.curves, 'default_plan', res.default_plan, 'draws_path', ''))
  from public.shares s
  join public.runs r on r.id = s.run_id and r.status = 'finished'
  join public.run_results res on res.run_id = r.id
  where s.token = p_token and s.revoked_at is null and s.expires_at > now();
$$;

revoke execute on function public.create_share(uuid), public.revoke_share(uuid), public.get_shared_run(uuid) from public, anon, authenticated;
grant execute on function public.create_share(uuid), public.revoke_share(uuid) to authenticated;
grant execute on function public.get_shared_run(uuid) to anon, authenticated;
grant execute on function public.create_share(uuid), public.revoke_share(uuid), public.get_shared_run(uuid) to service_role;
grant all on public.shares to service_role;
