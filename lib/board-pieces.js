// Board miniatures drawn as SVG and placed by CSS. Everything here is a view of the
// existing game state: owners, building levels and positions come from the engine.
// Player colour has one source, `player.color`; shading is derived from it with
// color-mix so every piece belonging to a player shares the same hue.

const shade = (amount, toward) => 'color-mix(in srgb, var(--piece-color) ' + amount + '%, ' + toward + ')';

/** Upright pawn with enamel shading and a brass collar. `uid` keeps gradient ids unique. */
export function pawnSVG(uid) {
  return '<svg class="pawn-art" viewBox="0 0 40 56" aria-hidden="true">'
    + '<defs>'
    + '<linearGradient id="pb-' + uid + '" x1="0" x2="1"><stop offset="0" style="stop-color:' + shade(45, 'black') + '"/><stop offset=".32" style="stop-color:' + shade(62, 'white') + '"/><stop offset=".55" style="stop-color:var(--piece-color)"/><stop offset="1" style="stop-color:' + shade(40, 'black') + '"/></linearGradient>'
    + '<radialGradient id="ph-' + uid + '" cx=".36" cy=".3" r=".75"><stop offset="0" style="stop-color:' + shade(45, 'white') + '"/><stop offset=".45" style="stop-color:var(--piece-color)"/><stop offset="1" style="stop-color:' + shade(45, 'black') + '"/></radialGradient>'
    + '<linearGradient id="pg-' + uid + '" x1="0" x2="1"><stop offset="0" stop-color="#7a5a22"/><stop offset=".4" stop-color="#f4dc98"/><stop offset="1" stop-color="#8d6a2a"/></linearGradient>'
    + '</defs>'
    + '<path d="M5 45.5Q5 53 20 54Q35 53 35 45.5Z" fill="url(#pb-' + uid + ')"/>'
    + '<ellipse cx="20" cy="45.5" rx="15" ry="4.2" fill="url(#pb-' + uid + ')"/>'
    + '<ellipse cx="20" cy="44.6" rx="12.6" ry="2.8" fill="none" stroke="url(#pg-' + uid + ')" stroke-width="1.2"/>'
    + '<path d="M8.5 44.6C11 36.5 15 31 15.6 26.5H24.4C25 31 29 36.5 31.5 44.6Z" fill="url(#pb-' + uid + ')"/>'
    + '<ellipse cx="20" cy="26.4" rx="7.6" ry="2.5" fill="url(#pg-' + uid + ')"/>'
    + '<circle cx="20" cy="16.5" r="9" fill="url(#ph-' + uid + ')"/>'
    + '<ellipse cx="16.6" cy="12.6" rx="3.2" ry="2.1" fill="#fff" opacity=".55" transform="rotate(-28 16.6 12.6)"/>'
    + '<path d="M12.2 41.5C13.6 37 16 33 16.8 29" stroke="#fff" stroke-opacity=".35" stroke-width="1.3" fill="none" stroke-linecap="round"/>'
    + '</svg>';
}

/** Owner shield: owner enamel inside a brass rim, with a small crown. */
export function badgeSVG(uid) {
  return '<svg viewBox="0 0 24 28" aria-hidden="true">'
    + '<defs><linearGradient id="bf-' + uid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:' + shade(70, 'white') + '"/><stop offset=".45" style="stop-color:var(--piece-color)"/><stop offset="1" style="stop-color:' + shade(50, 'black') + '"/></linearGradient>'
    + '<linearGradient id="br-' + uid + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6e2a4"/><stop offset=".5" stop-color="#b08a3e"/><stop offset="1" stop-color="#e9cd84"/></linearGradient></defs>'
    + '<path d="M12 1.2 22.3 4.6V13C22.3 20.2 17.6 24.6 12 27 6.4 24.6 1.7 20.2 1.7 13V4.6Z" fill="url(#bf-' + uid + ')" stroke="url(#br-' + uid + ')" stroke-width="1.8" stroke-linejoin="round"/>'
    + '<path d="M7.4 17.2 8.2 10.6 10.6 13.6 12 9.4 13.4 13.6 15.8 10.6 16.6 17.2Z" fill="url(#br-' + uid + ')"/>'
    + '<rect x="7.4" y="17.9" width="9.2" height="1.6" rx=".5" fill="url(#br-' + uid + ')"/>'
    + '<path d="M4 5.6 12 2.9V25.4C7 23 4 18.8 4 13Z" fill="#fff" opacity=".13"/>'
    + '</svg>';
}

/** Three-quarter view house in the owner's colour: lit roof, shaded side wall. */
export function houseSVG() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true">'
    + '<path class="house-side" d="M13 21.2V12L21 8.6V17.8Z"/>'
    + '<path class="house-front" d="M3 21.2V12L8 7.2 13 12V21.2Z"/>'
    + '<path class="house-roof" d="M8 7.2 16.2 3.8 21 8.6 13 12Z"/>'
    + '<path class="house-door" d="M6.6 21.2V16.6H9.4V21.2Z"/>'
    + '<path d="M3 12 8 7.2 13 12" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width=".6"/>'
    + '</svg>';
}

/** Neutral steel-and-glass tower; only its foundation ring carries the owner's colour. */
export function towerSVG(uid) {
  let windows = '';
  for (let y = 13.5; y < 41; y += 3) windows += '<path d="M7.2 ' + y + 'H13.2M14.6 ' + (y - 0.4) + 'L17.6 ' + (y - 1.9) + '" />';
  return '<svg viewBox="0 0 24 50" aria-hidden="true">'
    + '<defs><linearGradient id="tf-' + uid + '" x1="0" x2="1"><stop offset="0" stop-color="#9fb0b8"/><stop offset=".45" stop-color="#f4f7f8"/><stop offset="1" stop-color="#b9c6cc"/></linearGradient>'
    + '<linearGradient id="ts-' + uid + '" x1="0" x2="1"><stop offset="0" stop-color="#5d6e78"/><stop offset="1" stop-color="#3a4850"/></linearGradient>'
    + '<linearGradient id="tg-' + uid + '" x1="0" x2="1"><stop offset="0" stop-color="#8d6a2a"/><stop offset=".5" stop-color="#f4dc98"/><stop offset="1" stop-color="#8d6a2a"/></linearGradient></defs>'
    + '<ellipse class="tower-plinth" cx="12" cy="46.2" rx="10.6" ry="3.2"/>'
    + '<ellipse cx="12" cy="44.9" rx="9" ry="2.4" fill="url(#tg-' + uid + ')"/>'
    + '<path d="M6 44.4V11.2H14V44.4Z" fill="url(#tf-' + uid + ')"/>'
    + '<path d="M14 44.4V11.2L18.6 9V42.2Z" fill="url(#ts-' + uid + ')"/>'
    + '<g stroke="#4f7184" stroke-opacity=".55" stroke-width=".55">' + windows + '</g>'
    + '<path d="M6 11.2 10.6 9 18.6 9 14 11.2Z" fill="url(#tg-' + uid + ')"/>'
    + '<path d="M7.6 11V6.6H12.6V11Z" fill="url(#tf-' + uid + ')"/>'
    + '<path d="M12.6 11V6.6L15.6 5.2V9.6Z" fill="url(#ts-' + uid + ')"/>'
    + '<path d="M10.1 6.6V.6" stroke="url(#tg-' + uid + ')" stroke-width="1.1" stroke-linecap="round"/>'
    + '</svg>';
}

// Engraved icons for the special spaces, in place of text glyphs.
const ICONS = {
  start: '<circle cx="12" cy="12" r="10.2" class="icon-gold"/><circle cx="12" cy="12" r="8" fill="#1f3a52"/><path d="M12 4.6 13.5 10.5 19.4 12 13.5 13.5 12 19.4 10.5 13.5 4.6 12 10.5 10.5Z" class="icon-gold-fill"/>',
  free: '<circle cx="12" cy="12" r="10.2" class="icon-gold"/><circle cx="12" cy="12" r="8" fill="#1f3a52"/><path d="M14.6 8.6C14 7.8 13.1 7.4 12 7.4 10.3 7.4 9.2 8.3 9.2 9.6 9.2 12.6 14.9 11.2 14.9 14.3 14.9 15.7 13.6 16.6 12 16.6 10.7 16.6 9.6 16.1 9 15.2M12 5.8V18.2" stroke="#f1d58a" stroke-width="1.5" fill="none" stroke-linecap="round"/>',
  prison: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M8 4V20M12 4V20M16 4V20M4 9.5H20"/>',
  pricewar: '<path d="M4 8.5H19M15.5 5 19 8.5 15.5 12M20 15.5H5M8.5 12 5 15.5 8.5 19"/>',
  market: '<path d="M4 18 10 12 13.5 15.5 20 9M15 9H20V14"/>',
  economic: '<path d="M2.5 13H7L9.5 6 13.5 19 16 11H21.5"/>',
  tax: '<circle cx="7.5" cy="7.5" r="2.6"/><circle cx="16.5" cy="16.5" r="2.6"/><path d="M18.5 5.5 5.5 18.5"/>',
  wealth: '<circle cx="7.5" cy="7.5" r="2.6"/><circle cx="16.5" cy="16.5" r="2.6"/><path d="M18.5 5.5 5.5 18.5"/>',
  bank: '<path d="M3.5 9 12 4 20.5 9ZM5.5 10.5V17M9.8 10.5V17M14.2 10.5V17M18.5 10.5V17M3.5 19.5H20.5"/>',
  regulation: '<path d="M12 4V20M8 20H16M5 7.5H19M5 7.5 2.8 13.2A2.4 2.4 0 0 0 7.2 13.2ZM19 7.5 16.8 13.2A2.4 2.4 0 0 0 21.2 13.2Z"/>',
  auction: '<path d="M13.5 4.5 19.5 10.5M11 7 17 13M12.2 5.8 15.8 9.4 18.2 11.8M14 11 6 19M3.5 20.5H11"/>',
};
export function spaceIconSVG(type) {
  return ICONS[type] ? '<svg class="space-icon" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[type] + '</svg>' : null;
}

/** Per-property anchor that sits in the same grid cell as its tile and holds its pieces. */
export function pieceAnchorHTML(space, row, col, edge) {
  return '<div class="tile-pieces ' + edge + '" data-pieces="' + space.id + '" style="grid-row:' + (row + 1) + ';grid-column:' + (col + 1) + '" aria-hidden="true">'
    + '<span class="piece-buildings"></span></div>';
}

/**
 * Bring every property's badge, houses and tower in line with the game state.
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

    // Ownership badge.
    let badge = anchor.querySelector('.piece-badge');
    const ownerKey = owner ? String(owner.id) : '';
    if (owner && (!badge || badge.dataset.owner !== ownerKey)) {
      badge?.remove();
      badge = document.createElement('span');
      badge.className = 'piece-badge' + (animate ? ' enter' : '');
      badge.dataset.owner = ownerKey;
      badge.innerHTML = badgeSVG('b' + id);
      anchor.append(badge);
    } else if (!owner && badge) leave(badge, animate);

    // Houses below the tower level, one tower at it. The tower replaces the houses.
    const level = owner ? asset.buildings : 0, tower = level >= towerLevel, houses = tower ? 0 : level;
    const row = anchor.querySelector('.piece-buildings');
    const current = [...row.children].filter(el => !el.classList.contains('leave'));
    const upgrading = tower && !anchor.querySelector('.piece-tower:not(.leave)');
    current.slice(houses).forEach((el, i) => leave(el, animate, upgrading ? i * 40 : 0));
    for (let i = current.length; i < houses; i++) {
      const house = document.createElement('span');
      house.className = 'piece-house' + (animate ? ' enter' : '');
      house.style.animationDelay = animate ? ((i - current.length) * 70) + 'ms' : '';
      house.innerHTML = houseSVG();
      row.append(house);
    }
    const existingTower = anchor.querySelector('.piece-tower:not(.leave)');
    if (tower && !existingTower) {
      const el = document.createElement('span');
      el.className = 'piece-tower' + (animate ? ' rise' : '');
      el.innerHTML = '<span class="tower-shadow"></span>' + towerSVG('t' + id);
      anchor.append(el);
    } else if (!tower && existingTower) leave(existingTower, animate);
    anchor.dataset.level = String(level);
    // Lets the card's text make room beside a tower.
    board.querySelector('.board-tile[data-id="' + id + '"]')?.classList.toggle('has-tower', tower);
  });
}

function leave(el, animate, delay = 0) {
  if (!animate) { el.remove(); return; }
  el.classList.remove('enter', 'rise');
  el.style.animationDelay = delay + 'ms';
  el.classList.add('leave');
  setTimeout(() => el.remove(), 260 + delay);
}

/** Offsets (in pawn widths) for 1–4+ pawns sharing a space: pair, triangle, 2×2, then a grid. */
export function clusterOffsets(count) {
  if (count <= 1) return { scale: 1, points: [[0, 0]] };
  if (count === 2) return { scale: 1, points: [[-.55, 0], [.55, 0]] };
  if (count === 3) return { scale: .92, points: [[0, -.34], [-.56, .2], [.56, .2]] };
  if (count === 4) return { scale: .8, points: [[-.5, -.46], [.5, -.46], [-.5, .4], [.5, .4]] };
  const columns = Math.ceil(Math.sqrt(count)), scale = 1.7 / columns;
  return { scale, points: Array.from({ length: count }, (_, i) => [((i % columns) - (columns - 1) / 2) * 1.05 * scale, (Math.floor(i / columns) - (Math.ceil(count / columns) - 1) / 2) * .62 * scale]) };
}

export function createPawn(player) {
  const token = document.createElement('span');
  token.className = 'player-token';
  token.id = 'classic-token-' + player.id;
  token.innerHTML = '<span class="pawn-shadow"></span><span class="pawn-body">' + pawnSVG('p' + player.id) + '</span>';
  return token;
}
