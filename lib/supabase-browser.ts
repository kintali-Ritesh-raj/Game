import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/utils/supabase/client';

let client: SupabaseClient | undefined;
export class RequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function getBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Online play needs Supabase configuration. Follow the deployment steps in README.md.');
  client ??= createClient();
  return client;
}

let identity: Promise<string> | undefined;
export function ensureIdentity(): Promise<string> {
  if (!identity) identity = (async () => {
    const supabase = getBrowserClient();
    const { data, error } = await supabase.auth.getSession();
    if (data.session && !error) return data.session.user.id;
    // A saved session that can no longer be used (expired, or its anonymous account was cleaned up): drop it here and
    // sign in afresh, instead of failing.
    if (error) await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    const result = await supabase.auth.signInAnonymously();
    if (result.error) throw new Error(result.error.message + ' Enable anonymous sign-ins in Supabase Authentication.');
    if (!result.data.user) throw new Error('Could not establish your player identity.');
    return result.data.user.id;
  })().catch(error => { identity = undefined; throw error; });
  return identity;
}

// `retried` marks the one automatic resend after the server rejected an expired session.
export async function request<T>(path: string, method = 'GET', body?: unknown, retried = false): Promise<T> {
  await ensureIdentity();
  const supabase = getBrowserClient();
  let { data } = await supabase.auth.getSession();
  // Background tabs can miss the automatic token refresh; renew a token that is about to expire before using it.
  if (data.session?.expires_at && data.session.expires_at * 1000 - Date.now() < 60_000) {
    const renewed = await supabase.auth.refreshSession();
    if (renewed.data.session) data = { session: renewed.data.session };
  }
  if (!data.session) {
    // The session could not be renewed: start a fresh identity once rather than asking for a reload.
    identity = undefined;
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    await ensureIdentity();
    data = (await supabase.auth.getSession()).data;
  }
  if (!data.session) throw new Error('Your player session expired. Reload to reconnect.');
  let response: Response;
  try {
    response = await fetch(path, {
      method, cache: 'no-store',
      headers: { Authorization: 'Bearer ' + data.session.access_token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
  } catch (caught) {
    if (caught instanceof DOMException && (caught.name === 'TimeoutError' || caught.name === 'AbortError')) throw new Error('The game server took too long to answer. Your game is saved; try again.');
    if (caught instanceof TypeError) throw new Error('Could not reach the game server. Check your connection; your game is saved.');
    throw caught;
  }
  // The server rejected an expired session: renew it and send the same request once more (it is safe to resend).
  if (response.status === 401 && !retried) {
    const renewed = await supabase.auth.refreshSession();
    if (renewed.data.session) return request<T>(path, method, body, true);
  }
  let payload: { error?: string };
  // A reply that is not JSON (a hosting error page) is treated as a temporary server problem, so it is retried.
  try { payload = await response.json(); } catch { throw new RequestError(response.ok ? 502 : Math.max(500, response.status), 'The game server is busy. Your game is saved; trying again.'); }
  if (!response.ok) throw new RequestError(response.status, payload.error || 'The request could not be completed.');
  return payload as T;
}
