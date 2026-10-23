-- Up to six players per room, with two more colours (orange, cyan).
alter table public.mw_rooms drop constraint if exists mw_rooms_members_check;
alter table public.mw_rooms add constraint mw_rooms_members_check check (jsonb_typeof(members) = 'array' and jsonb_array_length(members) <= 6);

create or replace function public.mw_validate_profile(p_profile jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if jsonb_typeof(p_profile->'name') is distinct from 'string'
     or length(trim(p_profile->>'name')) not between 1 and 20
     or coalesce(p_profile->>'token','') not in ('black','blue','magenta','lime','orange','cyan') then
    raise exception 'Choose a valid player name and color.';
  end if;
end;
$$;

-- A joining player whose colour is already in use gets the first free one, under the row lock.
create or replace function public.mw_join_room(p_code text, p_actor uuid, p_profile jsonb)
returns public.mw_rooms language plpgsql security invoker set search_path = '' as $$
declare r public.mw_rooms; v_seat int; v_token text;
begin
  if p_actor is null then raise exception 'A player session is required.'; end if;
  select * into r from public.mw_rooms where code = p_code for update;
  if not found or r.status = 'closed' then raise exception 'Room not found. Check the code with the Host.'; end if;
  -- Rejoining is allowed even during play or when every seat is occupied.
  if p_actor = any(r.member_ids) then return r; end if;
  if r.status <> 'lobby' then raise exception 'This game has already started. Only its existing players can reconnect.'; end if;
  if cardinality(r.member_ids) >= 6 then raise exception 'This room is full. A maximum of 6 players can join.'; end if;
  perform public.mw_validate_profile(p_profile);
  if exists (select 1 from jsonb_array_elements(r.members) m where lower(m->>'name') = lower(trim(p_profile->>'name'))) then
    raise exception 'That player name is taken. Choose another name.';
  end if;
  v_token := p_profile->>'token';
  if exists (select 1 from jsonb_array_elements(r.members) m where m->>'token' = v_token) then
    select t into v_token from unnest(array['black','blue','magenta','lime','orange','cyan']) with ordinality as c(t, ord)
      where not exists (select 1 from jsonb_array_elements(r.members) m where m->>'token' = c.t) order by ord limit 1;
  end if;
  v_seat := cardinality(r.member_ids);
  update public.mw_rooms set
    members = members || jsonb_build_array(p_profile || jsonb_build_object('name',trim(p_profile->>'name'),'token',v_token,'user_id',p_actor,'seat',v_seat)),
    member_ids = array_append(member_ids,p_actor), revision = revision + 1, updated_at = now()
  where code = p_code returning * into r;
  return r;
end;
$$;
