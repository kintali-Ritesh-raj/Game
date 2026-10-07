import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { memberIndex, requireRevision } from './game-actions';
import { ApiError } from './validation';
import type { Member, Role, Room, Token } from './types';

function hostLobby(room:Room, actor:string, expected:number) {
  memberIndex(room,actor);
  if (room.host_id !== actor) throw new ApiError(403,'Only the Host can manage bots.');
  if (room.status !== 'lobby') throw new ApiError(409,'Bots can only be changed before the game starts.');
  requireRevision(room,expected);
}
export function addBotMembers(room:Room, actor:string, expected:number, role:unknown):Member[] {
  hostLobby(room,actor,expected);
  if (!['monopolist','competitor'].includes(String(role))) throw new ApiError(400,'Choose a role for the bot.');
  if (room.members.length >= 4) throw new ApiError(409,'This room is full. Bots count toward the 4-player limit.');
  const name = ['Bot Ada','Bot Atlas','Bot Nova','Bot Quinn','Bot Echo'].find(name => !room.members.some(m => m.name.toLowerCase() === name.toLowerCase()))!;
  const token = (['laptop','factory','car','crown','coin','building','rocket','briefcase'] as Token[]).find(token => !room.members.some(m => m.token === token))!;
  // This identifier is a game seat, never a Supabase Auth account or credential.
  return [...room.members,{name,role:role as Role,token,user_id:randomUUID(),seat:room.members.length,type:'bot'}];
}
export function removeBotMembers(room:Room, actor:string, expected:number, target:unknown):Member[] {
  hostLobby(room,actor,expected);
  const member = room.members.find(m => m.user_id === target);
  if (!member || member.type !== 'bot') throw new ApiError(400,'Choose a bot to remove. Human players keep their seats.');
  return room.members.filter(m => m.user_id !== target).map((m,seat) => ({...m,seat}));
}
export function membersAfterLeaving(room:Room, actor:string) {
  memberIndex(room,actor);
  let members = room.members.filter(m => m.user_id !== actor);
  const host = members.find(m => m.user_id === room.host_id && m.type !== 'bot') || members.find(m => m.type !== 'bot');
  if (!host) members = []; // A lobby with no human players cannot be hosted by a bot.
  return {members:members.map((m,seat) => ({...m,seat})),host_id:host?.user_id || room.host_id,status:host ? 'lobby' as const : 'closed' as const};
}
export async function saveLobbyMembers(db:SupabaseClient, room:Room, members:Member[], hostId=room.host_id, status:Room['status']='lobby') {
  // One conditional UPDATE competes safely with joins, starts, host transfer and
  // other tabs. PostgreSQL rechecks revision after obtaining the row lock.
  const {data,error} = await db.from('mw_rooms').update({members,member_ids:members.map(m=>m.user_id),host_id:hostId,status,revision:room.revision+1,updated_at:new Date().toISOString()})
    .eq('code',room.code).eq('revision',room.revision).eq('host_id',room.host_id).eq('status','lobby').select('*').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(409,'The lobby changed. It has been synchronized; try again.');
  return data as Room;
}
