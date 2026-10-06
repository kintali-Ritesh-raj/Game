import { createHash } from 'node:crypto';
import { authenticate } from '@/lib/supabase-server';
import { ApiError, apiResponse, command, jsonBody, profile, requestId, revision, roomCode } from '@/lib/validation';
import { readRoom, roomRpc } from '@/lib/room-store';
import { applyGameAction, requireRevision, startGame } from '@/lib/game-actions';
import type { GameState, Room } from '@/lib/types';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ code: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const { db, actor } = await authenticate(request);
    const code = roomCode((await context.params).code), room = await readRoom(db, code, actor);
    const { data: connections, error } = await db.from('mw_connections').select('*').eq('code', code);
    if (error) throw error;
    return Response.json({ room, connections });
  } catch (error) { return apiResponse(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const { db, actor } = await authenticate(request);
    const code = roomCode((await context.params).code), body = await jsonBody(request);
    if (body.operation === 'join') return Response.json({ room: await roomRpc(db, 'mw_join_room', { p_code: code, p_actor: actor, p_profile: profile(body) }) });
    const room = await readRoom(db, code, actor);
    if (body.operation === 'heartbeat') {
      const { error } = await db.from('mw_connections').upsert({ code, user_id: actor, client_id: requestId(body.client_id), seen_at: new Date().toISOString(), connected: body.connected !== false });
      if (error) throw error;
      return Response.json({ ok: true });
    }
    if (body.operation === 'profile') return Response.json({ room: await roomRpc(db, 'mw_profile_room', { p_code: code, p_actor: actor, p_profile: profile(body), p_expected: revision(body.revision) }) });
    if (body.operation === 'leave') return Response.json({ room: await roomRpc(db, 'mw_leave_room', { p_code: code, p_actor: actor }) });
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
      const {data, error} = await db.from('mw_rooms').select('*,mw_game_secrets(state)').eq('code',code).single();
      if (error) throw error;
      const {mw_game_secrets:secrets,...snapshot}=data as unknown as Room & {mw_game_secrets:{state:GameState}|null};
      requireRevision(snapshot,expected);
      if (!secrets) throw new ApiError(503,'The game state is unavailable. Try again.');
      authoritative = {...snapshot,state:secrets.state};
    }
    const result = action ? await applyGameAction(authoritative, actor, action) : { state: startGame(room, actor), transition: null };
    return Response.json({ room: await roomRpc(db, 'mw_commit_game', {
      p_code: code, p_actor: actor, p_expected: expected, p_state: result.state,
      p_transition: result.transition, p_request_id: id, p_fingerprint: fingerprint, p_start: !action,
    }) });
  } catch (error) { return apiResponse(error); }
}
