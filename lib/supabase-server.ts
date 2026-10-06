import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { ApiError } from './validation';

export function getServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new ApiError(503, 'Online play is not configured. Set the Supabase environment variables on the server.');
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function authenticate(request: Request) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) throw new ApiError(401, 'A player session is required.');
  const db = getServerClient();
  const { data, error } = await db.auth.getUser(authorization.slice(7));
  if (error || !data.user) throw new ApiError(401, 'Your player session expired. Reconnect and try again.');
  return { db, actor: data.user.id };
}
