'use client';

// Chooses between the original 2D board and the optional 3D tabletop, and mounts both the
// toggle and the 3D canvas into the containers lib/game-ui.js creates on the game screen.
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const Board3D = dynamic(() => import('./Board3D'), { ssr: false, loading: () => <div className="board-3d-loading">Setting up the table…</div> });
type Mode = '2d' | '3d';
type Support = 'ok' | 'slow' | 'none';
const STORAGE_KEY = 'market-wars-board-view';

/** WebGL availability, and whether the GPU looks too weak (software renderers, very few cores). */
function detectSupport(): Support {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return 'none';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    if (/swiftshader|llvmpipe|software|basic render/.test(renderer)) return 'slow';
    if ((navigator.hardwareConcurrency || 4) <= 2) return 'slow';
    return 'ok';
  } catch { return 'none'; }
}
const isPhone = () => matchMedia('(max-width: 760px), (pointer: coarse) and (max-width: 1024px)').matches;
function savedMode(): Mode | null {
  try { const value = localStorage.getItem(STORAGE_KEY); return value === '2d' || value === '3d' ? value : null; } catch { return null; }
}
function saveMode(mode: Mode) {
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* The choice still applies for this visit. */ }
}

export default function BoardView() {
  const [roots, setRoots] = useState<{ toggle: HTMLElement; stage: HTMLElement } | null>(null);
  const [support, setSupport] = useState<Support>('none');
  const [mode, setMode] = useState<Mode>('2d');
  const [note, setNote] = useState('');
  useEffect(() => {
    const detected = detectSupport();
    setSupport(detected);
    const saved = savedMode();
    setMode(detected === 'none' ? '2d' : saved || (isPhone() || detected !== 'ok' ? '2d' : '3d'));
    const find = () => {
      const toggle = document.getElementById('board-view-toggle-root'), stage = document.getElementById('board-3d-root');
      if (toggle && stage) setRoots({ toggle, stage });
    };
    find();
    document.addEventListener('mw:board-ready', find);
    return () => document.removeEventListener('mw:board-ready', find);
  }, []);
  useEffect(() => {
    if (roots) document.dispatchEvent(new CustomEvent('mw:board-mode', { detail: { mode } }));
  }, [mode, roots]);
  if (!roots) return null;
  const choose = (next: Mode) => { setMode(next); saveMode(next); setNote(''); };
  const tooSlow = () => { setMode('2d'); setNote('3D was too slow on this device, so the 2D board is shown.'); };
  return <>
    {createPortal(<span className="board-view-toggle" role="group" aria-label="Board style">
      <button type="button" aria-pressed={mode === '2d'} onClick={() => choose('2d')}>2D board</button>
      <button type="button" aria-pressed={mode === '3d'} onClick={() => choose('3d')} disabled={support === 'none'}
        title={support === 'none' ? 'This browser cannot show 3D graphics (WebGL is unavailable).' : support === 'slow' ? 'This device may be slow in 3D.' : 'Realistic 3D tabletop'}>3D board</button>
      {note && <span className="board-view-note" role="status">{note}</span>}
    </span>, roots.toggle)}
    {mode === '3d' && support !== 'none' && createPortal(<Board3D quality={isPhone() || support === 'slow' ? 'low' : 'high'} onTooSlow={tooSlow} />, roots.stage)}
  </>;
}
