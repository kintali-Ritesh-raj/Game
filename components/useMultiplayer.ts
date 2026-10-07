'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ensureIdentity, getBrowserClient, request, RequestError } from '@/lib/supabase-browser';
import type { Command, Connection, Profile, Role, Room } from '@/lib/types';
import { botReadyAt, botSeat } from '@/lib/bot-timing';

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
  const userRef = useRef('');
  const createId = useRef('');
  const mounted = useRef(true);

  const accept = useCallback((snapshot: Snapshot) => {
    const incoming = snapshot.room;
    if (roomRef.current?.code === incoming.code && roomRef.current.revision > incoming.revision) return;
    roomRef.current = incoming;
    setRoom(incoming);
    if (snapshot.connections) setConnections(snapshot.connections);
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
    let disposed = false, subscribed = false, refreshing = false;
    const refresh = async () => {
      if (disposed || refreshing || !navigator.onLine) return;
      refreshing = true;
      try {
        const snapshot = await request<Snapshot>('/api/rooms/' + code);
        if (!disposed) {
          accept(snapshot);
          if (subscribed) setConnection('connected');
        }
      } catch { if (!disposed) setConnection(navigator.onLine ? 'reconnecting' : 'offline'); }
      finally { refreshing = false; }
    };
    const heartbeat = () => request('/api/rooms/' + code, 'POST', { operation: 'heartbeat', client_id: clientId }).catch(() => {
      if (!disposed) setConnection(navigator.onLine ? 'reconnecting' : 'offline');
    });
    const channel = supabase.channel('mw-room-' + code + '-' + clientId)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'mw_rooms', filter: 'code=eq.' + code }, payload => {
        if (!disposed) accept({ room: payload.new as Room });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mw_connections', filter: 'code=eq.' + code }, () => { void refresh(); })
      .subscribe(status => {
        subscribed = status === 'SUBSCRIBED';
        if (disposed) return;
        if (subscribed) { void heartbeat(); void refresh(); }
        else setConnection(navigator.onLine ? 'reconnecting' : 'offline');
      });
    setConnection('connecting');
    void heartbeat(); void refresh();
    // Re-fetch after subscribing and periodically to close missed-event gaps.
    const polling = setInterval(() => { void refresh(); }, 5000);
    const heartbeats = setInterval(() => { if (navigator.onLine) void heartbeat(); }, 15000);
    const reconnect = () => { if (!disposed && navigator.onLine) { void heartbeat(); void refresh(); } };
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
      disposed = true; clearInterval(polling); clearInterval(heartbeats);
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
    const delay = Math.max(750,botReadyAt(roomRef.current!) - Date.now() + 150);
    timer = setTimeout(advance,delay);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [activeBot,botRevision,code,connection,screen,accept,load]);

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

  const runPending = async (retry: Pending) => {
    setBusy(true); setError('');
    try {
      const snapshot = await request<Snapshot>('/api/rooms/' + retry.code, 'POST', retry.body);
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
    pending, navigate, joinOrCreate, updateProfile, leave,
    addBot: (role:Role) => manageBot('add-bot',{role}), removeBot: (id:string) => manageBot('remove-bot',{bot_id:id}),
    start: () => send('start'), command: (action: Command) => send('action', action),
    retry: () => pending ? runPending(pending) : Promise.resolve(),
    dismissPending: () => { setPending(null); safeStorage.remove(PENDING); setError(''); },
  };
}
