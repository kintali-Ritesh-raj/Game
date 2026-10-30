import 'server-only';
import type { Room } from './types';

// Pushes a saved room to every player on Supabase Broadcast, the only live feed of moves. A failed push is retried
// once; a player who still misses one notices the gap in revisions (or the safety-net poll) and fetches the room.
export async function broadcastRoom(room: Room | null | undefined) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret || !room?.code) return;
  const body = JSON.stringify({ messages: [{ topic: 'mw-room-' + room.code, event: 'room', payload: { room }, private: false }] });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url + '/realtime/v1/api/broadcast', { method: 'POST', headers: { apikey: secret, 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(3000) });
      if (response.ok) return;
    } catch { /* retried once below */ }
  }
}
