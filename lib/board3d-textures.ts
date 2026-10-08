// Procedural textures for the 3D tabletop. Everything is drawn on a canvas from the game's own
// board data, so no external art is used. Board geometry matches the 2D board: 11 x 11 grid,
// corners 1.4 cells wide, spaces running anticlockwise from Launch in the lower-right corner.
import MarketWars from './game-engine.cjs';
import { spaceIconSVG } from './board-pieces';

type Space = { id: number; name: string; type: string; group?: string; price?: number; caption?: string };
const BOARD = (MarketWars as unknown as { BOARD: Space[] }).BOARD;
const GROUPS = (MarketWars as unknown as { GROUPS: Record<string, { name: string; color: string }> }).GROUPS;

export const CORNER = 1.4;
export const GRID = 2 * CORNER + 9; // 11.8 board cells across

export function gridCell(id: number) {
  if (id <= 10) return { row: 10, col: 10 - id };
  if (id <= 20) return { row: 20 - id, col: 0 };
  if (id <= 30) return { row: 0, col: id - 20 };
  return { row: id - 30, col: 10 };
}
const start = (index: number) => index === 0 ? 0 : CORNER + index - 1;
const span = (index: number) => index === 0 || index === 10 ? CORNER : 1;
export type Edge = 'south' | 'north' | 'west' | 'east' | 'corner';
/** A space's rectangle in board cells, x to the right and y down from the top-left corner. */
export function tileRect(id: number) {
  const { row, col } = gridCell(id);
  const edge: Edge = id % 10 === 0 ? 'corner' : row === 10 ? 'south' : col === 0 ? 'west' : row === 0 ? 'north' : 'east';
  return { x: start(col), y: start(row), w: span(col), h: span(row), edge };
}
export function tileAt(x: number, y: number) {
  for (let id = 0; id < 40; id++) {
    const r = tileRect(id);
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return id;
  }
  return null;
}
export const BAND = 0.24; // colour band depth, in cells

const ICON_STYLE = '<style>.icon-line{fill:none;stroke:#1d211d;stroke-linecap:round;stroke-linejoin:round}.icon-rim{fill:#c99a40;stroke:#6e4c16;stroke-width:1}.icon-enamel{fill:#1d3550}.icon-gold-fill{fill:#f0cf7c}</style>';
function iconImage(type: string): Promise<HTMLImageElement | null> {
  const svg = spaceIconSVG(type);
  if (!svg) return Promise.resolve(null);
  const source = svg.replace('<svg class="space-icon"', '<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192"').replace('aria-hidden="true">', 'aria-hidden="true">' + ICON_STYLE);
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image); image.onerror = () => resolve(null);
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source);
  });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const words = text.toUpperCase().split(' '), lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? line + ' ' + word : word;
    if (ctx.measureText(next).width > width && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
function grain(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number, seed = 7) {
  let s = seed;
  const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  ctx.save(); ctx.globalAlpha = alpha;
  for (let i = 0; i < (w * h) / 900; i++) {
    ctx.fillStyle = rand() > .5 ? '#5a4a2a' : '#ffffff';
    ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 1.6, 1 + rand() * 1.6);
  }
  ctx.restore();
}

/** The printed board face: cards, colour bands, names, prices, icons and the felt centre. */
export async function drawBoardFace(size: number) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!, cell = size / GRID;
  try { await document.fonts.load('700 40px "Barlow Condensed"'); await document.fonts.load('600 40px "Barlow Condensed"'); } catch { /* System font fallback. */ }
  const font = (weight: number, px: number) => weight + ' ' + Math.round(px) + 'px "Barlow Condensed", "Arial Narrow", system-ui, sans-serif';
  const icons = new Map<string, HTMLImageElement | null>();
  await Promise.all([...new Set(BOARD.filter(space => !space.price || ['transport', 'utility'].includes(space.type)).map(space => space.type))].map(async type => icons.set(type, await iconImage(type))));

  // Board bed (the gaps between cards read as dark lines).
  ctx.fillStyle = '#21160d'; ctx.fillRect(0, 0, size, size);

  // Felt centre with a soft vignette and a brass inlay line.
  const c0 = CORNER * cell, c1 = (GRID - CORNER) * cell, gap = cell * .04;
  const felt = ctx.createRadialGradient(size * .42, size * .38, size * .05, size / 2, size / 2, size * .55);
  felt.addColorStop(0, '#2c5f5e'); felt.addColorStop(.6, '#1d4646'); felt.addColorStop(1, '#122e2f');
  ctx.fillStyle = felt; ctx.fillRect(c0 + gap, c0 + gap, c1 - c0 - gap * 2, c1 - c0 - gap * 2);
  grain(ctx, size, size, .025, 3);
  ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = cell * .035;
  ctx.strokeRect(c0 + cell * .35, c0 + cell * .35, c1 - c0 - cell * .7, c1 - c0 - cell * .7);

  // Wordmark plaque, tilted like the 2D board's.
  ctx.save(); ctx.translate(size / 2, size / 2 + cell * .2); ctx.rotate(-.21);
  const pw = cell * 4.6, ph = cell * 1.05;
  const gold = ctx.createLinearGradient(-pw / 2, -ph / 2, pw / 2, ph / 2);
  ['#fff1bd', '#e2bb62', '#a77b2d', '#f0cf7c', '#8a6224'].forEach((color, i) => gold.addColorStop(i / 4, color));
  ctx.fillStyle = gold; ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
  ctx.fillStyle = '#163a3a'; ctx.fillRect(-pw / 2 + cell * .09, -ph / 2 + cell * .09, pw - cell * .18, ph - cell * .18);
  ctx.fillStyle = '#e9c66c'; ctx.font = font(800, cell * .72); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('MARKET WARS', 0, cell * .04);
  ctx.restore();
  ctx.fillStyle = '#d9c38c'; ctx.font = font(600, cell * .26); ctx.textAlign = 'center';
  ctx.fillText('NORTHSTAR CITY · BUY · BUILD · TRADE', size / 2, size / 2 + cell * 1.55);

  // Spaces
  for (const space of BOARD) {
    const r = tileRect(space.id), x = r.x * cell + gap, y = r.y * cell + gap, w = r.w * cell - gap * 2, h = r.h * cell - gap * 2;
    const service = ['transport', 'utility'].includes(space.type);
    const card = ctx.createLinearGradient(x, y, x + w, y + h);
    if (service) { card.addColorStop(0, '#eef0ea'); card.addColorStop(1, '#cbd2cc'); }
    else if (r.edge === 'corner') { card.addColorStop(0, '#fffcf1'); card.addColorStop(1, '#e2d0a6'); }
    else { card.addColorStop(0, '#f7efda'); card.addColorStop(1, '#e6d9b8'); }
    ctx.fillStyle = card; ctx.fillRect(x, y, w, h);
    if (service) {
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.strokeStyle = '#1d2a2a14'; ctx.lineWidth = cell * .02;
      for (let d = -h; d < w; d += cell * .09) { ctx.beginPath(); ctx.moveTo(x + d, y + h); ctx.lineTo(x + d + h, y); ctx.stroke(); }
      ctx.restore();
    }
    // Main area = card minus the band and building zone on the inner edge.
    let ax = x, ay = y, aw = w, ah = h;
    const zone = BAND + .28;
    if (space.type === 'property') {
      ctx.fillStyle = GROUPS[space.group!].color;
      const b = BAND * cell;
      if (r.edge === 'south') ctx.fillRect(x, y, w, b);
      if (r.edge === 'north') ctx.fillRect(x, y + h - b, w, b);
      if (r.edge === 'west') ctx.fillRect(x + w - b, y, b, h);
      if (r.edge === 'east') ctx.fillRect(x, y, b, h);
      ctx.fillStyle = '#ffffff40';
      if (r.edge === 'south') ctx.fillRect(x, y, w, b * .3);
      if (r.edge === 'north') ctx.fillRect(x, y + h - b, w, b * .3);
    }
    if (r.edge !== 'corner' && (space.type === 'property' || service)) {
      if (r.edge === 'south') { ay += zone * cell; ah -= zone * cell; }
      if (r.edge === 'north') ah -= zone * cell;
      if (r.edge === 'west') aw -= zone * cell;
      if (r.edge === 'east') { ax += zone * cell; aw -= zone * cell; }
    }
    const corner = r.edge === 'corner', icon = icons.get(space.type);
    const lines: { text: string; px: number; weight: number; color: string }[] = [];
    ctx.font = font(700, cell * (corner ? .3 : .2));
    for (const line of wrap(ctx, space.name, aw * .9)) lines.push({ text: line, px: cell * (corner ? .3 : .2), weight: 700, color: '#17180f' });
    if (space.price) lines.push({ text: '$' + space.price, px: cell * .17, weight: 600, color: '#3a3221' });
    else if (space.caption) lines.push({ text: space.caption.toUpperCase(), px: cell * (corner ? .12 : .1), weight: 600, color: '#5d5340' });
    const iconSize = icon ? cell * (corner ? .6 : .34) : 0;
    const textHeight = lines.reduce((sum, line) => sum + line.px * 1.08, 0) + (icon ? iconSize + cell * .06 : 0);
    let cy = ay + ah / 2 - textHeight / 2;
    if (icon) { ctx.drawImage(icon, ax + aw / 2 - iconSize / 2, cy, iconSize, iconSize); cy += iconSize + cell * .06; }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const line of lines) { ctx.font = font(line.weight, line.px); ctx.fillStyle = line.color; ctx.fillText(line.text, ax + aw / 2, cy); cy += line.px * 1.08; }
  }
  grain(ctx, size, size, .03, 11);
  return canvas;
}

/** Walnut: long grain streaks with pores, plus a height map for a matching normal map. */
export function drawWood(size: number, base: [number, number, number] = [92, 52, 28], seed = 5) {
  const color = document.createElement('canvas'), height = document.createElement('canvas');
  color.width = height.width = size; color.height = height.height = size;
  const c = color.getContext('2d')!, hgt = height.getContext('2d')!;
  let s = seed; const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const img = c.createImageData(size, size), him = hgt.createImageData(size, size);
  const waves = Array.from({ length: 6 }, () => ({ f: .5 + rand() * 3, p: rand() * 6.28, a: 2 + rand() * 6 }));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const warp = waves.reduce((sum, w) => sum + Math.sin((x / size) * w.f * 6.28 + w.p) * w.a, 0);
    const ring = Math.sin((y + warp) * .19) * .5 + Math.sin((y + warp * 1.7) * .057) * .5;
    const pore = rand() < .025 ? -.35 : 0;
    const v = .78 + ring * .16 + pore * .4 + (rand() - .5) * .05;
    const i = (y * size + x) * 4;
    img.data[i] = base[0] * v; img.data[i + 1] = base[1] * v; img.data[i + 2] = base[2] * v; img.data[i + 3] = 255;
    const hv = 128 + ring * 40 + pore * 120;
    him.data[i] = him.data[i + 1] = him.data[i + 2] = hv; him.data[i + 3] = 255;
  }
  c.putImageData(img, 0, 0); hgt.putImageData(him, 0, 0);
  return { color, normal: normalFromHeight(height, 2.2) };
}

/** Sobel normal map from a greyscale height canvas. */
export function normalFromHeight(height: HTMLCanvasElement, strength: number) {
  const w = height.width, h = height.height, src = height.getContext('2d')!.getImageData(0, 0, w, h).data;
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const ctx = out.getContext('2d')!, img = ctx.createImageData(w, h);
  const at = (x: number, y: number) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const len = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    img.data[i] = (-dx / len * .5 + .5) * 255; img.data[i + 1] = (-dy / len * .5 + .5) * 255; img.data[i + 2] = (1 / len * .5 + .5) * 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/** Face of an event-card deck. */
export function drawCardFace(title: string, accent: string, glyph: string) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 352;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f4ecd6'; ctx.fillRect(0, 0, 512, 352);
  ctx.strokeStyle = accent; ctx.lineWidth = 14; ctx.strokeRect(18, 18, 476, 316);
  ctx.lineWidth = 3; ctx.strokeRect(38, 38, 436, 276);
  ctx.fillStyle = accent; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '700 92px "Barlow Condensed", "Arial Narrow", sans-serif'; ctx.fillText(glyph, 256, 132);
  ctx.font = '700 54px "Barlow Condensed", "Arial Narrow", sans-serif'; ctx.fillText(title, 256, 242);
  grain(ctx, 512, 352, .05, 21);
  return canvas;
}

/** Market Wars banknote. */
export function drawNote(amount: number, tint: string) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = tint; ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = '#00000055'; ctx.lineWidth = 6; ctx.strokeRect(14, 14, 484, 228);
  ctx.strokeStyle = '#ffffff70'; ctx.lineWidth = 2;
  for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.ellipse(256, 128, 40 + i * 9, 22 + i * 6, 0, 0, 6.29); ctx.stroke(); }
  ctx.fillStyle = '#1d2a28'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '800 76px "Barlow Condensed", "Arial Narrow", sans-serif'; ctx.fillText(String(amount), 256, 130);
  ctx.font = '700 30px "Barlow Condensed", "Arial Narrow", sans-serif';
  ctx.fillText(String(amount), 62, 52); ctx.fillText(String(amount), 450, 204);
  ctx.font = '600 22px "Barlow Condensed", "Arial Narrow", sans-serif'; ctx.fillText('MARKET WARS · NORTHSTAR CITY', 256, 210);
  grain(ctx, 512, 256, .06, amount);
  return canvas;
}
