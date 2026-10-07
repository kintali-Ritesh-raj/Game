'use client';

import { useEffect, useRef, useState } from 'react';
import { gameMarkup } from '@/lib/game-markup';
import { initializeUI } from '@/lib/game-ui';
import { useMultiplayer } from './useMultiplayer';
import Lobby from './Lobby';
import PlayerForm from './PlayerForm';

export default function GameClient({ initialCode }: { initialCode?: string }) {
  const multiplayer = useMultiplayer(initialCode);
  const current = useRef(multiplayer);
  current.current = multiplayer;
  const ui = useRef<ReturnType<typeof initializeUI> | null>(null);
  const [joinCode, setJoinCode] = useState(initialCode || '');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    ui.current = initializeUI({
      navigate: (action: string) => current.current.navigate(action),
      userId: () => current.current.userId,
      connected: () => current.current.connection === 'connected' && !current.current.pending,
      command: (command: Parameters<typeof multiplayer.command>[0]) => current.current.command(command),
    });
    setReady(true);
    return () => { ui.current?.destroy(); ui.current = null; };
  }, []);
  useEffect(() => {
    if (!ready) return;
    if (multiplayer.screen === 'home') ui.current?.showHome();
    else if (multiplayer.screen === 'room' && multiplayer.room) void ui.current?.renderRoom(multiplayer.room);
    else ui.current?.showLobby();
  }, [ready, multiplayer.screen, multiplayer.room]);
  useEffect(() => { ui.current?.setConnection(); }, [multiplayer.connection, multiplayer.pending, multiplayer.busy]);
  useEffect(() => { if (multiplayer.code) setJoinCode(multiplayer.code); }, [multiplayer.code]);

  const inRoom = multiplayer.screen === 'room' && multiplayer.room;
  const showForm = multiplayer.screen === 'create' || multiplayer.screen === 'join';
  return <>
    <div dangerouslySetInnerHTML={{ __html: gameMarkup }} />
    {multiplayer.screen !== 'home' && <div className="online-notices" aria-live="polite">
      {inRoom && <p className={'network-status ' + (multiplayer.connection === 'connected' ? 'is-connected' : '')}>
        Room {multiplayer.code} · {multiplayer.connection === 'connected' ? 'Connected · Saved online' : 'Reconnecting… Your seat and game are saved.'}
      </p>}
      {multiplayer.error && <p className="form-error" role="alert">{multiplayer.error}</p>}
      {multiplayer.pending && <div className="pending-action"><span>An action is awaiting confirmation.</span>
        <button className="secondary" disabled={multiplayer.busy} onClick={() => void multiplayer.retry().catch(() => {})}>Retry confirmation</button>
        <button className="text-button" disabled={multiplayer.busy} onClick={multiplayer.dismissPending}>Dismiss & use latest state</button>
      </div>}
    </div>}
    {multiplayer.loading && multiplayer.screen === 'room' && <main className="online-entry" aria-busy="true"><div className="eyebrow">NORTHSTAR CITY</div><h1>Opening your room…</h1><p>Your player identity and saved market are being restored.</p></main>}
    {showForm && <main className="online-entry">
      <div className="eyebrow">{multiplayer.screen === 'create' ? 'OPEN AN ONLINE TABLE' : 'YOUR RIVALS ARE WAITING'}</div>
      <h1>{multiplayer.screen === 'create' ? 'Create Game' : 'Join Game'}</h1>
      <p>{multiplayer.screen === 'create' ? 'Become the Host and invite friends with a room code or link.' : 'Choose your player name and enter the lobby.'}</p>
      {multiplayer.screen === 'join' && <div className="join-code-field"><label htmlFor="join-room-code">Room code</label><input id="join-room-code" maxLength={6} value={joinCode} autoComplete="off" autoCapitalize="characters" onChange={event => setJoinCode(event.target.value.toUpperCase())} /></div>}
      <PlayerForm busy={multiplayer.busy} label={multiplayer.screen === 'create' ? 'Create Game' : 'Join lobby'} onSubmit={player => multiplayer.joinOrCreate(player, multiplayer.screen === 'join' ? joinCode || ' ' : undefined)} />
      <button className="text-button" onClick={() => multiplayer.navigate('menu')}>Back to menu</button>
    </main>}
    {inRoom && multiplayer.room?.status === 'lobby' && <Lobby
      room={multiplayer.room} userId={multiplayer.userId} connections={multiplayer.connections}
      busy={multiplayer.busy || Boolean(multiplayer.pending)} connected={multiplayer.connection === 'connected'}
      start={multiplayer.start} leave={multiplayer.leave} updateProfile={multiplayer.updateProfile}
      addBot={multiplayer.addBot} removeBot={multiplayer.removeBot}
    />}
    <noscript><p className="noscript">Enable JavaScript to play MARKET WARS online.</p></noscript>
  </>;
}
