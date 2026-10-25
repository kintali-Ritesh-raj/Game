'use client';

import { useEffect, useState } from 'react';
import type { BoardSides, Member, Profile, Token } from '@/lib/types';

// Each player's marker is one of four high-contrast colours; it also colours their pawn, shields and houses.
export const TOKENS: Record<Token, { label: string; color: string }> = {
  black: { label: 'Black', color: '#17171c' },
  blue: { label: 'Royal blue', color: '#1e40e6' },
  magenta: { label: 'Magenta', color: '#e3008c' },
  lime: { label: 'Lime', color: '#7ed321' },
  orange: { label: 'Orange', color: '#ff6a00' },
  cyan: { label: 'Cyan', color: '#00d5ff' },
};
const isToken = (value: unknown): value is Token => typeof value === 'string' && value in TOKENS;
// The boards. Skyline adds a side (a corner, two colour groups, a station and two card or tax spaces);
// Classic Super Buffed is the square board with big money, build-to-tower and a flat $500 jail fine.
export type BoardId = 'classic' | 'skyline' | 'buffed';
export const BOARD_CHOICES: { id: BoardId; sides: BoardSides; mode?: 'buffed'; name: string; detail: string; start: string }[] = [
  { id: 'classic', sides: 4, name: 'Classic', detail: 'Square · 40 spaces', start: '$1,500' },
  { id: 'skyline', sides: 5, name: 'Skyline', detail: 'Pentagon · 50 spaces', start: '$1,575' },
  { id: 'buffed', sides: 4, mode: 'buffed', name: 'Classic Super Buffed', detail: '$5k start · $3k Launch · build to tower', start: '$5,000' },
];
export const boardOf = (profile?: { sides?: BoardSides; mode?: string }): BoardId => profile?.sides === 5 ? 'skyline' : profile?.mode === 'buffed' ? 'buffed' : 'classic';
export const boardProfile = (id: BoardId) => { const choice = BOARD_CHOICES.find(item => item.id === id)!; return { sides: choice.sides, ...(choice.mode ? { mode: choice.mode } : {}) }; };
export function BoardIcon({ sides }: { sides: BoardSides }) {
  const points = Array.from({ length: sides }, (_, k) => { const a = (90 - 180 / sides + k * 360 / sides) * Math.PI / 180; return (12 + 10 * Math.cos(a)).toFixed(2) + ',' + (12 + 10 * Math.sin(a)).toFixed(2); }).join(' ');
  return <svg className="board-icon" viewBox="0 0 24 24" aria-hidden="true"><polygon points={points} /></svg>;
}
export function BoardPicker({ value, onChange, disabled }: { value: BoardId; onChange: (board: BoardId) => void; disabled?: boolean }) {
  return <fieldset className="board-picker" id="online-board">
    <legend>Board size</legend>
    {BOARD_CHOICES.map(choice => <label key={choice.id} className={'board-option' + (value === choice.id ? ' selected' : '')}>
      <input type="radio" name="online-board" value={choice.id} checked={value === choice.id} disabled={disabled} onChange={() => onChange(choice.id)} />
      <BoardIcon sides={choice.sides} /><span><b>{choice.name}</b>{choice.detail}</span>
    </label>)}
  </fieldset>;
}
export function TokenDot({ token }: { token: string }) {
  return <span className="token-dot" style={{ '--token-color': isToken(token) ? TOKENS[token].color : '#8a8f8c' } as React.CSSProperties} aria-hidden="true" />;
}

// `taken` lists colours already chosen by other players; they are shown as blocked. `boardChoice` adds the Host's board picker.
export default function PlayerForm({ initial, members = [], taken: takenTokens = [], boardChoice = false, busy, label, onSubmit }: {
  initial?: Profile; members?: Member[]; taken?: Token[]; boardChoice?: boolean; busy: boolean; label: string; onSubmit: (player: Profile) => Promise<void>;
}) {
  const taken = (token: Token) => takenTokens.includes(token) || members.some(member => member.token === token);
  const firstFree = (preferred?: unknown) => isToken(preferred) && !taken(preferred) ? preferred : (Object.keys(TOKENS) as Token[]).find(token => !taken(token)) || 'black';
  const [player, setPlayer] = useState<Profile>(initial ? { ...initial, token: firstFree(initial.token) } : { name: '', token: firstFree() });
  useEffect(() => {
    if (initial) { setPlayer({ ...initial, token: firstFree(initial.token) }); return; }
    try {
      const saved = JSON.parse(localStorage.getItem('market-wars-profile') || 'null') as Profile | null;
      // The last board size the Host chose is remembered with their name and colour.
      if (saved) setPlayer({ name: saved.name || '', token: firstFree(saved.token), ...(saved.sides === 5 ? { sides: 5 as const } : {}), ...(saved.mode === 'buffed' && saved.sides !== 5 ? { mode: 'buffed' as const } : {}) });
    } catch { /* Use the empty player form. */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);
  // Someone else took this colour while the form was open: move to the first free one.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (taken(player.token)) setPlayer(current => ({ ...current, token: firstFree(current.token) })); }, [takenTokens.join(), members.map(member => member.token).join()]);
  const free = (Object.keys(TOKENS) as Token[]).filter(token => !taken(token));
  return <form className="online-player-form" onSubmit={event => { event.preventDefault(); void onSubmit(player); }}>
    <label htmlFor="online-name">Player name</label>
    <input id="online-name" value={player.name} required maxLength={20} autoComplete="nickname" onChange={event => setPlayer({ ...player, name: event.target.value })} />
    <fieldset className="token-picker" id="online-token">
      <legend>Your color</legend>
      {(Object.keys(TOKENS) as Token[]).map(token => <label key={token} className={'token-option' + (player.token === token ? ' selected' : '') + (taken(token) ? ' taken' : '')}>
        <input type="radio" name="online-token" value={token} checked={player.token === token} disabled={taken(token)} onChange={() => setPlayer({ ...player, token })} />
        <TokenDot token={token} /><span>{TOKENS[token].label}{taken(token) ? ' · taken' : ''}</span>
      </label>)}
    </fieldset>
    {free.length < Object.keys(TOKENS).length && <p className="setup-role-note" role="status">{free.length === 1 ? 'Only ' + TOKENS[free[0]].label.toLowerCase() + ' is left.' : free.length ? free.length + ' colors are still free.' : 'Every color is taken: this room is full.'}</p>}
    {boardChoice && <BoardPicker value={boardOf(player)} onChange={board => setPlayer({ name: player.name, token: player.token, ...boardProfile(board) })} />}
    <p className="setup-role-note">Everyone plays by the same rules. Build on your own property each time you land on it.</p>
    <button className="primary full" type="submit" disabled={busy || !free.length}>{busy ? 'Connecting…' : label}</button>
  </form>;
}
