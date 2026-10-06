import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from './validation';
import type { Room } from './types';

export async function readRoom(db: SupabaseClient, code: string, actor: string) {
  const { data, error } = await db.from('mw_rooms').select('*').eq('code', code).single();
  if (error && error.code !== 'PGRST116') throw error;
  if (error?.code === 'PGRST116' || !data || data.status === 'closed') throw new ApiError(404, 'Room not found. Check the code with the Host.');
  const room = data as Room;
  if (!room.member_ids.includes(actor)) throw new ApiError(403, 'Join this room to access the lobby.');
  return room;
}
export async function roomRpc(db: SupabaseClient, name: string, params: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, params);
  if (error) {
    if (error.code === 'P0001') {
      const message = error.message;
      throw new ApiError(/not found/.test(message) ? 404 : /Only|not a player|identifier/.test(message) ? 403 : 409, message);
    }
    throw error;
  }
  return data as Room;
}
