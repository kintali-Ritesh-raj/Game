-- Browsers can read their own rooms. Only the authenticated Next.js server can
-- mutate state or call these SECURITY INVOKER functions with its secret key.
create table public.mw_rooms (
  code text primary key check (code ~ '^[A-Z0-9]{6}$'),
  host_id uuid not null,
  created_by uuid not null,
  creation_id uuid not null unique,
  members jsonb not null,
  member_ids uuid[] not null,
  status text not null default 'lobby' check (status in ('lobby','playing','finished','closed')),
  revision bigint not null default 0 check (revision >= 0),
  state jsonb,
  transition jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(members) = 'array' and jsonb_array_length(members) <= 4),
  check (jsonb_array_length(members) = cardinality(member_ids)),
  check (status = 'closed' or (cardinality(member_ids) > 0 and host_id = any(member_ids))),
  check ((status in ('lobby','closed') and state is null) or (status in ('playing','finished') and state is not null))
);
create index mw_rooms_members on public.mw_rooms using gin(member_ids);
create index mw_rooms_created_by on public.mw_rooms(created_by, created_at);

-- Full state includes the secret order of future event cards. It is never
-- selectable by browsers and is deliberately excluded from Realtime.
create table public.mw_game_secrets (
  code text primary key references public.mw_rooms(code) on delete cascade,
  state jsonb not null
);
alter table public.mw_game_secrets enable row level security;
revoke all on public.mw_game_secrets from anon, authenticated;
grant all on public.mw_game_secrets to service_role;

create table public.mw_connections (
  code text not null references public.mw_rooms(code) on delete cascade,
  user_id uuid not null,
  client_id uuid not null,
  seen_at timestamptz not null default now(),
  connected boolean not null default true,
  primary key(code, user_id, client_id)
);
create table public.mw_commands (
  code text not null references public.mw_rooms(code) on delete cascade,
  request_id uuid not null,
  actor uuid not null,
  fingerprint text not null,
  revision bigint not null,
  created_at timestamptz not null default now(),
  primary key(code, request_id)
);
alter table public.mw_rooms enable row level security;
alter table public.mw_connections enable row level security;
alter table public.mw_commands enable row level security;
revoke all on public.mw_rooms, public.mw_connections, public.mw_commands from anon, authenticated;
grant select on public.mw_rooms, public.mw_connections to authenticated;
grant all on public.mw_rooms, public.mw_connections, public.mw_commands to service_role;
create policy "Players read their room" on public.mw_rooms for select to authenticated
  using ((select auth.uid()) = any(member_ids));
create policy "Players read room connections" on public.mw_connections for select to authenticated
  using (exists (select 1 from public.mw_rooms r where r.code = mw_connections.code and (select auth.uid()) = any(r.member_ids)));

create function public.mw_validate_profile(p_profile jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if jsonb_typeof(p_profile->'name') is distinct from 'string'
     or length(trim(p_profile->>'name')) not between 1 and 20
     or coalesce(p_profile->>'role','') not in ('monopolist','competitor')
     or coalesce(p_profile->>'token','') not in ('briefcase','rocket','building','car','coin','crown','factory','laptop') then
    raise exception 'Choose a valid player name, role, and token.';
  end if;
end;
$$;

create function public.mw_create_room(p_code text, p_actor uuid, p_profile jsonb, p_request_id uuid)
returns public.mw_rooms language plpgsql security invoker set search_path = '' as $$
declare r public.mw_rooms;
begin
  if p_actor is null then raise exception 'A player session is required.'; end if;
  perform public.mw_validate_profile(p_profile);
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text,0));
  select * into r from public.mw_rooms where creation_id = p_request_id;
  if found then
    if r.created_by <> p_actor then raise exception 'This request identifier belongs to a different player.'; end if;
    return r;
  end if;
  if (select count(*) from public.mw_rooms where created_by = p_actor and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Room creation limit reached. Rejoin one of your rooms or try later.';
  end if;
  insert into public.mw_rooms(code,host_id,created_by,creation_id,members,member_ids)
  values(p_code,p_actor,p_actor,p_request_id,jsonb_build_array(
    p_profile || jsonb_build_object('name',trim(p_profile->>'name'),'user_id',p_actor,'seat',0)
  ),array[p_actor]) returning * into r;
  return r;
end;
$$;

create function public.mw_join_room(p_code text, p_actor uuid, p_profile jsonb)
returns public.mw_rooms language plpgsql security invoker set search_path = '' as $$
declare r public.mw_rooms; v_seat int;
begin
  if p_actor is null then raise exception 'A player session is required.'; end if;
  select * into r from public.mw_rooms where code = p_code for update;
  if not found or r.status = 'closed' then raise exception 'Room not found. Check the code with the Host.'; end if;
  -- Rejoining is allowed even during play or when all four seats are occupied.
  if p_actor = any(r.member_ids) then return r; end if;
  if r.status <> 'lobby' then raise exception 'This game has already started. Only its existing players can reconnect.'; end if;
  if cardinality(r.member_ids) >= 4 then raise exception 'This room is full. A maximum of 4 players can join.'; end if;
  perform public.mw_validate_profile(p_profile);
  if exists (select 1 from jsonb_array_elements(r.members) m where lower(m->>'name') = lower(trim(p_profile->>'name'))) then
    raise exception 'That player name is taken. Choose another name.';
  end if;
  if exists (select 1 from jsonb_array_elements(r.members) m where m->>'token' = p_profile->>'token') then
    raise exception 'That token is taken. Choose another token.';
  end if;
  v_seat := cardinality(r.member_ids);
  update public.mw_rooms set
    members = members || jsonb_build_array(p_profile || jsonb_build_object('name',trim(p_profile->>'name'),'user_id',p_actor,'seat',v_seat)),
    member_ids = array_append(member_ids,p_actor), revision = revision + 1, updated_at = now()
  where code = p_code returning * into r;
  return r;
end;
$$;

create function public.mw_profile_room(p_code text, p_actor uuid, p_profile jsonb, p_expected bigint)
returns public.mw_rooms language plpgsql security invoker set search_path = '' as $$
declare r public.mw_rooms;
begin
  select * into r from public.mw_rooms where code = p_code for update;
  if not found then raise exception 'Room not found.'; end if;
  if p_actor is null or not p_actor = any(r.member_ids) then raise exception 'You are not a player in this room.'; end if;
  if r.status <> 'lobby' then raise exception 'Player choices are locked after the game starts.'; end if;
  if r.revision <> p_expected then raise exception 'The room changed. Synchronize and try again.'; end if;
  perform public.mw_validate_profile(p_profile);
  if exists (select 1 from jsonb_array_elements(r.members) m where (m->>'user_id')::uuid <> p_actor and
    (lower(m->>'name') = lower(trim(p_profile->>'name')) or m->>'token' = p_profile->>'token')) then
    raise exception 'That name or token is taken. Choose another.';
  end if;
  update public.mw_rooms set members = (
    select jsonb_agg(case when (m->>'user_id')::uuid = p_actor
      then m || p_profile || jsonb_build_object('name',trim(p_profile->>'name')) else m end order by ord)
    from jsonb_array_elements(r.members) with ordinality as x(m,ord)
  ), revision = revision + 1, updated_at = now() where code = p_code returning * into r;
  return r;
end;
$$;

create function public.mw_leave_room(p_code text, p_actor uuid)
returns public.mw_rooms language plpgsql security invoker set search_path = '' as $$
declare r public.mw_rooms; v_members jsonb; v_ids uuid[];
begin
  select * into r from public.mw_rooms where code = p_code for update;
  if not found then raise exception 'Room not found.'; end if;
  if p_actor is null or not p_actor = any(r.member_ids) then raise exception 'You are not a player in this room.'; end if;
  update public.mw_connections set connected = false where code = p_code and user_id = p_actor;
  -- Disconnection is never bankruptcy or a skipped turn. Keep the game intact.
  if r.status <> 'lobby' then return r; end if;
  select coalesce(jsonb_agg(m || jsonb_build_object('seat',ord-1) order by ord),'[]'::jsonb),
         coalesce(array_agg((m->>'user_id')::uuid order by ord),'{}'::uuid[])
    into v_members,v_ids from (
      select m,row_number() over (order by original_ord) ord
      from jsonb_array_elements(r.members) with ordinality as x(m,original_ord)
      where (m->>'user_id')::uuid <> p_actor
    ) remaining;
  update public.mw_rooms set members = v_members, member_ids = v_ids,
    host_id = case when host_id = p_actor and cardinality(v_ids) > 0 then v_ids[1] else host_id end,
    status = case when cardinality(v_ids) = 0 then 'closed' else 'lobby' end,
    revision = revision + 1, updated_at = now() where code = p_code returning * into r;
  return r;
end;
$$;

create function public.mw_commit_game(
  p_code text, p_actor uuid, p_expected bigint, p_state jsonb, p_transition jsonb,
  p_request_id uuid, p_fingerprint text, p_start boolean
)
returns public.mw_rooms language plpgsql security invoker set search_path = '' as $$
declare r public.mw_rooms; receipt public.mw_commands; v_seat int; v_acting int;
begin
  select * into r from public.mw_rooms where code = p_code for update;
  if not found then raise exception 'Room not found.'; end if;
  if p_actor is null or not p_actor = any(r.member_ids) then raise exception 'You are not a player in this room.'; end if;
  select * into receipt from public.mw_commands where code = p_code and request_id = p_request_id;
  if found then
    if receipt.actor <> p_actor or receipt.fingerprint <> p_fingerprint then
      raise exception 'This request identifier belongs to a different action.';
    end if;
    return r;
  end if;
  if r.revision <> p_expected then raise exception 'The room changed. Synchronize and try again.'; end if;
  if p_start then
    if r.host_id <> p_actor then raise exception 'Only the Host can start the game.'; end if;
    if r.status <> 'lobby' then raise exception 'The game has already started.'; end if;
    if cardinality(r.member_ids) < 2 then raise exception 'At least 2 players are required.'; end if;
    if (select count(distinct m->>'role') from jsonb_array_elements(r.members) m) <> 2 then
      raise exception 'The table needs at least one Monopolist and one Competitor.';
    end if;
  else
    if r.status <> 'playing' then raise exception 'This game is not accepting turns.'; end if;
    v_seat := array_position(r.member_ids,p_actor)-1;
    v_acting := coalesce((r.state#>>'{pending,payer}')::int,(r.state#>>'{auction,bidder}')::int,(r.state->>'currentPlayer')::int);
    if v_seat <> v_acting then raise exception 'Only the acting player can take this action.'; end if;
  end if;
  if p_state is null or jsonb_array_length(p_state->'players') <> cardinality(r.member_ids) then
    raise exception 'Invalid game state.';
  end if;
  insert into public.mw_game_secrets(code,state) values(p_code,p_state)
    on conflict(code) do update set state=excluded.state;
  update public.mw_rooms set state = jsonb_set(jsonb_set(p_state,'{decks,market,order}','[]'::jsonb),'{decks,economic,order}','[]'::jsonb), transition = p_transition,
    status = case when p_state->>'phase' = 'victory' then 'finished' else 'playing' end,
    revision = revision + 1, updated_at = now() where code = p_code returning * into r;
  insert into public.mw_commands(code,request_id,actor,fingerprint,revision)
    values(p_code,p_request_id,p_actor,p_fingerprint,r.revision);
  return r;
end;
$$;

revoke all on function public.mw_validate_profile(jsonb) from public, anon, authenticated;
revoke all on function public.mw_create_room(text,uuid,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.mw_join_room(text,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.mw_profile_room(text,uuid,jsonb,bigint) from public, anon, authenticated;
revoke all on function public.mw_leave_room(text,uuid) from public, anon, authenticated;
revoke all on function public.mw_commit_game(text,uuid,bigint,jsonb,jsonb,uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.mw_validate_profile(jsonb),
  public.mw_create_room(text,uuid,jsonb,uuid), public.mw_join_room(text,uuid,jsonb),
  public.mw_profile_room(text,uuid,jsonb,bigint), public.mw_leave_room(text,uuid),
  public.mw_commit_game(text,uuid,bigint,jsonb,jsonb,uuid,text,boolean) to service_role;

-- Postgres Changes supplies both the lobby/game updates and connected status.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mw_rooms') then
    alter publication supabase_realtime add table public.mw_rooms;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mw_connections') then
    alter publication supabase_realtime add table public.mw_connections;
  end if;
end $$;
