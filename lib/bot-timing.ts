import type { Room } from './types';

export function botSeat(room: Room): number | null {
  if (room.status !== 'playing' || !room.state) return null;
  const seat = room.state.pending?.payer ?? room.state.auction?.bidder ?? room.state.currentPlayer;
  return room.members[seat]?.type === 'bot' && !room.state.players[seat]?.bankrupt ? seat : null;
}

// Leave time for every client to replay the preceding accepted move.
export function botReadyAt(room: Room) {
  const transition = room.transition;
  const animation = (transition?.action === 'roll' ? 950 : 0) + (transition?.path.length || 0) * 150;
  return Date.parse(room.updated_at) + animation + (room.state?.phase === 'event' ? 4000 : 1100);
}
