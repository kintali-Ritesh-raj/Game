import MarketWars from './game-engine.cjs';
import { ACTIONS, type Command, type Profile, type TradeOffer } from './types';

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
  if (!['black', 'blue', 'magenta', 'lime', 'orange', 'cyan'].includes(String(value.token))) throw new ApiError(400, 'Choose a player color.');
  // Only the Host's choice of board is used; anyone else's is ignored when the game starts.
  const sides = Number(value.sides);
  return { name: value.name.trim(), token: value.token, ...([4, 5].includes(sides) ? { sides } : {}), // mode is always sent (null when off): the room merges profiles, so an omitted key would keep an old 'buffed'.
    mode: value.mode === 'buffed' && sides !== 5 ? 'buffed' : null } as unknown as Profile;
}
export function requestId(value: unknown) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new ApiError(400, 'Invalid request identifier.');
  return value;
}
export function revision(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new ApiError(400, 'Invalid room revision.');
  return value;
}
// Space ids run 0-49 on the largest (pentagon) board; the engine checks each id against the game's own board and owner.
const MAX_SPACE = 49;
export function command(value: Record<string, unknown>): Command {
  if (!ACTIONS.includes(value.action as Command['action'])) throw new ApiError(400, 'Unknown game action.');
  if (['build', 'sell', 'mortgage', 'unmortgage', 'auction', 'free-build'].includes(String(value.action)) && (!Number.isInteger(value.id) || Number(value.id) < 0 || Number(value.id) > MAX_SPACE)) throw new ApiError(400, 'Invalid property.');
  if (value.action === 'bid' && (!Number.isSafeInteger(value.increment) || Number(value.increment) < 10)) throw new ApiError(400, 'The bid increment must be a whole amount of at least $10.');
  if (value.action === 'trade') return { action: 'trade', trade: tradeOffer(value.trade) };
  return { action: value.action, id: value.id, increment: value.increment } as Command;
}
function tradeOffer(value: unknown): TradeOffer {
  const offer = value as Record<string, unknown> | null;
  const side = (raw: unknown) => {
    const item = raw as Record<string, unknown> | null;
    if (!item || typeof item !== 'object' || !Number.isSafeInteger(item.cash) || Number(item.cash) < 0 || Number(item.cash) > 10_000_000
      || !Array.isArray(item.properties) || item.properties.length > 34 || item.properties.some(id => !Number.isInteger(id) || id < 0 || id > MAX_SPACE)) throw new ApiError(400, 'Invalid trade offer.');
    return { cash: Number(item.cash), properties: [...item.properties] as number[] };
  };
  if (!offer || typeof offer !== 'object' || !Number.isInteger(offer.to) || Number(offer.to) < 0 || Number(offer.to) >= MarketWars.MAX_PLAYERS) throw new ApiError(400, 'Invalid trade offer.');
  return { to: Number(offer.to), give: side(offer.give), get: side(offer.get) };
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
