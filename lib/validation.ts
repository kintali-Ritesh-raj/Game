import { ACTIONS, type Command, type Profile } from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function roomCode(value: string) {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new ApiError(400, 'Enter the six-character room code.');
  return code;
}
export function profile(value: Record<string, unknown>): Profile {
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 20) throw new ApiError(400, 'Choose a name of 1–20 characters.');
  if (!['monopolist', 'competitor'].includes(String(value.role))) throw new ApiError(400, 'Choose an economic role.');
  if (!['briefcase', 'rocket', 'building', 'car', 'coin', 'crown', 'factory', 'laptop'].includes(String(value.token))) throw new ApiError(400, 'Choose a valid token.');
  return { name: value.name.trim(), role: value.role, token: value.token } as Profile;
}
export function requestId(value: unknown) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new ApiError(400, 'Invalid request identifier.');
  return value;
}
export function revision(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new ApiError(400, 'Invalid room revision.');
  return value;
}
export function command(value: Record<string, unknown>): Command {
  if (!ACTIONS.includes(value.action as Command['action'])) throw new ApiError(400, 'Unknown game action.');
  if (['build', 'sell', 'mortgage', 'unmortgage'].includes(String(value.action)) && (!Number.isInteger(value.id) || Number(value.id) < 0 || Number(value.id) > 39)) throw new ApiError(400, 'Invalid property.');
  if (value.action === 'bid' && (!Number.isSafeInteger(value.increment) || Number(value.increment) < 10)) throw new ApiError(400, 'The bid increment must be a whole amount of at least $10.');
  return { action: value.action, id: value.id, increment: value.increment } as Command;
}
export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.length > 4096) throw new ApiError(413, 'Request is too large.');
  try {
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
    return value;
  } catch { throw new ApiError(400, 'Invalid request body.'); }
}
export function apiResponse(error: unknown) {
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
  console.error('Multiplayer request failed:', error instanceof Error ? error.message : 'Database request failed');
  return Response.json({ error: 'The online service is unavailable. Check the connection and try again.' }, { status: 503 });
}
