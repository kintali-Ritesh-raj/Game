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
    if (error) throw error;
    if (data.session) return data.session.user.id;
    const result = await supabase.auth.signInAnonymously();
    if (result.error) throw new Error(result.error.message + ' Enable anonymous sign-ins in Supabase Authentication.');
    if (!result.data.user) throw new Error('Could not establish your player identity.');
    return result.data.user.id;
  })().catch(error => { identity = undefined; throw error; });
  return identity;
}

export async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  await ensureIdentity();
  const supabase = getBrowserClient();
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Your player session expired. Reload to reconnect.');
  const response = await fetch(path, {
    method, cache: 'no-store',
    headers: { Authorization: 'Bearer ' + data.session.access_token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json();
  if (!response.ok) throw new RequestError(response.status, payload.error || 'The request could not be completed.');
  return payload as T;
}
