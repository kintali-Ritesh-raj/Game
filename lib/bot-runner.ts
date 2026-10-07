import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { applyGameAction, memberIndex, requireRevision } from './game-actions';
import { botReadyAt, botSeat } from './bot-timing';
import { chooseBotAction } from './bot-strategy';
import { readGameRoom, roomRpc } from './room-store';
import { ApiError } from './validation';
import type { Room } from './types';

export async function advanceBot(db:SupabaseClient, room:Room, requester:string, expected:number) {
  const requesterSeat = memberIndex(room,requester);
  if (room.members[requesterSeat].type === 'bot') throw new ApiError(403,'A human player session is required.');
  requireRevision(room,expected);
  if (botSeat(room) === null || Date.now() < botReadyAt(room)) return room;
  const authoritative = await readGameRoom(db,room.code,expected);
  const seat = botSeat(authoritative);
  if (seat === null) return room;
  const command = chooseBotAction(authoritative.state!);
  if (!command) return room;
  const actor = authoritative.members[seat].user_id;
  const result = await applyGameAction(authoritative,actor,command);
  // Any connected human can wake a bot. The server chooses the move, and the
  // existing transaction/receipt allows just one move for this room revision.
  const hash = createHash('sha256').update(room.code + ':' + expected + ':' + actor).digest('hex');
  const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
  return roomRpc(db,'mw_commit_game',{
    p_code:room.code,p_actor:actor,p_expected:expected,p_state:result.state,p_transition:result.transition,
    p_request_id:id,p_fingerprint:'bot:'+expected,p_start:false,
  });
}
