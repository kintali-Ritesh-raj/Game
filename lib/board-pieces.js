// Board miniatures drawn as shaded SVG and placed by CSS. Everything here is a view of the
// existing game state: owners, building levels and positions come from the engine.
// Player colour has one source, `player.color` (passed in as --piece-color); every tint is
// mixed from it in OKLCH so a player's pawn, shield and houses share one hue.
// One key light from the upper left: lit faces face up/left, shadows fall down/right.

const mix = (amount, toward) => 'color-mix(in oklch, var(--piece-color) ' + amount + '%, ' + toward + ')';
const stop = (offset, color, opacity) => '<stop offset="' + offset + '" style="stop-color:' + color + (opacity === undefined ? '' : ';stop-opacity:' + opacity) + '"/>';
const GOLD = ['#fff3c4', '#e8c56c', '#b58a35', '#7a561c'];

function goldGradient(id, x2 = 1, y2 = 1) {
  return '<linearGradient id="' + id + '" x1="0" y1="0" x2="' + x2 + '" y2="' + y2 + '">'
    + stop(0, GOLD[0]) + stop(.28, GOLD[1]) + stop(.55, GOLD[2]) + stop(.78, GOLD[1]) + stop(1, GOLD[3]) + '</linearGradient>';
}

/** Tabletop pawn: enamel in the player's colour, bevelled base, sphere head with a hot specular. */
export function pawnSVG(uid) {
  const g = id => id + '-' + uid;
  return '<svg class="pawn-art" viewBox="0 0 48 68" aria-hidden="true"><defs>'
    + '<linearGradient id="' + g('body') + '" x1="0" x2="1">' + stop(0, mix(38, 'black')) + stop(.16, mix(80, 'black')) + stop(.32, mix(62, 'white')) + stop(.4, mix(30, 'white')) + stop(.5, mix(78, 'white')) + stop(.7, 'var(--piece-color)') + stop(.88, mix(48, 'black')) + stop(1, mix(70, 'black')) + '</linearGradient>'
    + '<linearGradient id="' + g('side') + '" x1="0" x2="1">' + stop(0, mix(45, 'black')) + stop(.3, mix(78, 'white')) + stop(.62, mix(80, 'black')) + stop(1, mix(35, 'black')) + '</linearGradient>'
    + '<linearGradient id="' + g('top') + '" x1="0" y1="0" x2=".7" y2="1">' + stop(0, mix(55, 'white')) + stop(.55, 'var(--piece-color)') + stop(1, mix(60, 'black')) + '</linearGradient>'
    + '<radialGradient id="' + g('head') + '" cx=".34" cy=".3" r=".78">' + stop(0, mix(28, 'white')) + stop(.22, mix(60, 'white')) + stop(.55, 'var(--piece-color)') + stop(.86, mix(55, 'black')) + stop(1, mix(38, 'black')) + '</radialGradient>'
    + '<radialGradient id="' + g('spec') + '">' + stop(0, '#fff', .95) + stop(.5, '#fff', .45) + stop(1, '#fff', 0) + '</radialGradient>'
    + '</defs>'
    + '<path d="M6 54v5a18 5.6 0 0 0 36 0v-5Z" fill="url(#' + g('side') + ')"/>'
    + '<ellipse cx="24" cy="54" rx="18" ry="5.6" fill="url(#' + g('top') + ')"/>'
    + '<path d="M7.4 52.6a18 5.6 0 0 1 14-4" stroke="#fff" stroke-opacity=".55" stroke-width=".9" fill="none" stroke-linecap="round"/>'
    + '<ellipse cx="24" cy="53.6" rx="13.6" ry="3.7" fill="url(#' + g('body') + ')"/>'
    + '<path d="M10.4 53.6C13 44 18.4 37.4 19.1 31.4h9.8c.7 6 6.1 12.6 8.7 22.2Z" fill="url(#' + g('body') + ')"/>'
    + '<path d="M20.6 31.4 21 25.6h6l.4 5.8Z" fill="url(#' + g('body') + ')"/>'
    + '<ellipse cx="24" cy="32.4" rx="9.4" ry="2.9" fill="' + mix(55, 'black') + '"/>'
    + '<ellipse cx="24" cy="31.2" rx="9.4" ry="2.9" fill="url(#' + g('top') + ')"/>'
    + '<circle cx="24" cy="16.4" r="11.2" fill="url(#' + g('head') + ')"/>'
    + '<path d="M31.6 22.8a11.2 11.2 0 0 0 2.4-11" stroke="' + mix(55, 'white') + '" stroke-opacity=".45" stroke-width="1.1" fill="none" stroke-linecap="round"/>'
    + '<ellipse cx="19.6" cy="11.4" rx="4.4" ry="2.9" fill="url(#' + g('spec') + ')" transform="rotate(-32 19.6 11.4)"/>'
    + '<path d="M14.8 50.4c1.6-6.6 4.6-11.6 5.4-16.4" stroke="#fff" stroke-opacity=".5" stroke-width="1.5" fill="none" stroke-linecap="round"/>'
    + '</svg>';
}

/** Owner shield: brass rim, owner enamel field, embossed crown, and a glint from the key light. */
export function badgeSVG(uid) {
  const g = id => id + '-' + uid;
  return '<svg viewBox="0 0 40 46" aria-hidden="true"><defs>' + goldGradient(g('rim'))
    + '<linearGradient id="' + g('field') + '" x1="0" y1="0" x2=".6" y2="1">' + stop(0, mix(45, 'white')) + stop(.42, 'var(--piece-color)') + stop(1, mix(45, 'black')) + '</linearGradient>'
    + goldGradient(g('crown'), .4, 1)
    + '</defs>'
    + '<path d="M20 1.6 37 7.2V21c0 11.8-7.6 19-17 23.2C10.6 40 3 32.8 3 21V7.2Z" fill="url(#' + g('rim') + ')"/>'
    + '<path d="M20 1.6 37 7.2V21c0 11.8-7.6 19-17 23.2" fill="none" stroke="#5a3d10" stroke-opacity=".55" stroke-width=".8"/>'
    + '<path d="M20 6.2 32.8 10.4v10.8c0 9.2-5.9 14.8-12.8 18.1C13.1 36 7.2 30.4 7.2 21.2V10.4Z" fill="url(#' + g('field') + ')"/>'
    + '<path d="M20 6.2 32.8 10.4v10.8c0 9.2-5.9 14.8-12.8 18.1" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="1"/>'
    + '<path d="M7.2 21.2V10.4L20 6.2" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1"/>'
    + '<path d="M12.6 28.2 13.8 18l3.7 4.4L20 15.6l2.5 6.8 3.7-4.4 1.2 10.2Z" fill="url(#' + g('crown') + ')" stroke="#5a3d10" stroke-opacity=".5" stroke-width=".5"/>'
    + '<rect x="12.4" y="28.8" width="15.2" height="2.6" rx=".7" fill="url(#' + g('crown') + ')" stroke="#5a3d10" stroke-opacity=".5" stroke-width=".5"/>'
    + '<circle cx="13.8" cy="17.4" r="1.1" fill="#fff4cc"/><circle cx="20" cy="14.9" r="1.2" fill="#fff4cc"/><circle cx="26.2" cy="17.4" r="1.1" fill="#fff4cc"/>'
    + '<path d="M7.2 10.4 20 6.2v14C15 20 10.8 17.6 7.2 14Z" fill="#fff" opacity=".16"/>'
    + '<path d="M9.4 4.6l1.1 2.2 2.2 1.1-2.2 1.1-1.1 2.2-1.1-2.2-2.2-1.1 2.2-1.1Z" fill="#fff" opacity=".9"/>'
    + '</svg>';
}

/** Painted miniature house: lit roof, front gable, shaded side wall, chimney. */
export function houseSVG() {
  return '<svg viewBox="0 0 40 40" aria-hidden="true">'
    + '<path class="house-side" d="M22 35.5V20L35.6 15.2v15.4Z"/>'
    + '<path class="house-front" d="M4.6 35.5V20L13.4 10.6 22 20v15.5Z"/>'
    + '<path class="house-roof" d="M13.4 10.6 27 5.8 37.4 15.6 22.6 20.8Z"/>'
    + '<path class="house-eave" d="M22.6 20.8 37.4 15.6l-.2 1.4-14.2 5Z"/>'
    + '<path class="house-chimney-side" d="M30.4 11.4V5.4l1.9-.7v6Z"/>'
    + '<path class="house-chimney" d="M27.4 12.2V6.2h3v5.2Z"/>'
    + '<path class="house-chimney-top" d="M27.4 6.2l1.9-.7h3l-1.9.7Z"/>'
    + '<path class="house-door" d="M11 35.5v-7.6h4.8v7.6Z"/>'
    + '<path class="house-window" d="M26.2 27.6v-4.8l4.6-1.6V26Z"/>'
    + '<path d="M3.8 20.6 13.4 10.2 22.8 20.6" fill="none" class="house-trim"/>'
    + '<path d="M4.6 35.5V20.2" stroke="#fff" stroke-opacity=".35" stroke-width=".8"/>'
    + '</svg>';
}

/** Architectural skyscraper: neutral steel and glass in three setbacks on an owner-coloured plinth. */
export function towerSVG(uid) {
  const g = id => id + '-' + uid;
  let mullions = '', floors = '';
  for (let x = 17.5; x < 32; x += 3) mullions += '<path d="M' + x + ' 104V37"/>';
  for (let y = 41; y < 103; y += 4.5) floors += '<path d="M14 ' + y + 'H32M32 ' + y + 'l9-3.4"/>';
  return '<svg viewBox="0 0 56 120" preserveAspectRatio="xMidYMax meet" aria-hidden="true"><defs>'
    + '<linearGradient id="' + g('front') + '" x1="0" x2="1">' + stop(0, '#8ea2ac') + stop(.28, '#f1f6f8') + stop(.55, '#c6d4da') + stop(1, '#93a8b2') + '</linearGradient>'
    + '<linearGradient id="' + g('side') + '" x1="0" y1="0" x2="0" y2="1">' + stop(0, '#55707e') + stop(.5, '#34505e') + stop(1, '#25363f') + '</linearGradient>'
    + '<linearGradient id="' + g('glass') + '" x1="0" y1="0" x2="1" y2="1">' + stop(0, '#fff', .55) + stop(.4, '#fff', 0) + stop(1, '#fff', 0) + '</linearGradient>'
    + goldGradient(g('gold'))
    + '<linearGradient id="' + g('plinth') + '" x1="0" x2="1">' + stop(0, mix(55, 'white')) + stop(.35, 'var(--piece-color)') + stop(1, mix(50, 'black')) + '</linearGradient>'
    + '</defs>'
    + '<path d="M6 112v3.6a22 6 0 0 0 44 0V112Z" fill="' + mix(50, 'black') + '"/>'
    + '<ellipse cx="28" cy="112" rx="22" ry="6" fill="url(#' + g('plinth') + ')"/>'
    + '<path d="M10 108.6v3a18 4.6 0 0 0 36 0v-3Z" fill="#6b4a17"/>'
    + '<ellipse cx="28" cy="108.6" rx="18" ry="4.6" fill="url(#' + g('gold') + ')"/>'
    + '<path d="M14 105V37h18v68Z" fill="url(#' + g('front') + ')"/>'
    + '<path d="M32 105V37l9-3.4v68Z" fill="url(#' + g('side') + ')"/>'
    + '<g stroke="#4c6f82" stroke-opacity=".55" stroke-width=".55">' + mullions + floors + '</g>'
    + '<path d="M14 105V37h7.6L14 70Z" fill="url(#' + g('glass') + ')"/>'
    + '<path d="M14 37l9-3.4h18L32 37Z" fill="url(#' + g('gold') + ')"/>'
    + '<path d="M17 37V21h12v16Z" fill="url(#' + g('front') + ')"/>'
    + '<path d="M29 37V21l6-2.3v16Z" fill="url(#' + g('side') + ')"/>'
    + '<g stroke="#4c6f82" stroke-opacity=".5" stroke-width=".5"><path d="M20 37V21M23 37V21M26 37V21M17 25.5H29M17 30H29"/></g>'
    + '<path d="M17 21l6-2.3h12L29 21Z" fill="url(#' + g('gold') + ')"/>'
    + '<path d="M20 21V11h6v10Z" fill="url(#' + g('front') + ')"/>'
    + '<path d="M26 21V11l3-1.2v10Z" fill="url(#' + g('side') + ')"/>'
    + '<path d="M20 11l3-1.2h6L26 11Z" fill="url(#' + g('gold') + ')"/>'
    + '<path d="M23.6 10V1.4" stroke="url(#' + g('gold') + ')" stroke-width="1.4" stroke-linecap="round"/>'
    + '<circle cx="23.6" cy="1.8" r="1.3" fill="#fff3c4"/>'
    + '<path d="M14 105V37" stroke="#fff" stroke-opacity=".6" stroke-width=".7"/>'
    + '</svg>';
}

// Space icons. Corner medallions are enamel-and-brass; the rest are bold engraved line icons.
const MEDALLION = '<circle cx="24" cy="24" r="21" class="icon-rim"/><circle cx="24" cy="24" r="17.2" class="icon-enamel"/><circle cx="24" cy="24" r="17.2" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="1.2"/>';
const ICONS = {
  start: MEDALLION + '<path d="M24 9.5 26.6 21.4 38.5 24 26.6 26.6 24 38.5 21.4 26.6 9.5 24 21.4 21.4Z" class="icon-gold-fill"/><path d="M24 15.5 25.2 22.8 32.5 24 25.2 25.2 24 32.5 22.8 25.2 15.5 24 22.8 22.8Z" fill="#fff" opacity=".3" transform="rotate(45 24 24)"/><circle cx="24" cy="24" r="2" fill="#1b2f45"/>',
  free: MEDALLION + '<path d="M29.4 17.4c-1.1-1.6-3-2.5-5.4-2.5-3.5 0-5.8 1.9-5.8 4.5 0 6 11.7 3.4 11.7 9.6 0 2.8-2.6 4.6-6 4.6-2.6 0-4.9-1-6.1-2.9M24 11.6v24.8" stroke="#f3d68a" stroke-width="2.6" fill="none" stroke-linecap="round"/>',
  prison: '<rect x="8" y="8" width="32" height="32" rx="2.5" class="icon-line" stroke-width="3"/><path d="M16 8v32M24 8v32M32 8v32M8 18h32" class="icon-line" stroke-width="3"/>',
  wheel: MEDALLION + '<circle cx="24" cy="24" r="11" fill="none" stroke="#f3d68a" stroke-width="2.4"/><path d="M24 13v22M13 24h22M16.2 16.2l15.6 15.6M31.8 16.2 16.2 31.8" stroke="#f3d68a" stroke-width="1.8" stroke-linecap="round"/><circle cx="24" cy="24" r="2.8" class="icon-gold-fill"/><path d="M24 7.5l-3 5h6z" class="icon-gold-fill"/>',
  market: '<path d="M8 36 20 24l7 7 13-13M30 18h10v10" class="icon-line" stroke-width="3.2"/>',
  economic: '<path d="M5 26h9l5-14 8 26 5-16h11" class="icon-line" stroke-width="3.2"/>',
  tax: '<circle cx="15" cy="15" r="5.2" class="icon-line" stroke-width="3"/><circle cx="33" cy="33" r="5.2" class="icon-line" stroke-width="3"/><path d="M37 11 11 37" class="icon-line" stroke-width="3.2"/>',
  wealth: '<circle cx="15" cy="15" r="5.2" class="icon-line" stroke-width="3"/><circle cx="33" cy="33" r="5.2" class="icon-line" stroke-width="3"/><path d="M37 11 11 37" class="icon-line" stroke-width="3.2"/>',
  bank: '<path d="M6 18 24 8l18 10Z" class="icon-line" stroke-width="2.6"/><path d="M10 21v14M18 21v14M30 21v14M38 21v14M6 39h36M8 18h32" class="icon-line" stroke-width="2.8"/>',
  transport: '<rect x="13" y="6" width="22" height="28" rx="6" class="icon-line" stroke-width="2.8"/><path d="M13 20h22M19 12h10" class="icon-line" stroke-width="2.6"/><circle cx="18.5" cy="27" r="1.6" class="icon-line" stroke-width="2.4"/><circle cx="29.5" cy="27" r="1.6" class="icon-line" stroke-width="2.4"/><path d="M16 34l-4 7M32 34l4 7M10 41h28" class="icon-line" stroke-width="2.8"/>',
  utility: '<path d="M27 5 12 27h11l-3 16 16-23H25Z" class="icon-line" stroke-width="2.8"/>',
  exchange: '<path d="M7 38h34M11 38V26M19 38V18M27 38V22M35 38V10" class="icon-line" stroke-width="3"/><path d="M9 20 19 12l8 5 12-9" class="icon-line" stroke-width="2.6"/>',
  luxury: '<path d="M10 18 17 9h14l7 9-14 21Z" class="icon-line" stroke-width="2.8"/><path d="M10 18h28M19 9l-2 9 7 21 7-21-2-9" class="icon-line" stroke-width="2.4"/>',
  auction: '<path d="M26 8l12 12M21 13l12 12M23.5 10.5l7 7M28 21 13 36M8 40h15" class="icon-line" stroke-width="3"/>',
};
export function spaceIconSVG(type) {
  return ICONS[type] ? '<svg class="space-icon" viewBox="0 0 48 48" aria-hidden="true">' + ICONS[type] + '</svg>' : null;
}

/** Per-property anchor that shares its tile's grid cell; children are placed relative to the tile. */
export function pieceAnchorHTML(space, row, col, edge) {
  return '<div class="tile-pieces ' + edge + '" data-pieces="' + space.id + '" style="grid-row:' + (row + 1) + ';grid-column:' + (col + 1) + '" aria-hidden="true">'
    + '<span class="piece-buildings"></span></div>';
}

/**
 * Bring every property's shield, houses and tower in line with the game state.
 * `towerLevel` is the engine's top development level; below it each level is a house.
 * Animations play only for changes after the first sync of a freshly built board.
 */
export function syncPieces(board, game, towerLevel) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  board.querySelectorAll('.tile-pieces').forEach(anchor => {
    const id = Number(anchor.dataset.pieces), asset = game.asset(id), owner = game.player(asset.owner);
    const animate = anchor.dataset.synced === '1' && !reduced;
    anchor.dataset.synced = '1';
    anchor.classList.toggle('is-mortgaged', !!asset.mortgaged);
    if (owner) anchor.style.setProperty('--piece-color', owner.color); else anchor.style.removeProperty('--piece-color');

    let badge = anchor.querySelector('.piece-badge:not(.leave)');
    const ownerKey = owner ? String(owner.id) : '';
    if (owner && (!badge || badge.dataset.owner !== ownerKey)) {
      if (badge) leave(badge, animate);
      badge = document.createElement('span');
      badge.className = 'piece-badge' + (animate ? ' enter' : '');
      badge.dataset.owner = ownerKey;
      badge.innerHTML = '<span class="piece-contact"></span>' + badgeSVG('b' + id);
      anchor.append(badge);
    } else if (!owner && badge) leave(badge, animate);

    // Houses below the tower level, one tower at it. The tower replaces the houses.
    const level = owner ? asset.buildings : 0, tower = level >= towerLevel, houses = tower ? 0 : level;
    const row = anchor.querySelector('.piece-buildings');
    const current = [...row.children].filter(el => !el.classList.contains('leave'));
    const upgrading = tower && !anchor.querySelector('.piece-tower:not(.leave)');
    current.slice(houses).forEach((el, i) => leave(el, animate, upgrading ? i * 45 : 0));
    for (let i = current.length; i < houses; i++) {
      const house = document.createElement('span');
      house.className = 'piece-house' + (animate ? ' enter' : '');
      house.style.animationDelay = animate ? ((i - current.length) * 80) + 'ms' : '';
      house.innerHTML = '<span class="piece-contact"></span>' + houseSVG();
      row.append(house);
    }
    row.dataset.count = String(houses);
    const existingTower = anchor.querySelector('.piece-tower:not(.leave)');
    if (tower && !existingTower) {
      const el = document.createElement('span');
      el.className = 'piece-tower' + (animate ? ' rise' : '');
      el.innerHTML = '<span class="piece-contact tower-contact"></span>' + towerSVG('t' + id);
      anchor.append(el);
    } else if (!tower && existingTower) leave(existingTower, animate);
    anchor.dataset.level = String(level);
    board.querySelector('.board-tile[data-id="' + id + '"]')?.classList.toggle('has-tower', tower);
  });
}

function leave(el, animate, delay = 0) {
  if (!animate) { el.remove(); return; }
  el.classList.remove('enter', 'rise');
  el.style.animationDelay = delay + 'ms';
  el.classList.add('leave');
  setTimeout(() => el.remove(), 280 + delay);
}

/** Offsets (in pawn widths) for pawns sharing a space: pair, triangle, 2×2, then a compact grid. */
export function clusterOffsets(count) {
  if (count <= 1) return { scale: 1, points: [[0, 0]] };
  if (count === 2) return { scale: .9, points: [[-.5, 0], [.5, 0]] };
  if (count === 3) return { scale: .82, points: [[0, -.36], [-.52, .2], [.52, .2]] };
  if (count === 4) return { scale: .74, points: [[-.48, -.44], [.48, -.44], [-.48, .36], [.48, .36]] };
  const columns = Math.ceil(Math.sqrt(count)), scale = 1.5 / columns;
  return { scale, points: Array.from({ length: count }, (_, i) => [((i % columns) - (columns - 1) / 2) * 1.05 * scale, (Math.floor(i / columns) - (Math.ceil(count / columns) - 1) / 2) * .62 * scale]) };
}

export function createPawn(player) {
  const token = document.createElement('span');
  token.className = 'player-token';
  token.id = 'classic-token-' + player.id;
  token.innerHTML = '<span class="pawn-shadow"></span><span class="pawn-body">' + pawnSVG('p' + player.id) + '</span>'
    + '<span class="pawn-cage" aria-hidden="true"><span class="cage-rail top"></span><i></i><i></i><i></i><i></i><i></i><span class="cage-rail bottom"></span><span class="cage-lock"></span></span>';
  return token;
}

/** Shrink any property name whose longest word does not fit its card (fonts scale with the board). */
export function fitTileNames(board) {
  board.querySelectorAll('.tile-name').forEach(name => {
    name.style.removeProperty('--name-fit');
    if (name.scrollWidth > name.clientWidth + 1) name.style.setProperty('--name-fit', (Math.floor(name.clientWidth / name.scrollWidth * 100) / 100).toString());
  });
}
