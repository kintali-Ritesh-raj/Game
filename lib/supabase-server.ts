import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from './validation';

// One client per server instance, so warm requests reuse its connection and the cached signing keys.
let client: SupabaseClient | undefined;
export function getServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new ApiError(503, 'Online play is not configured. Set the Supabase environment variables on the server.');
  return client ??= createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function authenticate(request: Request) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) throw new ApiError(401, 'A player session is required.');
  const db = getServerClient();
  // getClaims checks the token's signature and expiry locally with the project's signing keys (no Auth round trip);
  // with a shared-secret project it falls back to asking the Auth server, as getUser did.
  const { data, error } = await db.auth.getClaims(authorization.slice(7));
  const actor = data?.claims?.sub;
  if (error || typeof actor !== 'string' || !actor) throw new ApiError(401, 'Your player session expired. Reconnect and try again.');
  return { db, actor };
}
