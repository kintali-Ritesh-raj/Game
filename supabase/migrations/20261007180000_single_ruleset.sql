-- Classic rules: every player follows the same rule set, so profiles carry no role
-- and a table no longer needs a Monopolist and a Competitor to start.
-- An open trade offer waits on its recipient, who becomes the acting seat.

create or replace function public.mw_validate_profile(p_profile jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if jsonb_typeof(p_profile->'name') is distinct from 'string'
     or length(trim(p_profile->>'name')) not between 1 and 20
     or coalesce(p_profile->>'token','') not in ('briefcase','rocket','building','car','coin','crown','factory','laptop') then
    raise exception 'Choose a valid player name and token.';
  end if;
end;
$$;

create or replace function public.mw_commit_game(
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
  else
    if r.status <> 'playing' then raise exception 'This game is not accepting turns.'; end if;
    v_seat := array_position(r.member_ids,p_actor)-1;
    v_acting := coalesce((r.state#>>'{pending,payer}')::int,(r.state#>>'{auction,bidder}')::int,(r.state#>>'{trade,to}')::int,(r.state->>'currentPlayer')::int);
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
