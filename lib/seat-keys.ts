import { randomInt } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { memberIndex } from './game-actions';
import { roomRpc } from './room-store';
import { ApiError } from './validation';
import type { Room } from './types';

// No 0/O or 1/I/L, so codes survive being read aloud or copied by hand.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 8 }, (_, i) => (i === 4 ? '-' : '') + ALPHABET[randomInt(ALPHABET.length)]).join('');

/** The caller's private rejoin code for this room, created on first request. */
export async function seatKey(db: SupabaseClient, room: Room, actor: string) {
  const seat = memberIndex(room, actor);
  if (room.members[seat].type === 'bot') throw new ApiError(403, 'Bots do not have rejoin codes.');
  const { data, error } = await db.from('mw_seat_keys').select('rejoin_code').eq('code', room.code).eq('user_id', actor).maybeSingle();
  if (error) throw error;
  if (data) return data.rejoin_code as string;
  for (let attempt = 0; attempt < 5; attempt++) {
    const rejoin_code = newCode();
    const { error: insertError } = await db.from('mw_seat_keys').insert({ code: room.code, user_id: actor, rejoin_code });
    if (!insertError) return rejoin_code;
    if (insertError.code !== '23505') throw insertError;
    // A concurrent request may have created this player's code first.
    const { data: existing } = await db.from('mw_seat_keys').select('rejoin_code').eq('code', room.code).eq('user_id', actor).maybeSingle();
    if (existing) return existing.rejoin_code as string;
  }
  throw new ApiError(503, 'Could not create a rejoin code. Try again.');
}

export function reclaimSeat(db: SupabaseClient, code: string, actor: string, rejoin: unknown) {
  if (typeof rejoin !== 'string' || !/^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/.test(rejoin.trim())) throw new ApiError(400, 'Enter the 8-character rejoin code, like ABCD-2345.');
  const normalized = rejoin.trim().toUpperCase().replace(/^(.{4})-?(.{4})$/, '$1-$2');
  return roomRpc(db, 'mw_reclaim_seat', { p_code: code, p_actor: actor, p_rejoin: normalized });
}
