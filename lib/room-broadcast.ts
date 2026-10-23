import 'server-only';
import type { Room } from './types';

// Pushes a saved room to every player on Supabase Broadcast, the fast channel. Database change events still arrive
// as a backup, and clients ignore anything older than what they already show (by revision).
export async function broadcastRoom(room: Room | null | undefined) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret || !room?.code) return;
  try {
    await fetch(url + '/realtime/v1/api/broadcast', {
      method: 'POST', headers: { apikey: secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ topic: 'mw-room-' + room.code, event: 'room', payload: { room }, private: false }] }),
      signal: AbortSignal.timeout(3000),
    });
  } catch { /* the database change event still reaches every player */ }
}
