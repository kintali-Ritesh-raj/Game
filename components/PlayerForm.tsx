'use client';

import { useEffect, useState } from 'react';
import type { Member, Profile, Token } from '@/lib/types';

export const TOKENS: Record<Token, string> = { briefcase: '💼', rocket: '🚀', building: '🏢', car: '🚗', coin: '🪙', crown: '👑', factory: '🏭', laptop: '💻' };
export default function PlayerForm({ initial, members = [], busy, label, onSubmit }: {
  initial?: Profile; members?: Member[]; busy: boolean; label: string; onSubmit: (player: Profile) => Promise<void>;
}) {
  const [player, setPlayer] = useState<Profile>(initial || { name: '', token: 'briefcase' });
  useEffect(() => {
    if (initial) { setPlayer(initial); return; }
    try {
      const saved = JSON.parse(localStorage.getItem('market-wars-profile') || 'null') as Profile | null;
      if (saved) setPlayer({ name: saved.name || '', token: saved.token || 'briefcase' });
    } catch { /* Use the empty player form. */ }
  }, [initial]);
  return <form className="online-player-form" onSubmit={event => { event.preventDefault(); void onSubmit(player); }}>
    <label htmlFor="online-name">Player name</label>
    <input id="online-name" value={player.name} required maxLength={20} autoComplete="nickname" onChange={event => setPlayer({ ...player, name: event.target.value })} />
    <div className="field-row">
      <div><label htmlFor="online-token">Your token</label><select id="online-token" value={player.token} onChange={event => setPlayer({ ...player, token: event.target.value as Token })}>
        {Object.entries(TOKENS).map(([token, emoji]) => <option key={token} value={token} disabled={members.some(member => member.token === token)}>{emoji} {token.charAt(0).toUpperCase() + token.slice(1)}</option>)}
      </select></div>
    </div>
    <p className="setup-role-note">Everyone plays by the same classic rules. Collect a full color set to start building.</p>
    <button className="primary full" type="submit" disabled={busy}>{busy ? 'Connecting…' : label}</button>
  </form>;
}
