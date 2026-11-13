-- Lets a restarted worker retry its interrupted runs at once instead of waiting for the
-- 15-minute visibility time-out.
create function public.requeue_worker_runs(p_worker_id text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n integer := 0;
begin
  for r in select id, queue_msg_id from public.runs
           where status = 'running' and worker_id = p_worker_id and queue_msg_id is not null loop
    perform pgmq.set_vt('kawkit_runs', r.queue_msg_id, 0);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.requeue_worker_runs(text) from public, anon, authenticated;
grant execute on function public.requeue_worker_runs(text) to service_role;
