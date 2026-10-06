import { randomInt } from 'node:crypto';
import { authenticate } from '@/lib/supabase-server';
import { apiResponse, jsonBody, profile, requestId } from '@/lib/validation';
import { roomRpc } from '@/lib/room-store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const { db, actor } = await authenticate(request);
    const body = await jsonBody(request), player = profile(body), id = requestId(body.request_id);
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');
      try {
        const room = await roomRpc(db, 'mw_create_room', { p_code: code, p_actor: actor, p_profile: player, p_request_id: id });
        return Response.json({ room }, { status: 201 });
      } catch (error) { if ((error as { code?: string }).code !== '23505') throw error; }
    }
    throw new Error('Could not allocate a room code.');
  } catch (error) { return apiResponse(error); }
}
