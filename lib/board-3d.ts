/**
 * board-3d.ts
 * Three.js 3D board renderer for Market Wars.
 *
 * Replaces the CSS-grid board with a perspective 3D scene:
 *  - Raised tile geometry with colour-coded district strips
 *  - Animated 3D dice with real pip geometry
 *  - 3D player tokens (capped cylinders) that glide between tiles
 *  - Orbit controls (drag to rotate, scroll to zoom, right-drag to pan)
 *  - Click-to-select tile (fires the same data-action="inspect" flow)
 *  - "Top-down" reset button to snap back to the default view
 *
 * The module is intentionally self-contained: it exports a single
 * `createBoard3D(container, board, groups, onSelect)` factory that returns
 * a controller object consumed by game-ui.js.
 */

import * as THREE from 'three';

// ─── types ────────────────────────────────────────────────────────────────────

export interface SpaceData {
  id: number;
  name: string;
  type: string;
  group?: string;
  price?: number;
  symbol?: string;
}

export interface GroupData {
  name: string;
  color: string;
}

export interface TokenState {
  id: number;
  position: number; // board space index 0-39
  color: string;
  token: string;    // emoji key – used for label only
  bankrupt: boolean;
  active: boolean;
}

export interface AssetState {
  owner: number | null;
  buildings: number;       // 0-5
  mortgaged: boolean;
  ownerColor?: string;
}

export interface Board3DController {
  /** Called once to set up the initial scene inside `container`. */
  init(): void;
  /** Update tile ownership / buildings / selection highlight. */
  updateTiles(assets: Record<number, AssetState>, selectedId: number): void;
  /** Move / create token pieces.  */
  updateTokens(tokens: TokenState[], movementSpeedMultiplier: number): void;
  /** Animate dice roll then settle on final values. */
  rollDice(values: [number, number], phase: 'rolling' | 'settled'): void;
  /** Show dice with fixed values (no animation). */
  setDice(values: [number, number]): void;
  /** Resize the renderer when the container changes size. */
  resize(): void;
  /** Snap camera back to the default angled perspective. */
  resetCamera(): void;
  /** Snap camera to a top-down bird's-eye view. */
  topCamera(): void;
  /** Clean up WebGL resources. */
  destroy(): void;
}

// ─── constants ────────────────────────────────────────────────────────────────

const BOARD_SIZE = 11;        // 11×11 grid cells
const TILE_W     = 1.0;       // world-units per cell
const TILE_GAP   = 0.04;
const CORNER_W   = 1.5 * TILE_W;
const SIDE_W     = TILE_W;
const TILE_H     = 0.18;      // height of the raised tile block
const STRIP_H    = 0.06;      // colour strip on purchasable tiles
const BOARD_BASE = 0.08;      // thickness of the green felt base

const CAMERA_DEFAULT = new THREE.Vector3(0, 14, 10);
const CAMERA_TARGET  = new THREE.Vector3(0, 0, 0);

// ─── helpers ─────────────────────────────────────────────────────────────────

function hexToThree(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

/** Convert board-space id (0–39) to a grid [row, col] in the 11×11 matrix. */
function spaceToGrid(id: number): [number, number] {
  if (id <= 10)  return [10, 10 - id];
  if (id <= 20)  return [20 - id, 0];
  if (id <= 30)  return [0, id - 20];
  return [id - 30, 10];
}

/** Map grid [row, col] to world XZ (Y is up in Three.js). */
function gridToWorld(row: number, col: number, w: number, d: number): [number, number] {
  // Board occupies roughly [-5.5, 5.5] on both X and Z
  const totalW = CORNER_W + 9 * SIDE_W + CORNER_W;
  const originX = -totalW / 2;
  const originZ = -totalW / 2;
  return [originX + col * TILE_W + w / 2, originZ + row * TILE_W + d / 2];
}

/** Tile dimensions vary: corners are larger. */
function tileDims(id: number): [number, number] {
  const isCorner = id % 10 === 0;
  const size = isCorner ? CORNER_W : SIDE_W;
  return [size - TILE_GAP, size - TILE_GAP];
}

// ─── pip positions for each die face (UV in ±0.28 space) ─────────────────────

const PIP_LAYOUTS: [number, number][][] = [
  [],                                                              // 0 placeholder
  [[0, 0]],                                                        // 1
  [[-0.28, -0.28], [0.28, 0.28]],                                  // 2
  [[-0.28, -0.28], [0, 0], [0.28, 0.28]],                         // 3
  [[-0.28, -0.28], [0.28, -0.28], [-0.28, 0.28], [0.28, 0.28]],  // 4
  [[-0.28, -0.28], [0.28, -0.28], [0, 0], [-0.28, 0.28], [0.28, 0.28]], // 5
  [[-0.28, -0.28], [0.28, -0.28], [-0.28, 0], [0.28, 0], [-0.28, 0.28], [0.28, 0.28]], // 6
];

// ─── main factory ─────────────────────────────────────────────────────────────

export function createBoard3D(
  container: HTMLElement,
  board: SpaceData[],
  groups: Record<string, GroupData>,
  onSelect: (spaceId: number) => void,
): Board3DController {

  // ── scene setup ─────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0e1117');
  scene.fog = new THREE.Fog('#0e1117', 30, 60);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.copy(CAMERA_DEFAULT);
  camera.lookAt(CAMERA_TARGET);

  // ── lights ───────────────────────────────────────────────────────────────────
  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff5e0, 1.6);
  sun.position.set(8, 18, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 50;
  sun.shadow.camera.left = -14;
  sun.shadow.camera.right = 14;
  sun.shadow.camera.top = 14;
  sun.shadow.camera.bottom = -14;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0xb0c8ff, 0.5);
  fill.position.set(-10, 6, -6);
  scene.add(fill);

  // ── board base ───────────────────────────────────────────────────────────────
  const totalW = CORNER_W + 9 * SIDE_W + CORNER_W; // 12.0
  const baseGeo = new THREE.BoxGeometry(totalW + 0.3, BOARD_BASE, totalW + 0.3);
  const baseMat = new THREE.MeshLambertMaterial({ color: '#1a3320' });
  const baseMesh = new THREE.Mesh(baseGeo, baseMat);
  baseMesh.position.y = -BOARD_BASE / 2 - 0.001;
  baseMesh.receiveShadow = true;
  scene.add(baseMesh);

  // subtle grid lines on the felt
  const gridHelper = new THREE.GridHelper(totalW, 11, '#223322', '#1e2e1e');
  gridHelper.position.y = 0.001;
  scene.add(gridHelper);

  // ── tile meshes ──────────────────────────────────────────────────────────────

  const tileMeshes: Map<number, THREE.Mesh> = new Map();
  const stripMeshes: Map<number, THREE.Mesh> = new Map();
  const tileClickTargets: THREE.Mesh[] = []; // for raycasting

  const tileMat = (color: string | number, emissive = 0x000000) =>
    new THREE.MeshLambertMaterial({ color, emissive });

  const BASE_TILE_COLOR  = '#e8e0d0';
  const CORNER_COLOR     = '#d0cfc8';
  const SPECIAL_COLOR    = '#c8d4c0';

  board.forEach(space => {
    const [row, col] = spaceToGrid(space.id);
    const [w, d]     = tileDims(space.id);
    const [wx, wz]   = gridToWorld(row, col, w, d);

    const isCorner  = space.id % 10 === 0;
    const isSpecial = !space.price;
    const baseColor = isCorner ? CORNER_COLOR : isSpecial ? SPECIAL_COLOR : BASE_TILE_COLOR;

    // Main tile body
    const geo  = new THREE.BoxGeometry(w, TILE_H, d);
    const mat  = tileMat(baseColor);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(wx, TILE_H / 2, wz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { spaceId: space.id };
    scene.add(mesh);
    tileMeshes.set(space.id, mesh);
    tileClickTargets.push(mesh);

    // Colour strip on purchasable tiles (top surface, near the outer edge)
    if (space.price && space.group && groups[space.group]) {
      const groupColor = groups[space.group].color;
      const stripDepth = d * 0.28;
      const stripGeo   = new THREE.BoxGeometry(w - 0.02, STRIP_H, stripDepth);
      const stripMat   = new THREE.MeshLambertMaterial({ color: hexToThree(groupColor) });
      const stripMesh  = new THREE.Mesh(stripGeo, stripMat);

      // Determine which edge faces outward
      let stripZ = wz;
      if (row === 10) stripZ += (d / 2) - (stripDepth / 2) - 0.01;   // south
      else if (row === 0) stripZ -= (d / 2) - (stripDepth / 2) - 0.01; // north
      else if (col === 0) { /* handled below */ }
      else if (col === 10) { /* handled below */ }

      let stripX = wx;
      if (col === 0)  stripX -= (w / 2) - (stripDepth / 2) - 0.01;  // west → swap axes
      if (col === 10) stripX += (w / 2) - (stripDepth / 2) - 0.01;  // east

      if (col === 0 || col === 10) {
        // Reorient: strip runs along X axis for vertical sides
        const sGeo2 = new THREE.BoxGeometry(stripDepth, STRIP_H, d - 0.02);
        const sm2   = new THREE.Mesh(sGeo2, stripMat);
        sm2.position.set(stripX, TILE_H + STRIP_H / 2, wz);
        sm2.castShadow = false;
        scene.add(sm2);
        stripMeshes.set(space.id, sm2);
      } else {
        stripMesh.position.set(wx, TILE_H + STRIP_H / 2, stripZ);
        stripMesh.castShadow = false;
        scene.add(stripMesh);
        stripMeshes.set(space.id, stripMesh);
      }
    }

    // Special-space symbol – tiny flat cylinder as a "token pad"
    if (!space.price && !isCorner) {
      const padGeo = new THREE.CylinderGeometry(w * 0.22, w * 0.22, 0.03, 16);
      const padMat = new THREE.MeshLambertMaterial({ color: '#334433' });
      const pad    = new THREE.Mesh(padGeo, padMat);
      pad.position.set(wx, TILE_H + 0.015, wz);
      scene.add(pad);
    }

    // Building slots: tiny raised platforms (filled in updateTiles)
    mesh.userData.buildings = 0;
  });

  // ── building objects ─────────────────────────────────────────────────────────

  const buildingObjects: Map<number, THREE.Object3D[]> = new Map();

  function clearBuildings(spaceId: number) {
    const objs = buildingObjects.get(spaceId) || [];
    objs.forEach(o => scene.remove(o));
    buildingObjects.set(spaceId, []);
  }

  function addBuildings(spaceId: number, count: number, color: string) {
    clearBuildings(spaceId);
    if (count === 0) return;
    const [row, col] = spaceToGrid(spaceId);
    const [w, d]     = tileDims(spaceId);
    const [wx, wz]   = gridToWorld(row, col, w, d);
    const objs: THREE.Object3D[] = [];

    if (count === 5) {
      // Commercial tower
      const h   = 1.1;
      const geo = new THREE.BoxGeometry(w * 0.38, h, d * 0.38);
      const mat = new THREE.MeshLambertMaterial({ color, emissive: hexToThree(color).multiplyScalar(0.12) });
      const m   = new THREE.Mesh(geo, mat);
      m.position.set(wx, TILE_H + h / 2, wz);
      m.castShadow = true;
      scene.add(m);
      objs.push(m);

      // Roof accent
      const rGeo = new THREE.BoxGeometry(w * 0.42, 0.06, d * 0.42);
      const rMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
      const r    = new THREE.Mesh(rGeo, rMat);
      r.position.set(wx, TILE_H + h + 0.03, wz);
      scene.add(r);
      objs.push(r);
    } else {
      // Houses — evenly spaced along the tile
      const houseW = Math.min((w - 0.1) / count - 0.04, 0.22);
      const houseH = 0.25 + count * 0.04;
      for (let i = 0; i < count; i++) {
        const offset = count === 1 ? 0 : (i / (count - 1) - 0.5) * (w - 0.18);
        const geo    = new THREE.BoxGeometry(houseW, houseH, d * 0.32);
        const mat    = new THREE.MeshLambertMaterial({ color, emissive: hexToThree(color).multiplyScalar(0.1) });
        const m      = new THREE.Mesh(geo, mat);
        // houses sit along the tile's inner edge
        const houseOffset = row === 10 ? -(d * 0.28) : row === 0 ? (d * 0.28) : 0;
        const houseOffsetX = col === 0 ? (w * 0.28) : col === 10 ? -(w * 0.28) : 0;
        m.position.set(wx + offset + houseOffsetX, TILE_H + houseH / 2, wz + houseOffset);
        m.castShadow = true;
        scene.add(m);
        objs.push(m);
      }
    }
    buildingObjects.set(spaceId, objs);
  }

  // ── owner mark ring ──────────────────────────────────────────────────────────

  const ownerRings: Map<number, THREE.Mesh> = new Map();

  function setOwnerRing(spaceId: number, color: string | null) {
    if (ownerRings.has(spaceId)) {
      scene.remove(ownerRings.get(spaceId)!);
      ownerRings.delete(spaceId);
    }
    if (!color) return;
    const [row, col] = spaceToGrid(spaceId);
    const [w, d]     = tileDims(spaceId);
    const [wx, wz]   = gridToWorld(row, col, w, d);
    const geo = new THREE.RingGeometry(Math.min(w, d) * 0.38, Math.min(w, d) * 0.46, 32);
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    const m   = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(wx, TILE_H + 0.005, wz);
    scene.add(m);
    ownerRings.set(spaceId, m);
  }

  // ── selection highlight ──────────────────────────────────────────────────────

  let selectedHighlight: THREE.Mesh | null = null;

  function setSelection(spaceId: number) {
    if (selectedHighlight) scene.remove(selectedHighlight);
    const [row, col] = spaceToGrid(spaceId);
    const [w, d]     = tileDims(spaceId);
    const [wx, wz]   = gridToWorld(row, col, w, d);
    const geo = new THREE.BoxGeometry(w + 0.06, 0.02, d + 0.06);
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.18 });
    const m   = new THREE.Mesh(geo, mat);
    m.position.set(wx, TILE_H + 0.01, wz);
    scene.add(m);
    selectedHighlight = m;
  }

  // ── player tokens ─────────────────────────────────────────────────────────

  const tokenMeshes: Map<number, THREE.Group> = new Map();

  function ensureToken(t: TokenState): THREE.Group {
    if (tokenMeshes.has(t.id)) return tokenMeshes.get(t.id)!;

    const group = new THREE.Group();

    // Base cylinder
    const bodyGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.38, 20);
    const bodyMat = new THREE.MeshLambertMaterial({
      color: hexToThree(t.color),
      emissive: hexToThree(t.color).multiplyScalar(0.15),
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.castShadow = true;
    group.add(body);

    // Dome cap
    const capGeo = new THREE.SphereGeometry(0.18, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const capMat = new THREE.MeshLambertMaterial({
      color: hexToThree(t.color).clone().addScalar(0.08),
    });
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.y = 0.19;
    cap.castShadow = true;
    group.add(cap);

    // Glowing ring for active player
    const ringGeo = new THREE.TorusGeometry(0.24, 0.03, 8, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0 });
    const ring    = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;
    ring.name = 'activeRing';
    group.add(ring);

    scene.add(group);
    tokenMeshes.set(t.id, group);
    return group;
  }

  // ── 3D dice ──────────────────────────────────────────────────────────────────

  const DIE_SIZE = 0.55;
  type DieGroup = THREE.Group & { _spin?: { vx: number; vy: number; vz: number }; _value?: number };

  const diceGroups: [DieGroup, DieGroup] = [new THREE.Group() as DieGroup, new THREE.Group() as DieGroup];
  let diceAnimating = false;
  let diceAnimId    = 0;

  function buildDie(group: DieGroup) {
    group.clear();
    const geo = new THREE.BoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE, 1, 1, 1);
    const mat = new THREE.MeshLambertMaterial({ color: '#f8f4e8' });
    const body = new THREE.Mesh(geo, mat);
    body.castShadow = true;
    group.add(body);

    // Rounded edges hint via outline
    const edges = new THREE.EdgesGeometry(geo);
    const eMat  = new THREE.LineBasicMaterial({ color: '#c8c0a8', linewidth: 1 });
    group.add(new THREE.LineSegments(edges, eMat));

    // Pip spheres for all 6 faces
    const pipMat = new THREE.MeshLambertMaterial({ color: '#1a1a1a' });
    const faceNormals: [THREE.Vector3, number][] = [
      [new THREE.Vector3(0, 1, 0), 1],  // top → 1
      [new THREE.Vector3(0, -1, 0), 6], // bottom → 6
      [new THREE.Vector3(1, 0, 0), 3],  // right → 3
      [new THREE.Vector3(-1, 0, 0), 4], // left → 4
      [new THREE.Vector3(0, 0, 1), 2],  // front → 2
      [new THREE.Vector3(0, 0, -1), 5], // back → 5
    ];

    faceNormals.forEach(([normal, faceValue]) => {
      const layout = PIP_LAYOUTS[faceValue];
      layout.forEach(([u, v]) => {
        const pipGeo  = new THREE.SphereGeometry(0.055, 8, 8);
        const pipMesh = new THREE.Mesh(pipGeo, pipMat);
        // Place pip on the face: normal * half-size + uv tangents
        const tangentU = new THREE.Vector3();
        const tangentV = new THREE.Vector3();
        if (Math.abs(normal.y) > 0.5) {
          tangentU.set(1, 0, 0);
          tangentV.set(0, 0, 1);
        } else if (Math.abs(normal.x) > 0.5) {
          tangentU.set(0, 1, 0);
          tangentV.set(0, 0, 1);
        } else {
          tangentU.set(1, 0, 0);
          tangentV.set(0, 1, 0);
        }
        pipMesh.position.copy(
          normal.clone().multiplyScalar(DIE_SIZE / 2 + 0.012)
            .add(tangentU.clone().multiplyScalar(u))
            .add(tangentV.clone().multiplyScalar(v))
        );
        pipMesh.castShadow = false;
        group.add(pipMesh);
      });
    });
  }

  /** Rotate die so face `value` points upward. */
  function orientDie(group: DieGroup, value: number) {
    group.rotation.set(0, 0, 0);
    // Mapping: face normals were assigned top=1,front=2,right=3,left=4,back=5,bottom=6
    const rotations: Record<number, [number, number, number]> = {
      1: [0, 0, 0],
      6: [Math.PI, 0, 0],
      2: [-Math.PI / 2, 0, 0],
      5: [Math.PI / 2, 0, 0],
      3: [0, 0, -Math.PI / 2],
      4: [0, 0, Math.PI / 2],
    };
    const [rx, ry, rz] = rotations[value] || [0, 0, 0];
    group.rotation.set(rx, ry, rz);
  }

  // Position dice to the right of the board center
  function positionDice() {
    diceGroups[0].position.set(0.7, TILE_H + DIE_SIZE / 2 + 0.05, 0.2);
    diceGroups[1].position.set(-0.7, TILE_H + DIE_SIZE / 2 + 0.05, 0.2);
  }

  diceGroups.forEach(g => {
    buildDie(g);
    scene.add(g);
  });
  positionDice();

  let diceValues: [number, number] = [1, 1];

  function animateDice(values: [number, number]) {
    diceAnimating = true;
    const startTime = performance.now();
    const duration  = 900;
    const id        = ++diceAnimId;

    // Give each die a random spin velocity
    diceGroups.forEach(g => {
      (g as DieGroup)._spin = {
        vx: (Math.random() - 0.5) * 14,
        vy: (Math.random() - 0.5) * 14,
        vz: (Math.random() - 0.5) * 14,
      };
    });

    function tick() {
      if (id !== diceAnimId) return;
      const elapsed = performance.now() - startTime;
      const t       = Math.min(elapsed / duration, 1);
      // Ease out
      const eased   = 1 - Math.pow(1 - t, 3);

      diceGroups.forEach(g => {
        const spin = (g as DieGroup)._spin!;
        const scale = 1 - eased * 0.85;
        g.rotation.x += spin.vx * (1 - eased) * 0.016;
        g.rotation.y += spin.vy * (1 - eased) * 0.016;
        g.rotation.z += spin.vz * (1 - eased) * 0.016;
        g.position.y  = TILE_H + DIE_SIZE / 2 + 0.05 + Math.sin(eased * Math.PI) * 1.2 * scale;
      });

      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        diceAnimating = false;
        diceValues    = values;
        diceGroups.forEach((g, i) => {
          orientDie(g, values[i]);
          positionDice();
        });
      }
    }
    requestAnimationFrame(tick);
  }

  // ── orbit controls (manual, no external dep) ─────────────────────────────────

  let orbiting  = false;
  let panning   = false;
  let lastMouse = { x: 0, y: 0 };
  // Spherical coords
  let phi       = Math.atan2(CAMERA_DEFAULT.z, Math.sqrt(CAMERA_DEFAULT.x ** 2 + CAMERA_DEFAULT.z ** 2)); // elevation
  let theta     = 0; // azimuth
  let radius    = CAMERA_DEFAULT.distanceTo(CAMERA_TARGET);
  const panTarget = new THREE.Vector3();

  function updateCamera() {
    const x = radius * Math.cos(phi) * Math.sin(theta);
    const y = radius * Math.sin(phi);
    const z = radius * Math.cos(phi) * Math.cos(theta);
    camera.position.set(
      x + panTarget.x,
      Math.max(y, 2),
      z + panTarget.z,
    );
    camera.lookAt(panTarget);
  }

  function onMouseDown(e: MouseEvent) {
    if (e.button === 2) { panning = true; }
    else { orbiting = true; }
    lastMouse = { x: e.clientX, y: e.clientY };
  }
  function onMouseMove(e: MouseEvent) {
    const dx = e.clientX - lastMouse.x;
    const dy = e.clientY - lastMouse.y;
    lastMouse = { x: e.clientX, y: e.clientY };
    if (orbiting) {
      theta -= dx * 0.008;
      phi    = Math.max(0.18, Math.min(Math.PI / 2 - 0.04, phi - dy * 0.006));
      updateCamera();
    }
    if (panning) {
      panTarget.x -= dx * 0.018;
      panTarget.z -= dy * 0.018;
      updateCamera();
    }
  }
  function onMouseUp()    { orbiting = false; panning = false; }
  function onWheel(e: WheelEvent) {
    radius = Math.max(5, Math.min(30, radius + e.deltaY * 0.022));
    updateCamera();
    e.preventDefault();
  }

  // Touch support
  let lastTouchDist = 0;
  function onTouchStart(e: TouchEvent) {
    if (e.touches.length === 1) {
      orbiting  = true;
      lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      lastTouchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
    }
  }
  function onTouchMove(e: TouchEvent) {
    if (e.touches.length === 1 && orbiting) {
      const dx = e.touches[0].clientX - lastMouse.x;
      const dy = e.touches[0].clientY - lastMouse.y;
      lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      theta -= dx * 0.008;
      phi    = Math.max(0.18, Math.min(Math.PI / 2 - 0.04, phi - dy * 0.006));
      updateCamera();
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      radius = Math.max(5, Math.min(30, radius - (dist - lastTouchDist) * 0.06));
      lastTouchDist = dist;
      updateCamera();
      e.preventDefault();
    }
  }
  function onTouchEnd() { orbiting = false; }

  const canvas = renderer.domElement;
  canvas.addEventListener('mousedown',  onMouseDown,  { passive: true });
  canvas.addEventListener('mousemove',  onMouseMove,  { passive: true });
  canvas.addEventListener('mouseup',    onMouseUp,    { passive: true });
  canvas.addEventListener('mouseleave', onMouseUp,    { passive: true });
  canvas.addEventListener('wheel',      onWheel,      { passive: false });
  canvas.addEventListener('touchstart', onTouchStart, { passive: true });
  canvas.addEventListener('touchmove',  onTouchMove,  { passive: false });
  canvas.addEventListener('touchend',   onTouchEnd,   { passive: true });
  canvas.setAttribute('tabindex', '0');

  // Initialise spherical coords from default camera position
  phi    = Math.asin(CAMERA_DEFAULT.y / CAMERA_DEFAULT.length());
  theta  = Math.atan2(CAMERA_DEFAULT.x, CAMERA_DEFAULT.z);
  radius = CAMERA_DEFAULT.length();
  updateCamera();

  // ── raycasting / click-to-select ─────────────────────────────────────────────

  const raycaster = new THREE.Raycaster();
  const mouse2d   = new THREE.Vector2();
  let   mouseHasMoved = false;

  canvas.addEventListener('mousedown', () => { mouseHasMoved = false; });
  canvas.addEventListener('mousemove', () => { mouseHasMoved = true; });
  canvas.addEventListener('mouseup', (e: MouseEvent) => {
    if (mouseHasMoved || e.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    mouse2d.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    mouse2d.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse2d, camera);
    const hits = raycaster.intersectObjects(tileClickTargets);
    if (hits.length > 0) {
      const spaceId = hits[0].object.userData.spaceId as number;
      onSelect(spaceId);
    }
  });

  // ── render loop ──────────────────────────────────────────────────────────────

  let rafId = 0;
  let lastTime = 0;

  function animate(time: number) {
    rafId = requestAnimationFrame(animate);
    const delta = (time - lastTime) / 1000;
    lastTime    = time;

    // Gently bob active tokens
    tokenMeshes.forEach((group, id) => {
      const ring = group.getObjectByName('activeRing') as THREE.Mesh | undefined;
      if (!ring) return;
      const mat = ring.material as THREE.MeshBasicMaterial;
      if (mat.opacity > 0.01) {
        group.position.y += Math.sin(time * 0.003) * 0.0008;
      }
    });

    renderer.render(scene, camera);
  }
  rafId = requestAnimationFrame(animate);

  // ── resize ───────────────────────────────────────────────────────────────────

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight || w;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // ── token placement ──────────────────────────────────────────────────────────

  const tokenTargets: Map<number, THREE.Vector3> = new Map();
  const tokenVelocities: Map<number, THREE.Vector3> = new Map();

  function tokenWorldPos(spaceId: number, index: number, total: number): THREE.Vector3 {
    const [row, col] = spaceToGrid(spaceId);
    const [w, d]     = tileDims(spaceId);
    const [wx, wz]   = gridToWorld(row, col, w, d);
    const offsetX = total > 1 ? (index % 2 === 0 ? -0.22 : 0.22) : 0;
    const offsetZ = total > 2 ? (index < 2    ? -0.18 : 0.18)    : 0;
    return new THREE.Vector3(wx + offsetX, TILE_H + 0.19, wz + offsetZ);
  }

  // ── public API ───────────────────────────────────────────────────────────────

  function init() {
    resize();
  }

  function updateTiles(assets: Record<number, AssetState>, selectedId: number) {
    board.forEach(space => {
      if (!space.price) return;
      const asset = assets[space.id];
      if (!asset) return;

      // Owner ring
      setOwnerRing(space.id, asset.ownerColor ?? null);

      // Buildings
      if (asset.buildings !== (tileMeshes.get(space.id)?.userData.buildings ?? -1)) {
        tileMeshes.get(space.id)!.userData.buildings = asset.buildings;
        const groupColor = space.group && groups[space.group] ? groups[space.group].color : '#888888';
        if (asset.buildings > 0 && !asset.mortgaged) {
          addBuildings(space.id, asset.buildings, groupColor);
        } else {
          clearBuildings(space.id);
        }
      }

      // Tile surface tint for mortgaged
      const tileMesh = tileMeshes.get(space.id);
      if (tileMesh) {
        const mat = tileMesh.material as THREE.MeshLambertMaterial;
        mat.color.set(asset.mortgaged ? '#9e9e9e' : BASE_TILE_COLOR);
      }
    });
    setSelection(selectedId);
  }

  function updateTokens(tokens: TokenState[], speedMult = 1) {
    // Ensure all token groups exist
    tokens.forEach(t => {
      if (!t.bankrupt) ensureToken(t);
    });

    // Group tokens by position for offset calculation
    const byPosition: Map<number, TokenState[]> = new Map();
    tokens.forEach(t => {
      if (t.bankrupt) return;
      const list = byPosition.get(t.position) || [];
      list.push(t);
      byPosition.set(t.position, list);
    });

    tokens.forEach(t => {
      const group = tokenMeshes.get(t.id);
      if (!group) return;
      group.visible = !t.bankrupt;
      if (t.bankrupt) return;

      const list  = byPosition.get(t.position) || [t];
      const index = list.findIndex(x => x.id === t.id);
      const target = tokenWorldPos(t.position, index, list.length);
      tokenTargets.set(t.id, target);

      // Active ring opacity
      const ring = group.getObjectByName('activeRing') as THREE.Mesh | undefined;
      if (ring) {
        (ring.material as THREE.MeshBasicMaterial).opacity = t.active ? 0.9 : 0;
      }

      // Body emissive pulse for active player
      const body = group.children[0] as THREE.Mesh;
      if (body) {
        const mat = body.material as THREE.MeshLambertMaterial;
        mat.emissive.set(t.active
          ? hexToThree(t.color).multiplyScalar(0.3)
          : hexToThree(t.color).multiplyScalar(0.1));
      }
    });

    // Animate tokens toward targets in the next few frames
    const duration = Math.max(80, 150 / speedMult);
    let elapsed    = 0;
    const startPositions: Map<number, THREE.Vector3> = new Map();
    tokens.forEach(t => {
      const g = tokenMeshes.get(t.id);
      if (g) startPositions.set(t.id, g.position.clone());
    });

    function moveStep() {
      elapsed += 16;
      const progress = Math.min(elapsed / duration, 1);
      const ease     = 1 - Math.pow(1 - progress, 3);
      let allDone    = true;
      tokens.forEach(t => {
        const g      = tokenMeshes.get(t.id);
        const target = tokenTargets.get(t.id);
        const start  = startPositions.get(t.id);
        if (!g || !target || !start) return;
        g.position.lerpVectors(start, target, ease);
        if (progress < 1) allDone = false;
      });
      if (!allDone) setTimeout(moveStep, 16);
    }
    setTimeout(moveStep, 0);
  }

  function rollDice(values: [number, number], phase: 'rolling' | 'settled') {
    if (phase === 'rolling') {
      animateDice(values);
    } else {
      diceAnimating = false;
      diceAnimId++;
      diceValues = values;
      diceGroups.forEach((g, i) => {
        orientDie(g, values[i]);
        positionDice();
      });
    }
  }

  function setDice(values: [number, number]) {
    diceAnimId++;
    diceAnimating = false;
    diceValues    = values;
    diceGroups.forEach((g, i) => {
      orientDie(g, values[i]);
      positionDice();
    });
  }

  function resetCamera() {
    phi    = Math.asin(CAMERA_DEFAULT.y / CAMERA_DEFAULT.length());
    theta  = Math.atan2(CAMERA_DEFAULT.x, CAMERA_DEFAULT.z);
    radius = CAMERA_DEFAULT.length();
    panTarget.set(0, 0, 0);
    updateCamera();
  }

  function topCamera() {
    phi    = Math.PI / 2 - 0.04; // near-vertical, just shy of the gimbal limit
    theta  = 0;
    radius = 17;
    panTarget.set(0, 0, 0);
    updateCamera();
  }

  function destroy() {
    cancelAnimationFrame(rafId);
    canvas.removeEventListener('mousedown',  onMouseDown);
    canvas.removeEventListener('mousemove',  onMouseMove);
    canvas.removeEventListener('mouseup',    onMouseUp);
    canvas.removeEventListener('mouseleave', onMouseUp);
    canvas.removeEventListener('wheel',      onWheel);
    canvas.removeEventListener('touchstart', onTouchStart);
    canvas.removeEventListener('touchmove',  onTouchMove);
    canvas.removeEventListener('touchend',   onTouchEnd);
    renderer.dispose();
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }

  return { init, updateTiles, updateTokens, rollDice, setDice, resize, resetCamera, topCamera, destroy };
}
