'use client';

import { useEffect, useState } from 'react';
import type { Member, Profile, Token } from '@/lib/types';

// Each player's marker is one of four high-contrast colours; it also colours their pawn, shields and houses.
export const TOKENS: Record<Token, { label: string; color: string }> = {
  black: { label: 'Black', color: '#17171c' },
  blue: { label: 'Royal blue', color: '#1e40e6' },
  magenta: { label: 'Magenta', color: '#e3008c' },
  lime: { label: 'Lime', color: '#7ed321' },
};
const isToken = (value: unknown): value is Token => typeof value === 'string' && value in TOKENS;
export function TokenDot({ token }: { token: string }) {
  return <span className="token-dot" style={{ '--token-color': isToken(token) ? TOKENS[token].color : '#8a8f8c' } as React.CSSProperties} aria-hidden="true" />;
}

export default function PlayerForm({ initial, members = [], busy, label, onSubmit }: {
  initial?: Profile; members?: Member[]; busy: boolean; label: string; onSubmit: (player: Profile) => Promise<void>;
}) {
  const taken = (token: Token) => members.some(member => member.token === token);
  const firstFree = (preferred?: unknown) => isToken(preferred) && !taken(preferred) ? preferred : (Object.keys(TOKENS) as Token[]).find(token => !taken(token)) || 'black';
  const [player, setPlayer] = useState<Profile>(initial ? { ...initial, token: firstFree(initial.token) } : { name: '', token: firstFree() });
  useEffect(() => {
    if (initial) { setPlayer({ ...initial, token: firstFree(initial.token) }); return; }
    try {
      const saved = JSON.parse(localStorage.getItem('market-wars-profile') || 'null') as Profile | null;
      if (saved) setPlayer({ name: saved.name || '', token: firstFree(saved.token) });
    } catch { /* Use the empty player form. */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);
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
    <p className="setup-role-note">Everyone plays by the same classic rules. Own 2 properties of a color to start building.</p>
    <button className="primary full" type="submit" disabled={busy}>{busy ? 'Connecting…' : label}</button>
  </form>;
}
