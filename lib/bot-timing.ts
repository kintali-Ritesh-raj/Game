import type { GameState, Room } from './types';

// The seat whose input the table is waiting for: a debtor, an auction bidder, a trade recipient, or the current player.
export function actingSeat(state: GameState): number {
  return state.pending?.payer ?? state.auction?.bidder ?? state.trade?.to ?? state.currentPlayer;
}

export function botSeat(room: Room): number | null {
  if (room.status !== 'playing' || !room.state) return null;
  const seat = actingSeat(room.state);
  return room.members[seat]?.type === 'bot' && !room.state.players[seat]?.bankrupt ? seat : null;
}

// Leave time for every client to replay the preceding accepted move.
export function botReadyAt(room: Room) {
  const transition = room.transition;
  const animation = (transition?.action === 'roll' ? 950 : 0) + (transition?.action === 'spin' ? 4500 : 0) + (transition?.path.length || 0) * 150;
  return Date.parse(room.updated_at) + animation + (room.state?.phase === 'event' ? 4000 : 1100);
}

export const TURN_SECONDS = 90;

// The human whose input the table is waiting for, if their turn timer applies.
export function idleSeat(room: Room): number | null {
  if (room.status !== 'playing' || !room.state || ['rolling', 'moving', 'victory'].includes(room.state.phase)) return null;
  const seat = actingSeat(room.state);
  return room.members[seat] && room.members[seat].type !== 'bot' && !room.state.players[seat]?.bankrupt ? seat : null;
}

// 90 seconds of inactivity, counted after every client finishes replaying the last move.
export function turnDeadline(room: Room) {
  return botReadyAt(room) + TURN_SECONDS * 1000;
}
