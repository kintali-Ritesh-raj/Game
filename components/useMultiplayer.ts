'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ensureIdentity, getBrowserClient, request, RequestError } from '@/lib/supabase-browser';
import type { Command, Connection, Profile, Room } from '@/lib/types';
import { botReadyAt, botSeat, idleSeat, turnDeadline } from '@/lib/bot-timing';

type Screen = 'home' | 'create' | 'join' | 'room';
type Snapshot = { room: Room; connections?: Connection[] };
type Pending = { code: string; body: Record<string, unknown> };
const LAST_ROOM = 'market-wars-room';
const PENDING = 'market-wars-pending-command';
const safeStorage = {
  get(key: string) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* Auth reports unavailable storage separately. */ } },
  remove(key: string) { try { localStorage.removeItem(key); } catch { /* Optional history. */ } },
};

export function useMultiplayer(initialCode?: string) {
  const [screen, setScreen] = useState<Screen>(initialCode ? 'room' : 'home');
  const [code, setCode] = useState(initialCode || '');
  const [room, setRoom] = useState<Room | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [userId, setUserId] = useState('');
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'reconnecting' | 'offline'>('connecting');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(initialCode));
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const roomRef = useRef<Room | null>(null);
  const connectionsRef = useRef<Connection[]>([]);
  const userRef = useRef('');
  const createId = useRef('');
  const mounted = useRef(true);

  const accept = useCallback((snapshot: Snapshot) => {
    const incoming = snapshot.room;
    if (snapshot.connections) { setConnections(snapshot.connections); connectionsRef.current = snapshot.connections; }
    // The same revision often arrives twice (Broadcast, the HTTP reply, a safety-net poll); keep the room we have.
    if (roomRef.current?.code === incoming.code && roomRef.current.revision >= incoming.revision) return;
    roomRef.current = incoming;
    setRoom(incoming);
  }, []);

  const load = useCallback(async (target: string) => {
    const snapshot = await request<Snapshot>('/api/rooms/' + target);
    if (mounted.current) accept(snapshot);
    return snapshot;
  }, [accept]);

  useEffect(() => {
    mounted.current = true;
    const onPop = () => {
      const match = location.pathname.match(/^\/game\/([^/]+)$/);
      if (match) { setCode(match[1].toUpperCase()); setScreen('room'); }
      else setScreen('home');
    };
    window.addEventListener('popstate', onPop);
    return () => { mounted.current = false; window.removeEventListener('popstate', onPop); };
  }, []);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    setLoading(true); setError('');
    if (roomRef.current?.code !== code) { roomRef.current = null; setRoom(null); setConnections([]); }
    void (async () => {
      try {
        const id = await ensureIdentity();
        if (cancelled) return;
        userRef.current = id; setUserId(id);
        const snapshot = await request<Snapshot>('/api/rooms/' + code);
        if (cancelled) return;
        accept(snapshot); safeStorage.set(LAST_ROOM, code);
        const saved = safeStorage.get(PENDING);
        if (saved) {
          try { const retry = JSON.parse(saved) as Pending; if (retry.code === code) setPending(retry); } catch { safeStorage.remove(PENDING); }
        }
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : 'Could not connect to this room.');
        setScreen('join');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [code, accept]);

  const isMember = Boolean(room && room.member_ids.includes(userId));
  useEffect(() => {
    if (!code || !userId || !isMember) return;
    const supabase = getBrowserClient();
    const clientId = crypto.randomUUID();
    let disposed = false, subscribed = false, refreshing = false, failures = 0;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    // "Reconnecting" means the live channel is down, or several requests in a row failed: one slow request on a phone
    // network is not a lost connection, and saying so made the game look broken when it was fine.
    const succeeded = () => { failures = 0; if (!disposed && subscribed) setConnection('connected'); };
    const failed = () => {
      failures++;
      if (!disposed && (!navigator.onLine || !subscribed || failures >= 3)) setConnection(navigator.onLine ? 'reconnecting' : 'offline');
    };
    const refresh = async () => {
      if (disposed || refreshing || !navigator.onLine) return;
      refreshing = true;
      try {
        const snapshot = await request<Snapshot>('/api/rooms/' + code);
        if (!disposed) { accept(snapshot); succeeded(); }
      } catch { if (!disposed) failed(); }
      finally { refreshing = false; }
    };
    const heartbeat = () => request('/api/rooms/' + code, 'POST', { operation: 'heartbeat', client_id: clientId }).then(() => { if (!disposed) succeeded(); }, () => { if (!disposed) failed(); });
    // One channel per room: the server pushes every saved room on Broadcast, and check-ins (who is online) come from
    // the database. A room arriving more than one revision ahead means a push was missed, so fetch the room at once.
    const channel = supabase.channel('mw-room-' + code)
      .on('broadcast', { event: 'room' }, message => {
        const incoming = (message.payload as { room?: Room })?.room;
        if (disposed || incoming?.code !== code) return;
        const known = roomRef.current?.revision ?? -1;
        accept({ room: incoming });
        if (incoming.revision > known + 1) void refresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mw_connections', filter: 'code=eq.' + code }, payload => {
        const row = payload.new as Connection | undefined;
        if (disposed || !row?.client_id) return;
        const next = [...connectionsRef.current.filter(item => item.client_id !== row.client_id), row];
        connectionsRef.current = next; setConnections(next);
      })
      .subscribe(status => {
        subscribed = status === 'SUBSCRIBED';
        if (disposed) return;
        // Catch up now, and once more shortly after: a move made while the channel was still opening is not pushed.
        if (subscribed) { failures = 0; setConnection('connected'); void heartbeat(); void refresh(); setTimeout(() => { if (!disposed) void refresh(); }, 1500); }
        else setConnection(navigator.onLine ? 'reconnecting' : 'offline');
        schedulePoll();
      });
    setConnection('connecting');
    void heartbeat(); void refresh();
    // A safety net for missed pushes: every 20 s while the live channel is up, every 5 s while it is down. (It was every
    // 5 s always, plus a duplicate database feed of every move: most of the game's server traffic.) A hidden tab skips
    // it and refreshes as soon as it is shown again.
    function schedulePoll() {
      clearTimeout(pollTimer);
      pollTimer = setTimeout(() => { if (!document.hidden) void refresh(); schedulePoll(); }, subscribed ? 20000 : 5000);
    }
    schedulePoll();
    // Check-ins every 20 s: a seat counts as online for 45 s after its last one, so two can be missed.
    const heartbeats = setInterval(() => { if (navigator.onLine) void heartbeat(); }, 20000);
    const reconnect = () => { if (!disposed && navigator.onLine && !document.hidden) { void heartbeat(); void refresh(); } };
    const offline = () => setConnection('offline');
    const disconnect = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) void fetch('/api/rooms/' + code, {
        method: 'POST', keepalive: true,
        headers: { Authorization: 'Bearer ' + data.session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'heartbeat', client_id: clientId, connected: false }),
      }).catch(() => {});
    };
    window.addEventListener('online', reconnect); window.addEventListener('offline', offline);
    window.addEventListener('pagehide', disconnect); document.addEventListener('visibilitychange', reconnect);
    return () => {
      disposed = true; clearTimeout(pollTimer); clearInterval(heartbeats);
      window.removeEventListener('online', reconnect); window.removeEventListener('offline', offline);
      window.removeEventListener('pagehide', disconnect); document.removeEventListener('visibilitychange', reconnect);
      void disconnect(); void supabase.removeChannel(channel);
    };
  }, [code, userId, isMember, accept]);

  const activeBot = room ? botSeat(room) : null;
  const botRevision = room?.revision;
  useEffect(() => {
    if (screen !== 'room' || activeBot === null || connection !== 'connected') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const advance = async () => {
      const current = roomRef.current;
      if (cancelled || !current || current.code !== code || current.revision !== botRevision || botSeat(current) === null) return;
      let retryDelay = 1500;
      try {
        const snapshot = await request<Snapshot>('/api/rooms/' + code,'POST',{operation:'bot-step',revision:current.revision});
        if (!cancelled) {
          accept(snapshot);
          setError(current => current.startsWith('The bot is reconnecting.') ? '' : current);
        }
      } catch (caught) {
        retryDelay = 5000;
        if (!cancelled) {
          // Another browser may have committed the same bot's turn first.
          if (caught instanceof RequestError && caught.status === 409) await load(code).catch(() => {});
          else setError('The bot is reconnecting. Your game is saved; it will retry automatically.');
        }
      }
      if (!cancelled && roomRef.current?.revision === botRevision) timer = setTimeout(advance,retryDelay);
    };
    // One player's browser drives each bot move: the connected human with the lowest seat goes first, and every other
    // browser waits a little longer per seat as a fallback. That avoids every browser asking at once and all but one losing.
    const humans = (roomRef.current?.members || []).filter(member => member.type !== 'bot' && connectionsRef.current.some(c => c.user_id === member.user_id && c.connected && Date.now() - Date.parse(c.seen_at) < 45000)).map(member => member.user_id);
    const rank = Math.max(0, humans.includes(userRef.current) ? humans.indexOf(userRef.current) : humans.length);
    const delay = Math.max(750,botReadyAt(roomRef.current!) - Date.now() + 150) + rank * 2500;
    timer = setTimeout(advance,delay);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [activeBot,botRevision,code,connection,screen,accept,load]);

  const idle = room ? idleSeat(room) : null;
  const idleRevision = room?.revision;
  useEffect(() => {
    if (screen !== 'room' || idle === null || connection !== 'connected') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const expire = async () => {
      const current = roomRef.current;
      if (cancelled || !current || current.code !== code || current.revision !== idleRevision || idleSeat(current) === null) return;
      try { accept(await request<Snapshot>('/api/rooms/' + code,'POST',{operation:'timeout',revision:current.revision})); }
      catch (caught) { if (!cancelled && caught instanceof RequestError && caught.status === 409) await load(code).catch(() => {}); }
      // Clocks can differ slightly; keep checking until the server accepts the timeout.
      if (!cancelled && roomRef.current?.revision === idleRevision) timer = setTimeout(expire,3000);
    };
    timer = setTimeout(expire,Math.max(1000,turnDeadline(roomRef.current!) - Date.now() + 500));
    return () => { cancelled = true; clearTimeout(timer); };
  }, [idle,idleRevision,code,connection,screen,accept,load]);

  const enter = useCallback((snapshot: Snapshot) => {
    accept(snapshot); setCode(snapshot.room.code); setScreen('room'); setLoading(false); setError('');
    safeStorage.set(LAST_ROOM, snapshot.room.code);
    history.replaceState(null, '', '/game/' + snapshot.room.code);
  }, [accept]);

  const joinOrCreate = async (player: Profile, target?: string) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const id = await ensureIdentity(); userRef.current = id; setUserId(id);
      createId.current ||= crypto.randomUUID();
      const snapshot = target
        ? await request<Snapshot>('/api/rooms/' + target.trim().toUpperCase(), 'POST', { operation: 'join', ...player })
        : await request<Snapshot>('/api/rooms', 'POST', { ...player, request_id: createId.current });
      enter(snapshot); createId.current = '';
      safeStorage.set('market-wars-profile', JSON.stringify(player));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not open this lobby.'); }
    finally { setBusy(false); }
  };

  // Take over an existing seat on this device using its private rejoin code.
  const reclaim = async (target: string, rejoinCode: string) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const id = await ensureIdentity(); userRef.current = id; setUserId(id);
      enter(await request<Snapshot>('/api/rooms/' + target.trim().toUpperCase(), 'POST', { operation: 'reclaim', rejoin_code: rejoinCode }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not rejoin this room.'); }
    finally { setBusy(false); }
  };
  const rejoinCode = async () => (await request<{ rejoin_code: string }>('/api/rooms/' + code, 'POST', { operation: 'rejoin-code' })).rejoin_code;

  const runPending = async (retry: Pending) => {
    setBusy(true); setError('');
    try {
      // Resending the same request ID is safe: the server applies it at most once.
      // Retry slow or dropped responses quietly before asking the player.
      let snapshot: Snapshot | null = null;
      // Only a definite answer (a 4xx refusal) stops the retries; dropped connections and server hiccups are retried.
      const delays = [500, 1000, 2000, 3000];
      for (let attempt = 0; !snapshot; attempt++) {
        try { snapshot = await request<Snapshot>('/api/rooms/' + retry.code, 'POST', retry.body); }
        catch (caught) {
          const definite = caught instanceof RequestError && caught.status >= 400 && caught.status < 500 && caught.status !== 429;
          if (definite || attempt >= delays.length) throw caught;
          await new Promise(resolve => setTimeout(resolve, delays[attempt]));
        }
      }
      accept(snapshot); setPending(null); safeStorage.remove(PENDING);
    } catch (caught) {
      // Retain the exact request ID after an uncertain response. A retry cannot
      // execute the same action twice, even after a refresh or in another tab.
      // A definitive validation/conflict response did not accept this command.
      if (caught instanceof RequestError && caught.status >= 400 && caught.status < 500) {
        setPending(null); safeStorage.remove(PENDING);
      }
      setError(caught instanceof Error ? caught.message : 'Could not confirm the action.');
      try { await load(retry.code); } catch { setConnection('reconnecting'); }
      throw caught;
    } finally { setBusy(false); }
  };

  // An unconfirmed move keeps retrying by itself: every few seconds, and as soon as the room changes (the move may
  // already be in). The server applies a request ID at most once, so retrying can never repeat the move.
  const pendingRevision = room?.revision;
  useEffect(() => {
    if (!pending || busy || !navigator.onLine) return;
    const timer = setTimeout(() => { void runPending(pending).catch(() => {}); }, 2500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, busy, pendingRevision]);

  const send = async (operation: 'start' | 'action', action?: Command) => {
    if (busy || !roomRef.current) return;
    if (pending) throw new Error('Resolve the unconfirmed action before taking another turn.');
    const retry: Pending = { code: roomRef.current.code, body: {
      operation, ...action, request_id: crypto.randomUUID(), revision: roomRef.current.revision,
    } };
    setPending(retry); safeStorage.set(PENDING, JSON.stringify(retry));
    await runPending(retry);
  };

  const updateProfile = async (player: Profile) => {
    if (busy || !roomRef.current) return;
    setBusy(true); setError('');
    try {
      accept(await request<Snapshot>('/api/rooms/' + code, 'POST', { operation: 'profile', revision: roomRef.current.revision, ...player }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not update your choices.'); await load(code).catch(() => {}); }
    finally { setBusy(false); }
  };

  const leave = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await request('/api/rooms/' + code, 'POST', { operation: 'leave' });
      setCode(''); setRoom(null); roomRef.current = null; setScreen('home');
      safeStorage.remove(LAST_ROOM); history.replaceState(null, '', '/');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not leave the room.'); }
    finally { setBusy(false); }
  };

  const manageBot = async (operation:'add-bot'|'remove-bot', values:Record<string,unknown>) => {
    if (busy || !roomRef.current) return;
    setBusy(true); setError('');
    try {
      accept(await request<Snapshot>('/api/rooms/' + code,'POST',{operation,revision:roomRef.current.revision,...values}));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update the bot seats.');
      await load(code).catch(() => {});
    } finally { setBusy(false); }
  };

  // Quit a running game: forfeit the seat on the server, then leave the room.
  const exitGame = async () => {
    const current = roomRef.current;
    if (!current || busy) return;
    try {
      if (current.status === 'playing') accept(await request<Snapshot>('/api/rooms/' + code, 'POST', { operation: 'forfeit', revision: current.revision }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'You cannot leave right now.');
      if (caught instanceof RequestError && caught.status === 409) await load(code).catch(() => {});
      return;
    }
    await leave();
  };

  const navigate = (action: string) => {
    setError('');
    if (action === 'load') {
      const saved = safeStorage.get(LAST_ROOM);
      if (saved) { setCode(saved); setScreen('room'); history.replaceState(null, '', '/game/' + saved); }
      else setScreen('join');
    } else if (action === 'menu') { setScreen('home'); history.replaceState(null, '', '/'); }
    else setScreen(action === 'join' ? 'join' : 'create');
  };

  return { screen, code, room, connections, userId, connection, busy, loading, error, setError,
    pending, navigate, joinOrCreate, updateProfile, leave, exitGame, reclaim, rejoinCode,
    addBot: () => manageBot('add-bot',{}), removeBot: (id:string) => manageBot('remove-bot',{bot_id:id}),
    start: () => send('start'), command: (action: Command) => send('action', action),
    retry: () => pending ? runPending(pending) : Promise.resolve(),
    dismissPending: () => { setPending(null); safeStorage.remove(PENDING); setError(''); },
  };
}
