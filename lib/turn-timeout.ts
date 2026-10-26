import { createHash } from 'node:crypto';
import MarketWars from './game-engine.cjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { applyGameAction, memberIndex, requireRevision } from './game-actions';
import { actingSeat, idleSeat, turnDeadline } from './bot-timing';
import { timeoutCommand } from './bot-strategy';
import { readGameRoom, roomRpc } from './room-store';
import { ApiError } from './validation';
import type { GameState, Room, Transition } from './types';

export const MISSED_TURNS_LIMIT = 3;
// Counts a turn the server had to play for an offline player; on the 3rd in a row they are removed and their
// properties go back to the bank. (A move they make themselves resets the count; see applyGameAction.)
export function recordMissedTurn(state: GameState, seat: number): GameState {
  const next = structuredClone(state), player = next.players[seat];
  player.missed = (player.missed || 0) + 1;
  if (player.missed < MISSED_TURNS_LIMIT) return next;
  const game = MarketWars.Game.restore(JSON.stringify(next), { wait: async () => {} });
  try { game.log(player.name + ' missed ' + MISSED_TURNS_LIMIT + ' turns in a row and is removed from the game.', 'important', 'loss', seat); game.forfeit(seat); }
  catch { return next; } // mid-payment or auction: removed on the next missed turn instead
  return JSON.parse(game.serialize()) as GameState;
}
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
  const actor = current.members[seat].user_id, ownTurn = current.state!.currentPlayer === seat;
  let transition: Transition | null = null;
  for (let step = 0; step < 40; step++) {
    const state = current.state!;
    const acting = actingSeat(state);
    if (acting !== seat || state.phase === 'victory') break;
    const result = await applyGameAction(current, actor, timeoutCommand(state), true);
    current = { ...current, state: result.state };
    transition = result.transition;
    // An auction pass, an unanswered trade or an off-turn debt only releases this player; the turn itself continues.
    if (state.auction || state.trade || (state.pending && state.pending.payer !== state.currentPlayer && !result.state.pending)) break;
  }
  if (ownTurn && current.state && current.state.phase !== 'victory') current = { ...current, state: recordMissedTurn(current.state, seat) };
  const hash = createHash('sha256').update('timeout:' + room.code + ':' + expected).digest('hex');
  const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
  return roomRpc(db, 'mw_commit_game', {
    p_code: room.code, p_actor: actor, p_expected: expected, p_state: current.state, p_transition: transition,
    p_request_id: id, p_fingerprint: 'timeout:' + expected, p_start: false,
  });
}

// A player quits a running game. Their seat is forfeited; the commit is signed
// by whoever the table is waiting for, because the database checks that seat.
export async function forfeitGame(db: SupabaseClient, room: Room, requester: string, expected: number) {
  const seat = memberIndex(room, requester);
  if (room.status !== 'playing' || !room.state || room.state.players[seat]?.bankrupt) return room;
  requireRevision(room, expected);
  const current = await readGameRoom(db, room.code, expected);
  const state = current.state!;
  const acting = actingSeat(state);
  const game = MarketWars.Game.restore(JSON.stringify(state), { wait: async () => {} });
  try { game.forfeit(seat); } catch (error) { throw new ApiError(409, error instanceof Error ? error.message : 'You cannot leave right now.'); }
  const transition: Transition = { action: 'forfeit', player: state.currentPlayer, dice: [...game.state.dice], path: [], sounds: [] };
  return roomRpc(db, 'mw_commit_game', {
    p_code: room.code, p_actor: current.members[acting].user_id, p_expected: expected, p_state: JSON.parse(game.serialize()),
    p_transition: transition, p_request_id: crypto.randomUUID(), p_fingerprint: 'forfeit:' + requester + ':' + expected, p_start: false,
  });
}
