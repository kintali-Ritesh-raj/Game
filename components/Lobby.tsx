'use client';

import { useEffect, useState } from 'react';
import PlayerForm, { BOARD_CHOICES, BoardIcon, BoardPicker, TOKENS, TokenDot, boardOf, boardProfile } from './PlayerForm';
// Up to six players per table, bots included.
const MAX_SEATS = 6;
import type { Connection, Profile, Room, Token } from '@/lib/types';

export default function Lobby({ room, userId, connections, busy, connected, start, leave, updateProfile, addBot, removeBot }: {
  room: Room; userId: string; connections: Connection[]; busy: boolean; connected: boolean;
  start: () => Promise<void>; leave: () => Promise<void>; updateProfile: (player: Profile) => Promise<void>;
  addBot: () => Promise<void>; removeBot: (id:string) => Promise<void>;
}) {
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState('');
  const [editing, setEditing] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { setLink(location.origin + '/game/' + room.code); }, [room.code]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer); }, []);
  const host = room.members.find(member => member.user_id === room.host_id);
  const mine = room.members.find(member => member.user_id === userId);
  const canStart = room.members.length >= 2;
  const boardId = boardOf(host), board = BOARD_CHOICES.find(choice => choice.id === boardId)!;
  const copy = async (value: string, kind: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(kind + ' copied.'); }
    catch { setCopied('Select the ' + kind.toLowerCase() + ' below and copy it manually.'); }
  };
  return <main className="online-lobby">
    <div className="setup-intro"><div className="eyebrow">BEFORE THE FIRST MOVE</div><h1>Meet your rivals.</h1><p>Invite friends or add bots to your table. Play solo against bots, or mix human and bot rivals.</p></div>
    <section className="room-invite" aria-label="Room invitation">
      <div><label htmlFor="room-code-display">Room Code</label><div className="copy-field"><input id="room-code-display" readOnly value={room.code} /><button className="secondary" onClick={() => void copy(room.code, 'Code')}>Copy Code</button></div></div>
      <div><label htmlFor="room-link-display">Share Link</label><div className="copy-field"><input id="room-link-display" readOnly value={link} /><button className="secondary" onClick={() => void copy(link, 'Link')}>Copy Link</button></div></div>
      <p role="status" className="copy-status">{copied || 'Friends can open this link or enter the room code.'}</p>
    </section>
    <div className="lobby-topline"><span>HOST <b>{host?.name}</b></span><span>{room.members.length} / {MAX_SEATS} PLAYERS</span></div>
    <div className="lobby-colors" aria-label="Player colors">
      {(Object.keys(TOKENS) as Token[]).map(token => { const owner = room.members.find(member => member.token === token);
        return <span key={token} className={'lobby-color' + (owner ? ' taken' : '')}><TokenDot token={token} />{TOKENS[token].label}<b>{owner ? owner.name : 'Free'}</b></span>; })}
    </div>
    <div className="lobby-board">
      {room.host_id === userId && mine
        ? <BoardPicker value={boardId} disabled={busy || !connected} onChange={next => { if (next !== boardId) void updateProfile({ name: mine.name, token: mine.token, ...boardProfile(next) }).catch(() => {}); }} />
        : <p className="lobby-board-choice"><BoardIcon sides={board.sides} /><span>Board: <b>{board.name}</b> · {board.detail}</span></p>}
    </div>
    <ul className="lobby-players" aria-label="Lobby players">
      {room.members.map(member => {
        const online = connections.some(c => c.user_id === member.user_id && c.connected && now - Date.parse(c.seen_at) < 45000);
        return <li key={member.user_id} className="lobby-player">
          <span className="lobby-token" aria-label={(TOKENS[member.token]?.label || 'Player') + ' marker'}><TokenDot token={member.token} /></span>
          <div><strong>{member.name}{member.user_id === userId ? ' · You' : ''}</strong><span>{member.type === 'bot' ? 'Bot' : member.user_id === room.host_id ? 'Host' : 'Player'}</span></div>
          <div className="lobby-seat-status"><span className={'connection-badge ' + (online || member.type === 'bot' ? 'is-connected' : '')}>{member.type === 'bot' ? 'Bot · Ready' : online ? 'Connected' : 'Disconnected'}</span>
            {member.type === 'bot' && room.host_id === userId && <button className="text-button" aria-label={'Remove ' + member.name} disabled={busy || !connected} onClick={() => void removeBot(member.user_id)}>Remove</button>}
          </div>
        </li>;
      })}
      {Array.from({ length: MAX_SEATS - room.members.length }, (_, i) => <li key={'empty-' + i} className="lobby-player empty-seat"><span className="lobby-token">+</span><span>Waiting for a rival…</span></li>)}
    </ul>
    {room.host_id === userId && <div className="lobby-bot-controls">
      <button className="secondary" onClick={() => void addBot()} disabled={busy || !connected || room.members.length >= MAX_SEATS}>Add bot +</button>
      <p>{room.members.length >= MAX_SEATS ? 'Table full. Remove a bot to free a seat.' : 'Bots buy, build and bid automatically. Up to six players, including bots.'}</p>
    </div>}
    <div className="lobby-choices"><button className="secondary" onClick={() => setEditing(!editing)} disabled={busy}>{editing ? 'Close choices' : 'Edit my name & color'}</button></div>
    {editing && mine && <PlayerForm initial={mine} members={room.members.filter(m => m.user_id !== userId)} busy={busy} label="Save my choices" onSubmit={async player => { await updateProfile({ ...player, ...(room.host_id === userId ? boardProfile(boardId) : {}) }); setEditing(false); }} />}
    <p className="lobby-note">Everyone starts with {board.start} and plays by the same rules. At least 2 players are needed. A disconnected player keeps their seat and can reconnect using this link.</p>
    <div className="setup-footer"><button className="secondary" onClick={() => void leave()} disabled={busy}>Leave lobby</button>
      {room.host_id === userId
        ? <button className="primary large" onClick={() => void start().catch(() => {})} disabled={busy || !connected || !canStart}>Start Game <span aria-hidden="true">↗</span></button>
        : <p role="status">Waiting for {host?.name}, the Host, to start the game.</p>}
    </div>
  </main>;
}
