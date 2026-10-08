'use client';

// Realistic 3D tabletop view of the Market Wars board. It is a view only: every position, die
// value and building comes from the board snapshot that lib/game-ui.js broadcasts after the
// server-confirmed state is applied. Nothing here computes game results.
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer, OrbitControls, PerformanceMonitor, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { BAND, GRID, drawBoardFace, drawCardFace, drawNote, drawWood, tileAt, tileRect } from '@/lib/board3d-textures';

export type BoardSnapshot = {
  players: { id: number; name: string; color: string; position: number; bankrupt: boolean; active: boolean; mine: boolean }[];
  properties: Record<string, { owner: number | null; buildings: number; mortgaged: boolean }>;
  dice: number[]; phase: string; hasRolled: boolean; rollId: string; selected: number;
  movementSpeed: number; animationSpeed: number;
};

const SIZE = 10;                 // board play area in world units
const CELL = SIZE / GRID;        // one board cell in world units
const BOARD_Y = 0;               // printed surface height
const TABLE_Y = -0.31;           // table top
const TRIM = .07;                // brass trim visible between the print and the frame
const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** World-space centre of a space's main area (away from the colour band). */
function spaceCenter(id: number) {
  const r = tileRect(id);
  let cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const shift = (BAND + .28) / 2;
  if (r.edge === 'south') cy += shift; if (r.edge === 'north') cy -= shift;
  if (r.edge === 'west') cx -= shift; if (r.edge === 'east') cx += shift;
  return new THREE.Vector3((cx - GRID / 2) * CELL, BOARD_Y, (cy - GRID / 2) * CELL);
}
/** Where houses sit: the building zone next to the colour band, running along the band. */
function buildingSlots(id: number, count: number) {
  const r = tileRect(id), out: THREE.Vector3[] = [];
  const along = r.edge === 'south' || r.edge === 'north';
  const depth = BAND + .14;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? .5 : .2 + (.6 * i) / (count - 1);
    let x = r.x + r.w * t, y = r.y + r.h * t;
    if (along) y = r.edge === 'south' ? r.y + depth : r.y + r.h - depth;
    else x = r.edge === 'west' ? r.x + r.w - depth : r.x + depth;
    out.push(new THREE.Vector3((x - GRID / 2) * CELL, BOARD_Y, (y - GRID / 2) * CELL));
  }
  return out;
}

/**
 * One texture per surface for its whole life: a canvas of the final size, filled with a placeholder
 * colour, then painted with the drawn artwork and re-uploaded. Swapping texture objects instead would
 * race with disposal and with WebGL2's fixed-size texture storage.
 */
function useCanvasTexture(make: () => HTMLCanvasElement | Promise<HTMLCanvasElement>, width: number, height: number, placeholder: string, deps: unknown[]) {
  const gl = useThree(state => state.gl), invalidate = useThree(state => state.invalidate);
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = placeholder; ctx.fillRect(0, 0, width, height);
    const made = new THREE.CanvasTexture(canvas);
    made.colorSpace = THREE.SRGBColorSpace;
    made.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    return made;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);
  useEffect(() => {
    let live = true;
    void Promise.resolve(make()).then(art => {
      if (!live) return;
      (texture.image as HTMLCanvasElement).getContext('2d')!.drawImage(art, 0, 0, width, height);
      texture.needsUpdate = true; invalidate();
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texture, ...deps]);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

function Table({ quality }: { quality: 'high' | 'low' }) {
  const wood = useMemo(() => drawWood(quality === 'high' ? 512 : 256, [70, 40, 22], 9), [quality]);
  const maps = useMemo(() => {
    const color = new THREE.CanvasTexture(wood.color), normal = new THREE.CanvasTexture(wood.normal);
    color.colorSpace = THREE.SRGBColorSpace;
    for (const t of [color, normal]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3); }
    return { color, normal };
  }, [wood]);
  useEffect(() => () => { maps.color.dispose(); maps.normal.dispose(); }, [maps]);
  return <mesh rotation-x={-Math.PI / 2} position-y={TABLE_Y} receiveShadow>
    <planeGeometry args={[60, 60]} />
    <meshStandardMaterial map={maps.color} normalMap={maps.normal} normalScale={new THREE.Vector2(.35, .35)} roughness={.62} metalness={0} />
  </mesh>;
}

function Frame({ quality }: { quality: 'high' | 'low' }) {
  const wood = useMemo(() => drawWood(quality === 'high' ? 512 : 256, [104, 58, 30], 3), [quality]);
  const maps = useMemo(() => {
    const color = new THREE.CanvasTexture(wood.color), normal = new THREE.CanvasTexture(wood.normal);
    color.colorSpace = THREE.SRGBColorSpace;
    for (const t of [color, normal]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, .35); }
    return { color, normal };
  }, [wood]);
  useEffect(() => () => { maps.color.dispose(); maps.normal.dispose(); }, [maps]);
  const rail = .62, outer = SIZE + TRIM * 2 + rail * 2, height = .34;
  const pieces: [number, number, number, number][] = [
    [0, -(SIZE / 2 + TRIM + rail / 2), outer, rail], [0, SIZE / 2 + TRIM + rail / 2, outer, rail],
    [-(SIZE / 2 + TRIM + rail / 2), 0, rail, SIZE + TRIM * 2], [SIZE / 2 + TRIM + rail / 2, 0, rail, SIZE + TRIM * 2],
  ];
  return <group>
    {pieces.map(([x, z, w, d], i) => <RoundedBox key={i} args={[w, height, d]} radius={.06} smoothness={3} position={[x, TABLE_Y + height / 2, z]} castShadow receiveShadow>
      <meshStandardMaterial map={maps.color} normalMap={maps.normal} normalScale={new THREE.Vector2(.5, .5)} roughness={.42} metalness={0} />
    </RoundedBox>)}
    {/* Brass trim around the printed board */}
    <mesh position={[0, BOARD_Y - .02, 0]} receiveShadow>
      <boxGeometry args={[SIZE + TRIM * 2, .03, SIZE + TRIM * 2]} />
      <meshStandardMaterial color="#b08a3e" metalness={.85} roughness={.32} />
    </mesh>
  </group>;
}

function BoardSurface({ quality, selected, onPick }: { quality: 'high' | 'low'; selected: number; onPick: (id: number) => void }) {
  const faceSize = quality === 'high' ? 2048 : 1536;
  const face = useCanvasTexture(() => drawBoardFace(faceSize), faceSize, faceSize, '#e9dfc4', []);
  const [hover, setHover] = useState(false);
  useEffect(() => { document.body.style.cursor = hover ? 'pointer' : ''; return () => { document.body.style.cursor = ''; }; }, [hover]);
  const pick = (event: ThreeEvent<MouseEvent>) => {
    if (!event.uv) return;
    const id = tileAt(event.uv.x * GRID, (1 - event.uv.y) * GRID);
    if (id !== null) { event.stopPropagation(); onPick(id); }
  };
  return <group>
    <mesh position-y={(BOARD_Y - .002 + TABLE_Y) / 2} receiveShadow>
      <boxGeometry args={[SIZE, BOARD_Y - .002 - TABLE_Y, SIZE]} />
      <meshStandardMaterial color="#2a1a0f" roughness={.8} />
    </mesh>
    <mesh rotation-x={-Math.PI / 2} position-y={BOARD_Y} receiveShadow onClick={pick} onPointerOver={() => setHover(true)} onPointerOut={() => setHover(false)}>
      <planeGeometry args={[SIZE, SIZE]} />
      <meshStandardMaterial map={face} roughness={.78} metalness={0} />
    </mesh>
    <Selection id={selected} />
  </group>;
}

function Selection({ id }: { id: number }) {
  const r = tileRect(id), w = r.w * CELL, d = r.h * CELL;
  const x = (r.x + r.w / 2 - GRID / 2) * CELL, z = (r.y + r.h / 2 - GRID / 2) * CELL, t = .045;
  return <group position={[x, BOARD_Y + .004, z]}>
    {[[0, -d / 2 + t / 2, w, t], [0, d / 2 - t / 2, w, t], [-w / 2 + t / 2, 0, t, d], [w / 2 - t / 2, 0, t, d]].map(([px, pz, sw, sd], i) =>
      <mesh key={i} position={[px, 0, pz]}><boxGeometry args={[sw, .008, sd]} /><meshStandardMaterial color="#f0cf7c" emissive="#c9952e" emissiveIntensity={.6} metalness={.6} roughness={.3} /></mesh>)}
  </group>;
}

// ── Dice ──────────────────────────────────────────────────────────────────────
const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
};
// Face value → outward normal in die space. Opposite faces sum to 7.
const FACE: Record<number, THREE.Vector3> = {
  1: new THREE.Vector3(0, 1, 0), 6: new THREE.Vector3(0, -1, 0), 2: new THREE.Vector3(1, 0, 0),
  5: new THREE.Vector3(-1, 0, 0), 3: new THREE.Vector3(0, 0, 1), 4: new THREE.Vector3(0, 0, -1),
};
const DIE = .56;
function DieModel() {
  const pips = useMemo(() => Object.entries(PIPS).flatMap(([value, spots]) => {
    const n = FACE[Number(value)], q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    return spots.map(([a, b]) => {
      const local = new THREE.Vector3(a * DIE * .26, b * DIE * .26, DIE / 2 - .012).applyQuaternion(q);
      return { position: local, quaternion: q };
    });
  }), []);
  return <group>
    <RoundedBox args={[DIE, DIE, DIE]} radius={DIE * .16} smoothness={5} castShadow receiveShadow>
      <meshPhysicalMaterial color="#f6f1e6" roughness={.28} clearcoat={1} clearcoatRoughness={.12} sheen={.2} />
    </RoundedBox>
    {pips.map((pip, i) => <mesh key={i} position={pip.position} quaternion={pip.quaternion} scale={[1, 1, .42]}>
      <sphereGeometry args={[DIE * .085, 20, 12]} />
      <meshStandardMaterial color="#141416" roughness={.35} />
    </mesh>)}
  </group>;
}
/** Rotation that turns `value` to face up, with a cosmetic yaw. */
function restingQuaternion(value: number, yaw: number) {
  const up = new THREE.Quaternion().setFromUnitVectors(FACE[value] || FACE[1], new THREE.Vector3(0, 1, 0));
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(up);
}
function Dice({ snapshot }: { snapshot: BoardSnapshot }) {
  const refs = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const roll = useRef<{ start: number; duration: number; spin: THREE.Vector3[]; from: THREE.Vector3[] } | null>(null);
  const seen = useRef('');
  const invalidate = useThree(state => state.invalidate);
  const rest = useMemo(() => [new THREE.Vector3(-.55, BOARD_Y + DIE / 2, 2.35), new THREE.Vector3(.45, BOARD_Y + DIE / 2, 2.62)], []);
  const yaw = useMemo(() => { let h = 0; for (const c of snapshot.rollId) h = (h * 31 + c.charCodeAt(0)) >>> 0; return [(h % 628) / 100, ((h >> 8) % 628) / 100]; }, [snapshot.rollId]);
  useEffect(() => {
    const key = snapshot.phase + '|' + snapshot.rollId + '|' + snapshot.dice.join();
    if (snapshot.phase === 'rolling' && seen.current !== key && !reducedMotion()) {
      roll.current = { start: performance.now(), duration: 900 / (snapshot.animationSpeed || 1),
        spin: [new THREE.Vector3(1, .4, .2).normalize(), new THREE.Vector3(-.3, .5, 1).normalize()],
        from: [new THREE.Vector3(-2.6, 2.4, 4.4), new THREE.Vector3(-1.9, 2.8, 4.8)] };
    }
    seen.current = key;
    invalidate();
  }, [snapshot.phase, snapshot.rollId, snapshot.dice, snapshot.animationSpeed, invalidate]);
  useFrame(() => {
    const now = performance.now();
    refs.forEach((ref, i) => {
      const die = ref.current; if (!die) return;
      const target = restingQuaternion(snapshot.dice[i] || 1, yaw[i] || 0);
      const r = roll.current;
      if (!r) { die.position.copy(rest[i]); die.quaternion.copy(target); return; }
      const t = Math.min(1, (now - r.start) / r.duration), ease = 1 - Math.pow(1 - t, 3);
      // Tumble down onto the felt with two damped bounces, spinning to rest on the server's value.
      die.position.lerpVectors(r.from[i], rest[i], ease);
      die.position.y = rest[i].y + Math.max(0, (r.from[i].y - rest[i].y) * (1 - ease)) + Math.abs(Math.sin(t * Math.PI * 3)) * .35 * (1 - t);
      const spin = new THREE.Quaternion().setFromAxisAngle(r.spin[i], (1 - ease) * Math.PI * 6);
      die.quaternion.copy(target).premultiply(spin);
    });
    if (roll.current) { if (now - roll.current.start >= roll.current.duration) roll.current = null; invalidate(); }
  });
  return <>{refs.map((ref, i) => <group key={i} ref={ref} position={rest[i]}><DieModel /></group>)}</>;
}

// ── Pawns, owner chips and buildings ───────────────────────────────────────────
const pawnProfile = [[0, 0], [.2, 0], [.215, .03], [.2, .06], [.13, .09], [.085, .16], [.07, .28], [.11, .31], [.06, .34], [0, .35]].map(([x, y]) => new THREE.Vector2(x, y));
function Pawn({ color, target, active, speed }: { color: string; target: THREE.Vector3; active: boolean; speed: number }) {
  const ref = useRef<THREE.Group>(null);
  const hop = useRef<{ from: THREE.Vector3; to: THREE.Vector3; start: number; duration: number } | null>(null);
  const invalidate = useThree(state => state.invalidate);
  const last = useRef(target.clone());
  useEffect(() => {
    if (last.current.distanceTo(target) < 1e-4) return;
    if (reducedMotion()) ref.current?.position.copy(target);
    else hop.current = { from: ref.current ? ref.current.position.clone() : last.current.clone(), to: target.clone(), start: performance.now(), duration: 140 / (speed || 1) };
    last.current = target.clone(); invalidate();
  }, [target, speed, invalidate]);
  useFrame(() => {
    const pawn = ref.current, h = hop.current; if (!pawn || !h) return;
    const t = Math.min(1, (performance.now() - h.start) / h.duration);
    pawn.position.lerpVectors(h.from, h.to, t); pawn.position.y = h.to.y + Math.sin(t * Math.PI) * .32;
    if (t >= 1) hop.current = null;
    invalidate();
  });
  return <group ref={ref} position={target} scale={1.25}>
    <mesh castShadow receiveShadow><latheGeometry args={[pawnProfile, 40]} /><meshPhysicalMaterial color={color} roughness={.3} clearcoat={1} clearcoatRoughness={.1} metalness={.05} /></mesh>
    <mesh position-y={.41} castShadow><sphereGeometry args={[.105, 32, 20]} /><meshPhysicalMaterial color={color} roughness={.28} clearcoat={1} clearcoatRoughness={.08} metalness={.05} /></mesh>
    {active && <mesh rotation-x={-Math.PI / 2} position-y={.006}><ringGeometry args={[.24, .29, 40]} /><meshStandardMaterial color="#f0cf7c" emissive="#d9a23a" emissiveIntensity={.8} /></mesh>}
  </group>;
}
function House({ color, position, rotation }: { color: string; position: THREE.Vector3; rotation: number }) {
  return <group position={position} rotation-y={rotation}>
    <mesh position-y={.055} castShadow receiveShadow><boxGeometry args={[.13, .11, .11]} /><meshStandardMaterial color={color} roughness={.45} /></mesh>
    <mesh position-y={.135} rotation-y={Math.PI / 4} castShadow><coneGeometry args={[.105, .07, 4]} /><meshStandardMaterial color={color} roughness={.4} /></mesh>
  </group>;
}
function Tower({ color, position }: { color: string; position: THREE.Vector3 }) {
  return <group position={position}>
    <mesh position-y={.15} castShadow receiveShadow><boxGeometry args={[.17, .3, .15]} /><meshStandardMaterial color={color} roughness={.38} metalness={.1} /></mesh>
    <mesh position-y={.33} castShadow><boxGeometry args={[.11, .06, .09]} /><meshStandardMaterial color="#e2bb62" metalness={.8} roughness={.3} /></mesh>
  </group>;
}
function Holdings({ snapshot }: { snapshot: BoardSnapshot }) {
  const colors = Object.fromEntries(snapshot.players.map(player => [player.id, player.color]));
  return <>{Object.entries(snapshot.properties).map(([key, asset]) => {
    if (asset.owner === null || !colors[asset.owner]) return null;
    const id = Number(key), color = colors[asset.owner], r = tileRect(id);
    const along = r.edge === 'south' || r.edge === 'north', rotation = along ? 0 : Math.PI / 2;
    const chip = buildingSlots(id, 1)[0].clone();
    const offset = (r.edge === 'south' || r.edge === 'north' ? new THREE.Vector3(r.w * CELL * .36, 0, 0) : new THREE.Vector3(0, 0, r.h * CELL * .36));
    chip.add(offset);
    const level = asset.buildings;
    return <group key={id}>
      {/* Owner chip: a lacquered disc in the owner's colour */}
      <mesh position={chip} castShadow><cylinderGeometry args={[.075, .08, .035, 28]} /><meshPhysicalMaterial color={color} clearcoat={1} roughness={.3} /></mesh>
      {level === 5 ? <Tower color={color} position={buildingSlots(id, 1)[0]} />
        : buildingSlots(id, level).map((slot, i) => <House key={i} color={color} position={slot} rotation={rotation} />)}
      {asset.mortgaged && <mesh rotation-x={-Math.PI / 2} position={[(r.x + r.w / 2 - GRID / 2) * CELL, BOARD_Y + .003, (r.y + r.h / 2 - GRID / 2) * CELL]}>
        <planeGeometry args={[r.w * CELL * .92, r.h * CELL * .92]} /><meshBasicMaterial color="#3a2a20" transparent opacity={.28} depthWrite={false} />
      </mesh>}
    </group>;
  })}</>;
}
function Pawns({ snapshot }: { snapshot: BoardSnapshot }) {
  const living = snapshot.players.filter(player => !player.bankrupt);
  return <>{living.map(player => {
    const here = living.filter(other => other.position === player.position), index = here.indexOf(player);
    const offsets = [[0, 0], [-.16, 0, .16, 0], [-.17, -.1, .17, -.1, 0, .14], [-.16, -.15, .16, -.15, -.16, .15, .16, .15]][here.length - 1] || [0, 0];
    const target = spaceCenter(player.position).add(new THREE.Vector3(offsets[index * 2] || 0, 0, offsets[index * 2 + 1] || 0));
    return <Pawn key={player.id} color={player.color} target={target} active={player.active} speed={snapshot.movementSpeed} />;
  })}</>;
}

// ── Cards and money ────────────────────────────────────────────────────────────
function Deck({ title, accent, glyph, position, rotation }: { title: string; accent: string; glyph: string; position: [number, number, number]; rotation: number }) {
  const face = useCanvasTexture(() => drawCardFace(title, accent, glyph), 512, 352, '#f4ecd6', [title]);
  return <group position={position} rotation-y={rotation}>
    {Array.from({ length: 4 }, (_, i) => <mesh key={i} position={[(i % 2) * .012, .012 + i * .022, -(i % 3) * .008]} castShadow receiveShadow>
      <boxGeometry args={[1.32, .02, .9]} />
      <meshStandardMaterial color="#efe5cb" roughness={.7} />
    </mesh>)}
    <mesh rotation-x={-Math.PI / 2} position-y={.101}><planeGeometry args={[1.3, .88]} /><meshStandardMaterial map={face} roughness={.66} /></mesh>
  </group>;
}
function NoteStack({ amount, tint, position, rotation, count }: { amount: number; tint: string; position: [number, number, number]; rotation: number; count: number }) {
  const face = useCanvasTexture(() => drawNote(amount, tint), 512, 256, tint, [amount, tint]);
  return <group position={position} rotation-y={rotation}>
    {Array.from({ length: count }, (_, i) => <mesh key={i} position={[Math.sin(i * 1.7) * .02, .006 + i * .011, Math.cos(i * 2.3) * .02]} rotation-y={Math.sin(i * 3.1) * .03} castShadow receiveShadow>
      <boxGeometry args={[1.5, .009, .74]} />
      <meshStandardMaterial color={tint} roughness={.85} />
    </mesh>)}
    <mesh rotation-x={-Math.PI / 2} position-y={.012 + count * .011} rotation-z={0}><planeGeometry args={[1.48, .72]} /><meshStandardMaterial map={face} roughness={.82} /></mesh>
  </group>;
}

function CameraRig() {
  const camera = useThree(state => state.camera), size = useThree(state => state.size);
  useEffect(() => {
    // Fit the framed board plus the money row in front of it, for any stage shape.
    const aspect = size.width / size.height, distance = Math.max(19.5, 20.5 / Math.max(.5, aspect));
    camera.position.set(0, distance * .8, distance * .6 + 1.4);
    camera.lookAt(0, 0, 1.6); camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

function Scene({ snapshot, quality, onPick }: { snapshot: BoardSnapshot; quality: 'high' | 'low'; onPick: (id: number) => void }) {
  const high = quality === 'high';
  return <>
    <color attach="background" args={['#0f1416']} />
    <fog attach="fog" args={['#0f1416', 22, 46]} />
    <hemisphereLight args={['#fff4e2', '#2a1a10', .18]} />
    {/* Key light casts the shadows; a soft-edged spotlight adds the warm pool over the board that
        falls off into the table, like a lamp above a game table. */}
    <directionalLight position={[-6.5, 12, 6]} intensity={1.5} color="#fff1dc" castShadow
      shadow-mapSize={[high ? 2048 : 1024, high ? 2048 : 1024]} shadow-bias={high ? -0.0006 : -0.0004} shadow-normalBias={.03} shadow-radius={high ? 9 : 3} shadow-blurSamples={high ? 16 : 8}
      shadow-camera-left={-9} shadow-camera-right={9} shadow-camera-top={9} shadow-camera-bottom={-9} shadow-camera-near={1} shadow-camera-far={40} />
    <spotLight position={[-3, 15, 5]} angle={.6} penumbra={.9} decay={0} intensity={2} color="#ffe9c8" />
    <directionalLight position={[7, 5, -6]} intensity={.3} color="#cfe3ff" />
    {/* Procedural studio reflections: soft boxes only, no downloaded HDR. */}
    <Environment resolution={high ? 256 : 128} frames={1}>
      <Lightformer form="rect" intensity={2.2} position={[-4, 8, 4]} scale={[8, 5, 1]} rotation-x={Math.PI / 2.4} color="#fff3e0" />
      <Lightformer form="rect" intensity={.8} position={[6, 4, -4]} scale={[6, 3, 1]} rotation-y={-Math.PI / 3} color="#dbe8ff" />
      <Lightformer form="ring" intensity={.6} position={[0, 6, -8]} scale={4} color="#ffe2b8" />
    </Environment>
    <Table quality={quality} />
    <Frame quality={quality} />
    <BoardSurface quality={quality} selected={snapshot.selected} onPick={onPick} />
    <Deck title="MARKET EVENT" accent="#b5452f" glyph="↗" position={[-1.75, BOARD_Y, -1.55]} rotation={.32} />
    <Deck title="ECONOMIC EVENT" accent="#1f5f6b" glyph="⌁" position={[1.8, BOARD_Y, -1.3]} rotation={-.28} />
    {/* The bank's tray of Market Wars notes, on the table in front of the board. */}
    <NoteStack amount={20} tint="#e7a3b4" position={[-3.4, TABLE_Y, 6.45]} rotation={.06} count={10} />
    <NoteStack amount={50} tint="#9cc3e6" position={[-1.7, TABLE_Y, 6.55]} rotation={-.05} count={8} />
    <NoteStack amount={100} tint="#9ccfa2" position={[0, TABLE_Y, 6.5]} rotation={.03} count={9} />
    <NoteStack amount={500} tint="#e9c46a" position={[1.7, TABLE_Y, 6.6]} rotation={-.08} count={7} />
    <Holdings snapshot={snapshot} />
    <Pawns snapshot={snapshot} />
    <Dice snapshot={snapshot} />
    <ContactShadows position={[0, BOARD_Y + .002, 0]} scale={SIZE} far={1.2} blur={2.4} opacity={.7} resolution={high ? 512 : 256} color="#1a0f08" />
    <CameraRig />
    <OrbitControls makeDefault enablePan={false} target={[0, 0, 1.6]} minDistance={9} maxDistance={26} minPolarAngle={.2} maxPolarAngle={1.2} enableDamping dampingFactor={.12} />
  </>;
}

export default function Board3D({ quality, onTooSlow }: { quality: 'high' | 'low'; onTooSlow: () => void }) {
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null);
  const [dpr, setDpr] = useState(() => Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1));
  useEffect(() => {
    const listener = (event: Event) => setSnapshot((event as CustomEvent<BoardSnapshot>).detail);
    document.addEventListener('mw:board-state', listener);
    document.dispatchEvent(new CustomEvent('mw:board-request'));
    return () => document.removeEventListener('mw:board-state', listener);
  }, []);
  // Tiles open their deed through the 2D board's own button, so behaviour is identical in both views.
  const pick = (id: number) => (document.querySelector('#game-board .board-tile[data-id="' + id + '"]') as HTMLElement | null)?.click();
  const maxDpr = Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
  return <div className="board-3d-stage" aria-label="3D tabletop view of the Market Wars board. Drag to look around; tap a space for its deed.">
    <Canvas shadows={{ type: quality === 'high' ? THREE.VSMShadowMap : THREE.PCFSoftShadowMap }} frameloop="demand" dpr={dpr}
      // Development only: lets the Playwright scripts inspect the scene.
      onCreated={state => { if (process.env.NODE_ENV !== 'production') (window as unknown as { __mw3d: unknown }).__mw3d = state; }}
      gl={{ antialias: true, powerPreference: 'high-performance' }} camera={{ fov: 32, near: .5, far: 80, position: [0, 12, 10] }}>
      <PerformanceMonitor onDecline={() => setDpr(1)} onIncline={() => setDpr(maxDpr)} flipflops={3} onFallback={onTooSlow}>
        <Suspense fallback={null}>{snapshot && <Scene snapshot={snapshot} quality={quality} onPick={pick} />}</Suspense>
      </PerformanceMonitor>
    </Canvas>
  </div>;
}
