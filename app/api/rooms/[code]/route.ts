import { createHash } from 'node:crypto';
import { authenticate } from '@/lib/supabase-server';
import { ApiError, apiResponse, command, jsonBody, profile, requestId, revision, roomCode } from '@/lib/validation';
import { readGameRoom, readMemberGameRoom, readRoom, roomRpc } from '@/lib/room-store';
import { applyGameAction, requireRevision, startGame } from '@/lib/game-actions';
import { addBotMembers, membersAfterLeaving, removeBotMembers, saveLobbyMembers } from '@/lib/lobby-bots';
import { advanceBot } from '@/lib/bot-runner';
import { expireTurn, forfeitGame } from '@/lib/turn-timeout';
import { reclaimSeat, seatKey } from '@/lib/seat-keys';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ code: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const { db, actor } = await authenticate(request);
    const code = roomCode((await context.params).code);
    // The room and its connection list are independent reads, so they run together.
    const [room, { data: connections, error }] = await Promise.all([readRoom(db, code, actor), db.from('mw_connections').select('*').eq('code', code)]);
    if (error) throw error;
    return Response.json({ room, connections });
  } catch (error) { return apiResponse(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const { db, actor } = await authenticate(request);
    const code = roomCode((await context.params).code), body = await jsonBody(request);
    if (body.operation === 'join') return Response.json({ room: await roomRpc(db, 'mw_join_room', { p_code: code, p_actor: actor, p_profile: profile(body) }) });
    // Before joining, a player may see which colours are already in use, so they can pick a free one.
    if (body.operation === 'peek') {
      const { data, error } = await db.from('mw_rooms').select('status,members').eq('code', code).maybeSingle();
      if (error) throw error;
      if (!data || data.status === 'closed') throw new ApiError(404, 'Room not found. Check the code with the Host.');
      return Response.json({ status: data.status, players: data.members.length, taken: (data.members as { token: string }[]).map(member => member.token) });
    }
    if (body.operation === 'reclaim') return Response.json({ room: await reclaimSeat(db, code, actor, body.rejoin_code) });
    // Check-ins (every 15 seconds per player) only need the member list, not the whole game state.
    if (body.operation === 'heartbeat') {
      const { data, error } = await db.from('mw_rooms').select('member_ids,status').eq('code', code).maybeSingle();
      if (error) throw error;
      if (!data || data.status === 'closed') throw new ApiError(404, 'Room not found. Check the code with the Host.');
      if (!data.member_ids.includes(actor)) throw new ApiError(403, 'Join this room to access the lobby.');
      const { error: upsertError } = await db.from('mw_connections').upsert({ code, user_id: actor, client_id: requestId(body.client_id), seen_at: new Date().toISOString(), connected: body.connected !== false });
      if (upsertError) throw upsertError;
      return Response.json({ ok: true });
    }
    // A move reads the room with its private state once, alongside the duplicate check, instead of three reads in a row.
    if (body.operation === 'action') {
      const id = requestId(body.request_id), expected = revision(body.revision), action = command(body);
      const fingerprint = createHash('sha256').update(JSON.stringify(action)).digest('hex');
      const [{ room, state }, { data: receipt, error: receiptError }] = await Promise.all([
        readMemberGameRoom(db, code, actor),
        db.from('mw_commands').select('actor,fingerprint').eq('code', code).eq('request_id', id).maybeSingle(),
      ]);
      if (receiptError) throw receiptError;
      if (receipt) {
        if (receipt.actor !== actor || receipt.fingerprint !== fingerprint) throw new ApiError(403, 'This request identifier belongs to a different action.');
        return Response.json({ room });
      }
      requireRevision(room, expected);
      if (!state) throw new ApiError(503, 'The game state is unavailable. Try again.');
      const result = await applyGameAction({ ...room, state }, actor, action);
      return Response.json({ room: await roomRpc(db, 'mw_commit_game', {
        p_code: code, p_actor: actor, p_expected: expected, p_state: result.state,
        p_transition: result.transition, p_request_id: id, p_fingerprint: fingerprint, p_start: false,
      }) });
    }
    if (body.operation === 'bot-step') {
      const { room, state } = await readMemberGameRoom(db, code, actor);
      return Response.json({ room: await advanceBot(db, room, actor, revision(body.revision), state) });
    }
    const room = await readRoom(db, code, actor);
    if (body.operation === 'rejoin-code') return Response.json({ rejoin_code: await seatKey(db, room, actor) });
    if (body.operation === 'add-bot' || body.operation === 'remove-bot') {
      const expected = revision(body.revision);
      const members = body.operation === 'add-bot' ? addBotMembers(room,actor,expected) : removeBotMembers(room,actor,expected,body.bot_id);
      return Response.json({room:await saveLobbyMembers(db,room,members)});
    }
    if (body.operation === 'forfeit') return Response.json({room:await forfeitGame(db,room,actor,revision(body.revision))});
    if (body.operation === 'timeout') return Response.json({room:await expireTurn(db,room,actor,revision(body.revision))});
    if (body.operation === 'profile') return Response.json({ room: await roomRpc(db, 'mw_profile_room', { p_code: code, p_actor: actor, p_profile: profile(body), p_expected: revision(body.revision) }) });
    if (body.operation === 'leave') {
      if (room.status !== 'lobby') return Response.json({room:await roomRpc(db,'mw_leave_room',{p_code:code,p_actor:actor})});
      const next = membersAfterLeaving(room,actor);
      return Response.json({room:await saveLobbyMembers(db,room,next.members,next.host_id,next.status)});
    }
    if (body.operation !== 'start' && body.operation !== 'action') throw new ApiError(400, 'Unknown room operation.');
    const id = requestId(body.request_id), expected = revision(body.revision);
    const action = body.operation === 'start' ? null : command(body);
    const fingerprint = createHash('sha256').update(JSON.stringify(action ?? 'start')).digest('hex');
    const { data: receipt, error: receiptError } = await db.from('mw_commands').select('actor,fingerprint').eq('code', code).eq('request_id', id).maybeSingle();
    if (receiptError) throw receiptError;
    if (receipt) {
      if (receipt.actor !== actor || receipt.fingerprint !== fingerprint) throw new ApiError(403, 'This request identifier belongs to a different action.');
      return Response.json({ room });
    }
    requireRevision(room, expected);
    let authoritative = room;
    if (action) {
      // Read the revision and private state in one database snapshot. Another
      // command can commit between separate reads of the public and private rows.
      authoritative = await readGameRoom(db,code,expected);
    }
    const result = action ? await applyGameAction(authoritative, actor, action) : { state: startGame(room, actor), transition: null };
    return Response.json({ room: await roomRpc(db, 'mw_commit_game', {
      p_code: code, p_actor: actor, p_expected: expected, p_state: result.state,
      p_transition: result.transition, p_request_id: id, p_fingerprint: fingerprint, p_start: !action,
    }) });
  } catch (error) { return apiResponse(error); }
}
