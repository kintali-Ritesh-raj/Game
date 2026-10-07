-- Remove closed rooms and rooms with no game activity for 15 minutes.
-- Deleting a room cascades to its secrets, connections, commands and seat keys.
create extension if not exists pg_cron;

create function public.mw_cleanup_rooms()
returns integer language sql security invoker set search_path = '' as $$
  with gone as (
    delete from public.mw_rooms
    where status = 'closed' or updated_at < now() - interval '15 minutes'
    returning 1
  ) select count(*)::int from gone;
$$;
revoke all on function public.mw_cleanup_rooms() from public, anon, authenticated;

select cron.schedule('mw-cleanup-rooms', '* * * * *', 'select public.mw_cleanup_rooms()');

-- A private rejoin code per human seat lets a player recover their seat on a
-- new device or after clearing browser data. Server access only.
create table public.mw_seat_keys (
  code text not null references public.mw_rooms(code) on delete cascade,
  user_id uuid not null,
  rejoin_code text not null,
  created_at timestamptz not null default now(),
  primary key (code, user_id),
  unique (code, rejoin_code)
);
alter table public.mw_seat_keys enable row level security;
revoke all on public.mw_seat_keys from anon, authenticated;
grant all on public.mw_seat_keys to service_role;

-- Move a seat from its old anonymous identity to the caller.
create function public.mw_reclaim_seat(p_code text, p_actor uuid, p_rejoin text)
returns public.mw_rooms language plpgsql security invoker set search_path = '' as $$
declare r public.mw_rooms; v_old uuid;
begin
  if p_actor is null then raise exception 'A player session is required.'; end if;
  select * into r from public.mw_rooms where code = p_code for update;
  if not found or r.status = 'closed' then raise exception 'Room not found. Check the code with the Host.'; end if;
  select user_id into v_old from public.mw_seat_keys where code = p_code and rejoin_code = upper(trim(p_rejoin));
  if v_old is null then raise exception 'That rejoin code does not match a seat in this room.'; end if;
  if v_old = p_actor then return r; end if;
  if p_actor = any(r.member_ids) then raise exception 'This browser already has a different seat in this room.'; end if;
  update public.mw_rooms set
    member_ids = array_replace(member_ids, v_old, p_actor),
    host_id = case when host_id = v_old then p_actor else host_id end,
    members = (select jsonb_agg(case when (m->>'user_id')::uuid = v_old then m || jsonb_build_object('user_id', p_actor) else m end order by ord)
               from jsonb_array_elements(r.members) with ordinality as x(m, ord)),
    revision = revision + 1, updated_at = now()
  where code = p_code returning * into r;
  update public.mw_seat_keys set user_id = p_actor where code = p_code and user_id = v_old;
  update public.mw_connections set connected = false where code = p_code and user_id = v_old;
  return r;
end;
$$;
revoke all on function public.mw_reclaim_seat(text, uuid, text) from public, anon, authenticated;
grant execute on function public.mw_reclaim_seat(text, uuid, text) to service_role;
