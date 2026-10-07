import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { applyGameAction, memberIndex, requireRevision } from './game-actions';
import { idleSeat, turnDeadline } from './bot-timing';
import { chooseBotAction } from './bot-strategy';
import { readGameRoom, roomRpc } from './room-store';
import { ApiError } from './validation';
import type { Room, Transition } from './types';

// Any connected human can expire an idle player's turn once the deadline passes.
// The server decides the forced moves; the room revision allows only one commit.
export async function expireTurn(db: SupabaseClient, room: Room, requester: string, expected: number) {
  const requesterSeat = memberIndex(room, requester);
  if (room.members[requesterSeat].type === 'bot') throw new ApiError(403, 'A human player session is required.');
  requireRevision(room, expected);
  if (idleSeat(room) === null || Date.now() < turnDeadline(room)) return room;
  let current = await readGameRoom(db, room.code, expected);
  const seat = idleSeat(current);
  if (seat === null) return room;
  const actor = current.members[seat].user_id;
  let transition: Transition | null = null;
  for (let step = 0; step < 40; step++) {
    const state = current.state!;
    const acting = state.pending?.payer ?? state.auction?.bidder ?? state.currentPlayer;
    if (acting !== seat || state.phase === 'victory') break;
    let result;
    if (state.auction) result = await applyGameAction(current, actor, { action: 'pass' });
    else if (state.pending) result = await applyGameAction(current, actor, chooseBotAction(state)!);
    else if (state.phase === 'event') result = await applyGameAction(current, actor, { action: 'apply-event' });
    else result = await applyGameAction(current, actor, { action: 'timeout' });
    current = { ...current, state: result.state };
    transition = result.transition;
    // An auction pass or an off-turn debt only releases this player; the turn itself continues.
    if (state.auction || (state.pending && state.pending.payer !== state.currentPlayer && !result.state.pending)) break;
  }
  const hash = createHash('sha256').update('timeout:' + room.code + ':' + expected).digest('hex');
  const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
  return roomRpc(db, 'mw_commit_game', {
    p_code: room.code, p_actor: actor, p_expected: expected, p_state: current.state, p_transition: transition,
    p_request_id: id, p_fingerprint: 'timeout:' + expected, p_start: false,
  });
}
