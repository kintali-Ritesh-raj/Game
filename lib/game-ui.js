import MarketWars from './game-engine.cjs';
import { clusterOffsets, createPawn, fitTileNames, pieceAnchorHTML, spaceIconSVG, syncPieces } from './board-pieces';

export function initializeUI(online) {
  const { Game, BOARD, GROUPS, TOKENS, COLORS, DEFAULT_SETTINGS, SAVE_KEY, SETTINGS_KEY, money, levelName, validatePlayers } = MarketWars;
  const $ = id => document.getElementById(id);
  // Development levels below this are houses; this level is the tower (from the engine's rent table).
  // This game's spaces: the classic 40, or 50 / 60 on the pentagon and hexagon boards.
  const spaces = () => game?.board || BOARD;
  const TOWER_LEVEL = (BOARD.find(space => space.houseRents)?.houseRents.length ?? 4) + 1;
  const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const button = (label, action, extra = '', disabled = false, type = 'secondary') => '<button class="' + type + '" data-action="' + action + '" data-rule-disabled="' + disabled + '" ' + extra + (disabled ? ' disabled' : '') + '>' + label + '</button>';
  const getStorage = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const settings = (() => { try { return { ...DEFAULT_SETTINGS, ...JSON.parse(getStorage(SETTINGS_KEY) || '{}') }; } catch { return { ...DEFAULT_SETTINGS }; } })();
  let wheelBusy = false, wheelTimer = 0, lastWheelId = null;
  let dieBusy = false, dieTimer = 0, lastDieId = null, toastHoldUntil = 0, cashSeen = {};
  let game = null, screen = 'home', selectedSpace = 1, modalKind = null, modalKey = '', toastTimer, audioContext, lastPhase, lastLogId = 0;
  const visitorAudio = new Audio('/faah_sound.mpeg');
  visitorAudio.preload = 'auto';
  visitorAudio.volume = .65;
  const diceAudio = new Audio('/Dice_sound.mpeg');
  diceAudio.preload = 'auto';
  diceAudio.volume = .55;
  const controller = new AbortController();
  const listen = (target, type, callback) => target.addEventListener(type, callback, { signal: controller.signal });
  let metadata = null, sending = false, animating = false, revision = -1, animationGeneration = 0, acceptedState = null, ownershipTimer;
  const dialog = $('modal');
  listen(dialog, 'cancel', event => {
    if (isMandatoryModal()) event.preventDefault(); else closeModal();
  });
  listen(dialog, 'click', event => { if (event.target === dialog && !isMandatoryModal()) closeModal(); });

  // ── 3D board controller ────────────────────────────────────────────────────
  let readableBoard = null, boardMode = 'classic', boardReady = false;
  const boardResize = new ResizeObserver(() => { if (game && boardMode === 'classic') updateTokens(); });
  // The observer only runs when a frame is rendered (throttled in background windows);
  // the resize event repositions pawns as soon as the layout changes.
  listen(window, 'resize', () => { if (game && boardMode === 'classic') updateTokens(); });

  function initReadableBoard() {
    if (boardReady) return;
    const area = document.querySelector('.board-area');
    area.querySelector('.board-tools>span').textContent = 'THE CITY spaces()';
    area.querySelector('.board-tools>span').insertAdjacentHTML('afterend', '<div id="city-banner" class="city-banner" role="status" aria-live="polite" hidden></div>');
    area.querySelector('.board-tools').insertAdjacentHTML('beforeend', '<div class="readable-view-switch" role="group" aria-label="Board view"><button data-action="locate-token">Your token ↓</button></div>');
    const classic = document.createElement('div'); classic.id = 'classic-board-view'; classic.className = 'classic-board-view';
    const board = $('game-board');
    board.classList.remove('board-3d-hidden'); board.removeAttribute('aria-hidden');
    board.setAttribute('aria-label', 'Monopoly board, 40 spaces around the city');
    area.querySelector('.board-3d-wrap').before(classic); classic.append(board);
    boardResize.observe(board);
    // The square board is the only view.
    area.querySelector('.board-3d-wrap').remove();
    area.querySelector('.board-3d-controls')?.remove();
    boardReady = true;
    setBoardMode('classic');
  }
  function setBoardMode() {
    boardMode = 'classic';
    $('classic-board-view').hidden = false;
    $('game-board').inert = false;
    document.querySelector('.game-layout').classList.add('classic-layout');
    if (game) { updateBoard(); updateTokens(); renderCenter(); applyPermissions(); }
    updateBoardHint();
  }
  function updateBoardHint() {
    $('board-hint').textContent = 'Follow the board from Launch · tap a space for its deed';
  }
  function readableTokens() {
    return game.state.players.map(player => ({...player, symbol:TOKENS[player.token], active:player.id === game.active.id}));
  }

  /** Build the asset map the 3D board expects. */
  function buildAssetMap() {
    if (!game) return {};
    const map = {};
    spaces().forEach(space => {
      if (!space.price) return;
      const asset = game.asset(space.id);
      const owner = game.player(asset.owner);
      map[space.id] = {
        owner: asset.owner,
        buildings: asset.buildings,
        mortgaged: asset.mortgaged,
        ownerColor: owner ? owner.color : null,
        ownerName: owner?.name,
        ownerSymbol: owner ? TOKENS[owner.token] : undefined,
      };
    });
    return map;
  }

  function notify(message) {
    $('toast').textContent = message; $('toast').classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3600);
  }
  // Player colours are exact on pawns, shields and houses. For text and borders, swap in a shade
  // that stays readable on the background: dark panels (and the teal board centre) or light ones.
  const READABLE_ON_DARK = { '#17171c': '#d4d4dc', '#1e40e6': '#86a2ff' }, READABLE_ON_LIGHT = { '#7ed321': '#4a8a10' };
  function uiColor(color, onDark = document.documentElement.dataset.theme === 'dark') { return (onDark ? READABLE_ON_DARK : READABLE_ON_LIGHT)[color] || color; }
  function tokenHTML(token) { return '<span class="token-dot" style="--token-color:' + (MarketWars.TOKEN_COLORS[token] || '#8a8f8c') + '" aria-hidden="true"></span>'; }
  function ownerHTML(owner) {
    return owner ? '<span class="property-owner" style="--owner-color:' + uiColor(owner.color) + '"><span class="owner-avatar" aria-hidden="true">' + tokenHTML(owner.token) + '</span><span>Owned by <b>' + escapeHTML(owner.name) + '</b></span></span>' : '<span class="property-owner unowned">Available from the bank</span>';
  }
  function buildingsHTML(space, asset, owner) {
    if (space.type !== 'property') return '<span class="building-display no-buildings">No buildings · ' + (space.type === 'utility' ? 'utility' : 'transit') + '</span>';
    const tower = asset.buildings === 5, count = tower ? 1 : asset.buildings;
    const label = tower ? '1 tower · level 5' : count + (count === 1 ? ' house' : ' houses');
    const path = tower ? '<path d="M5 22V2h14v20M2 22h20M9 6h2m2 0h2M9 10h2m2 0h2M9 14h2m2 0h2M10 22v-4h4v4"/>' : '<path d="M2 11 12 2l10 9M5 10v12h14V10M10 22v-8h4v8"/>';
    return '<span class="building-display" data-buildings="' + asset.buildings + '" style="--owner-color:' + (owner?.color || 'var(--muted)') + '"><span class="house-icons" aria-hidden="true">' + Array.from({ length: Math.max(1, count) }, () => '<svg class="house-icon' + (!count ? ' empty-house' : '') + '" viewBox="0 0 24 24">' + path + '</svg>').join('') + '</span><span>' + label + '</span></span>';
  }
  function showOwnershipChanges(previous) {
    if (!previous) return;
    const acquired = spaces().filter(space => space.price && game.asset(space.id).owner !== null && previous.properties[space.id]?.owner !== game.asset(space.id).owner);
    if (!acquired.length) return;
    const space = acquired[0], owner = game.player(game.asset(space.id).owner);
    selectedSpace = space.id; updateBoard(); renderSidebar();
  }
  function playSound(kind) {
    if (!(game?.state.settings.sound ?? settings.sound)) return;
    if (kind === 'visitor') {
      visitorAudio.currentTime = 0;
      void visitorAudio.play().catch(() => playSound('payment'));
      return;
    }
    if (kind === 'dice') {
      diceAudio.currentTime = 0;
      void diceAudio.play().catch(() => { if (game?.state.phase === 'rolling') playSound('dice-fallback'); });
      return;
    }
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      void audioContext.resume();
      const frequencies = { 'dice-fallback': [180, 260], purchase: [440, 660], income: [520, 740], payment: [300, 230], build: [440, 550, 660], event: [380, 520], victory: [440, 554, 659, 880] }[kind] || [440];
      frequencies.forEach((frequency, index) => {
        const oscillator = audioContext.createOscillator(), gain = audioContext.createGain(), start = audioContext.currentTime + index * .09;
        oscillator.type = kind === 'dice-fallback' ? 'triangle' : 'sine'; oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(.04, start + .012); gain.gain.exponentialRampToValueAtTime(.001, start + .14);
        oscillator.connect(gain); gain.connect(audioContext.destination); oscillator.start(start); oscillator.stop(start + .15);
      });
    } catch { /* Audio is optional on browsers without Web Audio. */ }
  }
  function showScreen(name) {
    const changed = screen !== name;
    screen = name;
    ['home', 'game', 'victory'].forEach(id => $(id + '-screen').hidden = id !== name);
    $('header-meta').innerHTML = '<span class="live-dot"></span>' + (name === 'game' ? 'ONLINE MULTIPLAYER · A SHARED ECONOMY' : 'THE ECONOMY IS YOURS TO CHANGE');
    $('continue-button').hidden = !getStorage('market-wars-room');
    if (changed) window.scrollTo({ top: 0, behavior: 'instant' });

    if (name === 'game') {
      initReadableBoard();
    }
  }
  function showModal(kind, title, body, actions = '', { wide = false, eyebrow = 'MONOPOLY', mandatory = false } = {}) {
    const cardKey = kind + ':' + title + ':' + (kind === 'event' ? JSON.stringify(game?.state.event) : '');
    const entering = !dialog.open || dialog.dataset.cardKey !== cardKey;
    dialog.dataset.cardKey = cardKey;
    modalKind = kind;
    dialog.dataset.kind = kind;
    const focus = document.activeElement;
    const focusAction = focus?.dataset?.action, focusId = focus?.dataset?.id;
    dialog.classList.toggle('wide', wide);
    $('modal-content').innerHTML = '<div class="modal-inner"><div class="modal-header"><div><div class="eyebrow">' + eyebrow + '</div><h2 id="modal-title">' + title + '</h2></div>' + (!mandatory ? '<button class="modal-close" data-action="close" aria-label="Close dialog">×</button>' : '') + '</div><div class="modal-body">' + body + '</div>' + (actions ? '<div class="modal-actions">' + actions + '</div>' : '') + '</div>';
    if (!dialog.open) dialog.showModal();
    else if (focusAction) {
      const match = [...dialog.querySelectorAll('button')].find(el => el.dataset.action === focusAction && el.dataset.id === focusId && !el.disabled);
      match?.focus();
    }
    if (entering && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const target = dialog.querySelector('.event-card') || dialog.querySelector('.modal-inner');
      target.animate([{ opacity: 0, transform: 'perspective(900px) translateY(28px) rotateX(-12deg) scale(.93)' }, { opacity: 1, transform: 'perspective(900px) translateY(0) rotateX(0) scale(1)' }], { duration: 550 / settings.animationSpeed, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  }
  function closeModal() {
    const wasWheel = modalKind === 'wheel-result', wasManager = modalKind === 'manager';
    // Closing the build prompt any way (Ignore, ✕ or Escape) skips it for this landing.
    if (modalKind === 'build-prompt' && game) buildPromptIgnored = buildPromptKey();
    dialog.close(); modalKind = null; modalKey = '';
    // Back from raising cash: a jailed player's choice comes back.
    if (wasManager && game) queueMicrotask(() => { if (game && jailPromptDue()) { syncModal(true); applyPermissions(); } });
    // A wheel result holds back the next mandatory dialog (a card or a debt); release it when the result is dismissed.
    if (wasWheel) { wheelBusy = false; clearTimeout(wheelTimer); if (game) queueMicrotask(() => { syncModal(true); applyPermissions(); }); }
  }
  function isMandatoryModal() { return ['offer', 'auction', 'trade', 'wheel', 'freebuild', 'event', 'debt', 'jail'].includes(modalKind) || (modalKind === 'manager' && game?.state.pending?.payer === ownSeat()); }

  // Spaces run anticlockwise from Launch in the lower-right corner.
  function boardCoordinates(id) {
    if (id <= 10) return { row: 10, col: 10 - id };
    if (id <= 20) return { row: 20 - id, col: 0 };
    if (id <= 30) return { row: 0, col: id - 20 };
    return { row: id - 30, col: 10 };
  }

  function skylineHTML() {
    const bars = [12, 20, 9, 15, 7, 23, 13, 18, 9, 17, 24, 10, 15, 8, 21, 11, 17, 6, 14, 22, 8, 16];
    return ['top', 'right', 'bottom', 'left'].map(edge => '<div class="skyline-edge edge-' + edge + '" aria-hidden="true">' + bars.map((height, i) => '<i style="--roof-height:' + height + 'px;flex:' + (i % 3 + 1) + '"></i>').join('') + '</div>').join('');
  }
  function deckSlipsHTML() { return '<span class="deck-slip market-slip" aria-hidden="true"><b>↗</b>MARKET<br>EVENTS</span><span class="deck-slip economic-slip" aria-hidden="true"><b>⌁</b>ECONOMIC<br>EVENTS</span>'; }

  // ── board building ─────────────────────────────────────────────────────────
  // The home preview and default game board share the original CSS grid.
  // A card's contents, the same on every board shape.
  function tileContentsHTML(space, service) {
    return (service ? '' : '<span class="tile-strip"></span>') + '<span class="tile-face">' + (!space.price || service ? '<span class="tile-symbol" aria-hidden="true">' + (spaceIconSVG(space.type) || space.symbol) + '</span>' : '') + '<span class="tile-name">' + space.name + '</span>' + (space.price ? '<span class="tile-price">' + money(space.price) + '</span><span class="tile-owner"></span><span class="tile-buildings"></span>' : '<span class="tile-kind">' + space.caption + '</span>') + '</span>' + (space.price ? '<span class="owner-mark"></span>' : '');
  }
  function buildBoard(container, preview = false) {
    const board = preview ? BOARD : spaces();
    container.classList.toggle('poly-board', board.length !== BOARD.length);
    if (board.length !== BOARD.length) { buildPolygonBoard(container, board); return; }
    container.style.removeProperty('--poly-sides'); polySlots = null;
    container.innerHTML = board.map(space => {
      const { row, col } = boardCoordinates(space.id), group = GROUPS[space.group];
      // Stations and utilities can never be developed, so they carry an icon instead of a colour band.
      const service = ['transport', 'utility'].includes(space.type);
      const contents = tileContentsHTML(space, service);
      const edge = space.id % 10 === 0 ? '' : row === 10 ? ' edge-south' : col === 0 ? ' edge-west' : row === 0 ? ' edge-north' : ' edge-east';
      const attributes = ' class="board-tile' + edge + (!space.price ? ' special' : '') + (service ? ' service' : '') + (space.id % 10 === 0 ? ' corner' : '') + '" style="grid-row:' + (row + 1) + ';grid-column:' + (col + 1) + ';--group-color:' + (group?.color || '#82978f') + '"';
      return preview ? '<div' + attributes + '>' + contents + '</div>' : '<button' + attributes + ' data-action="inspect" data-id="' + space.id + '" aria-label="' + space.name + '">' + contents + '</button>'
        + (space.price ? pieceAnchorHTML(space, row, col, edge.trim()) : '');
    }).join('') + '<div class="board-center" id="' + (preview ? 'preview-center' : 'board-center') + '"></div>' + (!preview ? '<div id="token-layer" class="token-layer" aria-hidden="true"></div>' : '');
    if (preview) $('preview-center').innerHTML = skylineHTML() + deckSlipsHTML() + '<div class="board-wordmark">MONOPOLY<span>NO MERCY</span></div><div class="eyebrow">BUY · BUILD · BANKRUPT YOUR RIVALS</div><p class="preview-center-copy">A CITY OF OPPORTUNITY.<br>A GAME OF CONSEQUENCES.</p>';
  }

  // ── Pentagon and hexagon boards ── Every side holds 10 spaces (its corner first), laid out like the square board's
  // cards: a corner 1.4 units wide, then nine 1 unit wide, all 1.4 units deep. Each card sits in a rotated slot along
  // the polygon's edge. Sides are inset where two meet so neighbouring cards never overlap.
  // A card's styles are written for the square board, where one unit is 7.36% of the board view. Inside each slot a
  // sizing frame (.poly-scope) 13.6 units wide restores that scale, so cards, houses and shields look the same, only smaller.
  const POLY_SCOPE = 13.6;
  let polySlots = null;
  function polygonLayout(sides) {
    const angle = k => (90 - 180 / sides + k * 360 / sides) * Math.PI / 180, unit = Array.from({ length: sides }, (_, k) => [Math.cos(angle(k)), Math.sin(angle(k))]);
    const xs = unit.map(point => point[0]), ys = unit.map(point => point[1]);
    const margin = .012, radius = (1 - 2 * margin) / Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const cx = .5 - radius * (Math.max(...xs) + Math.min(...xs)) / 2, cy = .5 - radius * (Math.max(...ys) + Math.min(...ys)) / 2;
    const vertices = unit.map(([x, y]) => [cx + radius * x, cy + radius * y]);
    const side = 2 * radius * Math.sin(Math.PI / sides), inset = 1 / Math.tan((Math.PI - 2 * Math.PI / sides) / 2);
    const w = side / (10.4 + 2 * 1.4 * inset), depth = 1.4 * w, start = depth * inset;
    const slots = [];
    for (let k = 0; k < sides; k++) {
      const [ax, ay] = vertices[k], [bx, by] = vertices[(k + 1) % sides], ux = (bx - ax) / side, uy = (by - ay) / side;
      let nx = -uy, ny = ux; if ((cx - ax) * nx + (cy - ay) * ny < 0) { nx = -nx; ny = -ny; }
      const rotation = Math.atan2(nx, -ny) * 180 / Math.PI;
      let along = start;
      for (let j = 0; j < 10; j++) {
        const width = j === 0 ? 1.4 * w : w, mid = along + width / 2; along += width;
        slots.push({ id: k * 10 + j, x: ax + ux * mid + nx * depth / 2, y: ay + uy * mid + ny * depth / 2, width, depth, rotation, nx, ny, corner: j === 0 });
      }
    }
    const inner = radius * Math.cos(Math.PI / sides) - depth;
    const felt = vertices.map(([x, y]) => [cx + (x - cx) * inner / (radius * Math.cos(Math.PI / sides)), cy + (y - cy) * inner / (radius * Math.cos(Math.PI / sides))]);
    return { slots, cx, cy, inner, felt, unit: w };
  }
  function buildPolygonBoard(container, board) {
    const sides = board.length / 10, layout = polygonLayout(sides), pct = value => (value * 100).toFixed(3) + '%';
    polySlots = Object.fromEntries(layout.slots.map(slot => [slot.id, slot]));
    container.style.setProperty('--poly-sides', String(sides));
    const tiles = layout.slots.map(slot => {
      const space = board[slot.id], group = GROUPS[space.group], service = ['transport', 'utility'].includes(space.type);
      const contents = tileContentsHTML(space, service);
      const edge = slot.corner ? '' : ' edge-south';
      const tile = '<button class="board-tile' + edge + (!space.price ? ' special' : '') + (service ? ' service' : '') + (slot.corner ? ' corner' : '') + '" style="--group-color:' + (group?.color || '#a4b3b5') + '" data-action="inspect" data-id="' + space.id + '" aria-label="' + space.name + '">' + contents + '</button>';
      const pieces = space.price ? '<div class="tile-pieces' + edge + '" data-pieces="' + space.id + '" aria-hidden="true"><span class="piece-buildings"></span></div>' : '';
      return '<div class="poly-slot" data-slot="' + space.id + '" style="left:' + pct(slot.x - slot.width / 2) + ';top:' + pct(slot.y - slot.depth / 2) + ';width:' + pct(slot.width) + ';height:' + pct(slot.depth) + ';transform:rotate(' + slot.rotation.toFixed(2) + 'deg)">'
        + '<div class="poly-scope" style="--scope:' + (POLY_SCOPE * layout.unit / slot.width).toFixed(4) + '">' + tile + pieces + '</div></div>';
    }).join('');
    const felt = 'polygon(' + layout.felt.map(([x, y]) => pct(x) + ' ' + pct(y)).join(',') + ')';
    // The centre controls keep their square-board size, scaled to fit inside the polygon's felt.
    const centre = 2 * layout.inner * .74, scale = centre / .763;
    container.innerHTML = '<div class="poly-felt" style="clip-path:' + felt + '"></div>' + tiles
      + '<div class="board-center" id="board-center" style="left:' + pct(layout.cx) + ';top:' + pct(layout.cy) + ';--poly-center:' + scale.toFixed(3) + '"></div><div id="token-layer" class="token-layer" aria-hidden="true"></div>';
  }
  // ── 3D board update (replaces updateBoard + updateTokens for live game) ────
  function updateBoard() {
    if (!game) return;
    const s = game.state;
    const potCaption = $('game-board')?.querySelector('[data-id="20"] .tile-kind'); if (potCaption) potCaption.textContent = 'POT ' + money(s.jackpot ?? 100);
    const bankCaption = $('game-board')?.querySelector('[data-id="33"] .tile-kind'); if (bankCaption) bankCaption.textContent = '+' + money(game.bankInterest()) + ' INTEREST';
    updateCityBanner();
    readableBoard?.update(buildAssetMap(), readableTokens(), selectedSpace);

    // 3D tile state

    // Keep the square board's ownership, houses and accessible names in sync.
    spaces().forEach(space => {
      const tile = $('game-board')?.querySelector('[data-id="' + space.id + '"]');
      if (!tile) return;
      tile.classList.toggle('selected', space.id === selectedSpace);
      if (!space.price) return;
      const asset = game.asset(space.id), owner = game.player(asset.owner);
      tile.style.setProperty('--owner-color', owner?.color || 'transparent');
      tile.classList.toggle('mortgaged', asset.mortgaged);
      tile.querySelector('.tile-owner').textContent = owner?.name || '';
      tile.querySelector('.tile-buildings').textContent = asset.mortgaged ? 'M' : asset.buildings === 5 ? '▥' : asset.buildings > 0 ? '⌂' + asset.buildings : '';
      tile.setAttribute('aria-label', space.name + ', ' + money(space.price) + ', ' + (owner ? 'owned by ' + owner.name : 'unowned') + (asset.mortgaged ? ', mortgaged' : ', ' + levelName(asset.buildings)));
    });
    // Ownership shields, houses and towers are drawn from the same state.
    if ($('game-board')) syncPieces($('game-board'), game, TOWER_LEVEL);
  }

  function updateTokens() {
    if (!game) return;
    readableBoard?.update(buildAssetMap(), readableTokens(), selectedSpace);
    const layer = $('token-layer'), board = $('game-board');
    if (layer && board && boardMode === 'classic') {
      const living = game.state.players.filter(player => !player.bankrupt);
      const origin = layer.getBoundingClientRect();
      // Card zones come from the board stylesheet (in cqw; 1cqw = 1% of the board's width).
      const cq = board.getBoundingClientRect().width / 100, vars = getComputedStyle(board.parentElement);
      const size = name => parseFloat(vars.getPropertyValue(name)) * cq;
      const zones = { inner: size('--band') + size('--zone'), side: size('--side-zone'), margin: size('--piece-margin') };
      game.state.players.forEach(player => {
        let token = $('classic-token-' + player.id);
        if (!token) { token = createPawn(player); layer.append(token); }
        token.hidden = player.bankrupt;
        token.classList.toggle('active', player.id === game.active.id);
        token.classList.toggle('mine', player.id === ownSeat());
        token.classList.toggle('jailed', !!player.penalty && !player.bankrupt);
        token.style.setProperty('--piece-color', player.color);
        token.style.setProperty('--move-duration', (150 / settings.movementSpeed) + 'ms');
        // Anchor on the space, in board coordinates, so pieces follow any resize.
        const tile = board.querySelector('.board-tile[data-id="' + player.position + '"]');
        let left, top, right, bottom;
        if (polySlots) {
          // Polygon boards: the slot is rotated, so use its true centre and size, nudged away from the colour band.
          const slot = polySlots[player.position], box = board.querySelector('[data-slot="' + player.position + '"]').getBoundingClientRect();
          const scale = board.clientWidth, half = slot.width * scale * .48, push = slot.depth * scale * (slot.corner ? 0 : .14);
          const x = box.left + box.width / 2 - origin.left - slot.nx * push, y = box.top + box.height / 2 - origin.top - slot.ny * push;
          left = x - half; right = x + half; top = y - half; bottom = y + half;
        } else {
          // Pawns are centred in the card's main area: the card minus its colour band and building
          // zone (corners use the whole card). A group is scaled down if needed so it always fits inside.
          const edge = ['south', 'north', 'west', 'east'].find(side => tile.classList.contains('edge-' + side));
          const rect = tile.getBoundingClientRect();
          left = rect.left - origin.left + zones.margin; top = rect.top - origin.top + zones.margin;
          right = rect.right - origin.left - zones.margin; bottom = rect.bottom - origin.top - zones.margin;
          if (edge === 'south') top += zones.inner; else if (edge === 'north') bottom -= zones.inner;
          else if (edge === 'west') right -= zones.side; else if (edge === 'east') left += zones.side;
        }
        const companions = living.filter(other => other.position === player.position);
        const { scale, points } = clusterOffsets(companions.length);
        const w = token.offsetWidth, h = token.offsetHeight;
        const xs = points.map(([px]) => px * w), ys = points.map(([, py]) => py * w);
        const minX = Math.min(...xs) - scale * w / 2, maxX = Math.max(...xs) + scale * w / 2;
        const minY = Math.min(...ys) - scale * h * .94, maxY = Math.max(...ys) + scale * h * .06;
        const fit = Math.min(1, (right - left) / (maxX - minX), (bottom - top) / (maxY - minY));
        const ax = (left + right) / 2 - fit * (minX + maxX) / 2, ay = (top + bottom) / 2 - fit * (minY + maxY) / 2;
        const [ox, oy] = points[Math.max(0, companions.findIndex(other => other.id === player.id))];
        const x = ax + ox * w * fit - w / 2, y = ay + oy * w * fit - h * .94;
        // Slide only when the pawn changes space or its place in a group; a resize snaps it into place.
        // A step to a new space also replays a short hop; the move itself stays driven by game state.
        const slot = player.position + ':' + companions.findIndex(other => other.id === player.id) + '/' + companions.length;
        const moved = token.dataset.space !== undefined && token.dataset.space !== String(player.position);
        token.style.transition = token.dataset.slot !== undefined && token.dataset.slot !== slot ? '' : 'none';
        token.dataset.slot = slot;
        token.dataset.space = player.position;
        token.style.zIndex = String(Math.round(y + h));
        token.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + (scale * fit) + ')';
        if (moved && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
          token.classList.remove('hop'); void token.offsetWidth; token.classList.add('hop');
        }
      });
    }
  }

  // ── dice HTML for panels (sidebar / center) ────────────────────────────────
  // The 3D scene owns its own dice mesh; the HTML dice in the center panel
  // are kept as a lightweight visual echo and remain unchanged.
  function pipsHTML(value) {
    const spots = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] }[value] || [5];
    return spots.map(spot => '<i class="pip" style="grid-row:' + Math.ceil(spot / 3) + ';grid-column:' + ((spot - 1) % 3 + 1) + '"></i>').join('');
  }
  // Every die is a six-faced CSS cube (opposite faces add up to 7). At rest it turns its value toward the viewer,
  // with a slight tilt of its own so the dice look like they were thrown, not printed.
  // Which face of the cube carries each value, and the cube turn that brings that face to the front.
  const CUBE_FACES = { 1: 'front', 6: 'back', 2: 'right', 5: 'left', 3: 'top', 4: 'bottom' };
  const CUBE_TURN = { 1: [0, 0], 6: [0, 180], 2: [0, -90], 5: [0, 90], 3: [-90, 0], 4: [90, 0] };
  const DIE_TILT = [[-17, -21, -5], [-14, 19, 6], [-19, -9, 3]];
  function dieRest(value, index, spin = [0, 0, 0], shift = [0, 0]) {
    const [x, y] = CUBE_TURN[value] || [0, 0], [tx, ty, tz] = DIE_TILT[index] || DIE_TILT[0], flip = index % 2 ? -1 : 1;
    return 'translate3d(' + shift[0] + '%,' + shift[1] + '%,0) rotateX(' + tx + 'deg) rotateY(' + ty + 'deg) rotateZ(' + (tz + spin[2] * flip) + 'deg) rotateX(' + (x + spin[0]) + 'deg) rotateY(' + (y + spin[1] * flip) + 'deg)';
  }
  function diceHTML(value, index = 0, extra = '') {
    return '<span class="die die3d' + (extra ? ' ' + extra : '') + '" style="--i:' + index + '" data-value="' + value + '" role="img" aria-label="Die: ' + value + (extra === 'dropped' ? ', dropped by Tailwind' : '') + '">'
      + '<span class="die-cube" style="transform:' + dieRest(value, index) + '">'
      + Object.entries(CUBE_FACES).map(([face, side]) => '<span class="die-face ' + side + '">' + pipsHTML(Number(face)) + '</span>').join('') + '</span></span>';
  }
  // The same dice block is drawn on the board, the turn card and the list view.
  function diceBlockHTML(s) {
    const rolling = s.phase === 'rolling', dropped = s.hasRolled && Number.isInteger(s.droppedDie) ? s.droppedDie : null;
    const doubles = s.hasRolled && !rolling && s.dice[0] === s.dice[1];
    return '<div class="dice' + (rolling ? ' rolling' : '') + (doubles ? ' doubles' : '') + (dropped !== null ? ' three' : '') + '">'
      + s.dice.map((value, index) => diceHTML(value, index)).join('') + (dropped !== null ? diceHTML(dropped, 2, 'dropped') : '') + '</div>';
  }
  // The server has already rolled. Each cube is thrown in from the upper left, tumbling end over end, bounces once and
  // settles on the server's value; its shadow on the felt grows as it comes down.
  // A redraw during the roll (presence updates, the turn card) gets fresh cubes, so each one joins the throw where it is now.
  let rollStartedAt = 0;
  function throwDice() {
    if (game?.state.phase !== 'rolling' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const speed = settings.animationSpeed || 1, elapsed = performance.now() - rollStartedAt;
    document.querySelectorAll('.dice.rolling .die3d').forEach(die => {
      const cube = die.querySelector('.die-cube'), index = Number(die.style.getPropertyValue('--i')) || 0, value = Number(die.dataset.value);
      if (!cube || cube.getAnimations().length) return;
      const lag = index * 55, timing = { duration: Math.max(300, 920 / speed - lag), delay: lag, easing: 'cubic-bezier(.3,.55,.35,1)', fill: 'both' };
      const pose = (spin, shift) => dieRest(value, index, spin, shift);
      cube.animate([
        { transform: pose([1080 + index * 180, 720, 220], [-330 + index * 40, -260]), offset: 0 },
        { transform: pose([340, 250, 70], [-40, 0]), offset: .5 },
        { transform: pose([110, 80, 20], [-12, -48]), offset: .7 },
        { transform: pose([0, 0, 0], [0, 0]), offset: .86 },
        { transform: pose([0, 0, 0], [0, -9]), offset: .93 },
        { transform: pose([0, 0, 0], [0, 0]), offset: 1 },
      ], timing).currentTime = elapsed;
      die.animate([
        { transform: 'scale(.25)', opacity: .1, offset: 0 }, { transform: 'scale(1)', opacity: 1, offset: .5 },
        { transform: 'scale(.55)', opacity: .45, offset: .7 }, { transform: 'scale(1)', opacity: 1, offset: .86 },
        { transform: 'scale(.88)', opacity: .85, offset: .93 }, { transform: 'scale(1)', opacity: 1, offset: 1 },
      ], { ...timing, pseudoElement: '::before' }).currentTime = elapsed;
    });
  }

  function phaseDescription() {
    const s = game.state, player = game.active;
    const bot = s.players[actingSeat()];
    if (bot?.type === 'bot' && !['rolling','moving'].includes(s.phase)) return bot.name + ' is ' + ({ready:'preparing to roll',end:'managing its turn',offer:'considering this property',auction:'choosing its bid',trade:'reviewing a trade offer',wheel:'about to spin the wheel',freebuild:'choosing where to build',event:'resolving the event',debt:'settling its debt'}[s.phase] || 'playing') + ' automatically…';
    if (s.phase === 'ready') return player.penalty ? 'Prison: roll doubles or pay ' + money(game.prisonFine()) + ' to leave.' : 'The city is waiting. Make your move.';
    if (s.phase === 'rolling') return 'The dice are in motion…';
    if (s.phase === 'moving') return 'Moving through Northstar City…';
    if (s.phase === 'offer') return 'Buy this property or leave it with the bank.';
    if (s.phase === 'auction') return 'An auction is in progress.';
    if (s.phase === 'trade') return game.player(s.trade.to).name + ' is reviewing a trade offer from ' + game.player(s.trade.from).name + '.';
    if (s.phase === 'event') return 'Resolve your event card.';
    if (s.phase === 'wheel') return 'Spin the Wheel of Fortune!';
    if (s.phase === 'freebuild') return 'Choose where to build your free house.';
    if (s.phase === 'debt') return game.managerPlayer.name + ' needs to settle a payment.';
    return s.extraRoll ? (s.dice[0] === s.dice[1] ? 'Doubles! Nothing happens on this space. Roll again to finish your move.' : 'A lucky break! Roll again straight away.') : 'Manage your assets, then pass the turn.';
  }

  function renderCenter() {
    const s = game.state, player = game.active;
    if ($('readable-turn')) {
      $('readable-turn').innerHTML = '<div class="readable-turn-copy"><span>TURN ' + s.turn + '</span><strong>' + tokenHTML(player.token) + ' ' + escapeHTML(player.name) + '&#39;s turn</strong><p>' + phaseDescription() + '</p><button data-action="locate-active">' + escapeHTML(spaces()[player.position].name) + ' ↓</button></div><div id="readable-dice" class="readable-dice" data-dice-state="' + (s.phase === 'rolling' ? 'rolling' : 'settled') + '" data-dice-values="' + s.dice.join(',') + '">' + diceBlockHTML(s) + '<span>' + (s.phase === 'rolling' ? 'Rolling…' : s.hasRolled ? s.dice.reduce((a,b)=>a+b,0) + ' total' : 'Ready to roll') + '</span></div>';
    }
    $('board-center').innerHTML = '<div class="board-wordmark">MONOPOLY<span>NO MERCY</span></div><div class="eyebrow">BUY · BUILD · BANKRUPT YOUR RIVALS</div><div class="center-role" style="color:' + uiColor(player.color, true) + '">TURN ' + String(s.turn).padStart(2, '0') + '</div><div class="center-player">' + escapeHTML(player.name) + '<span style="color:var(--muted)">&#39;s turn</span></div><p class="center-status">' + phaseDescription() + '</p>' + diceBlockHTML(s) + '<div class="dice-total">' + (s.hasRolled ? s.dice[0] + s.dice[1] + ' TOTAL' + (s.dice[0] === s.dice[1] ? ' · DOUBLES' : '') : 'TWO DICE. YOUR NEXT OPPORTUNITY.') + '</div><div class="center-controls">' + (player.penalty && s.phase === 'ready'
      // Detained: both ways out sit side by side so neither is clipped by the board.
      ? button('Roll for doubles ↗', 'roll', '', !game.canRoll(), 'primary') + button('Pay ' + money(game.prisonFine()) + ' to leave', 'release', '', player.cash < game.prisonFine())
      : button(s.phase === 'end' && s.extraRoll ? 'Roll again ↗' : 'Roll dice ↗', 'roll', '', !game.canRoll(), 'primary') + button('End turn →', 'end', '', s.phase !== 'end' || s.extraRoll)) + '</div>';
    document.querySelectorAll('.mobile-controls [data-action=roll]').forEach(el => { el.disabled = !game.canRoll(); el.textContent = s.extraRoll ? 'Roll again' : 'Roll dice'; });
    document.querySelectorAll('.mobile-controls [data-action=end]').forEach(el => el.disabled = s.phase !== 'end' || s.extraRoll);
    document.querySelectorAll('.mobile-controls [data-action=release]').forEach(el => el.hidden = !(player.penalty && s.phase === 'ready'));

    // Drive the 3D dice — rolling animation or settled display

    updateBoardView(); throwDice();
  }

  function updateBoardView() {
    const zoomed = !!game.state.settings.boardZoom;
    const scroll = $('game-board').closest('.board-scroll');
    if (!scroll) return;
    scroll.classList.toggle('zoomed', zoomed);
    document.querySelectorAll('[data-action=board-fit]').forEach(el => el.setAttribute('aria-pressed', String(!zoomed)));
    document.querySelectorAll('[data-action=board-zoom]').forEach(el => el.setAttribute('aria-pressed', String(zoomed)));
    if (!zoomed) scroll.scrollLeft = 0;
  }
  function renderPlayers() {
    const oldCash = new Map([...document.querySelectorAll('.cash-amount')].map(el => [el.id, el.textContent]));
    const s = game.state;
    $('player-cards').innerHTML = s.players.map(player => {
      // Compact on purpose, so every seat fits without scrolling: name and colour, cash, and the properties owned.
      // Each property is a chip in its colour group (tap it for the deed); a number on it is its building level.
      const owned = game.owned(player);
      const chips = owned.map(space => {
        const asset = game.asset(space.id), level = asset.buildings;
        const label = space.name + (level === 5 ? ' · tower' : level ? ' · ' + level + (level === 1 ? ' house' : ' houses') : '') + (asset.mortgaged ? ' · mortgaged' : '');
        return '<button class="player-property' + (asset.mortgaged ? ' mortgaged' : '') + '" data-action="details" data-id="' + space.id + '" data-buildings="' + level + '" title="' + escapeHTML(label) + '" aria-label="' + escapeHTML(label) + '" style="--chip:' + GROUPS[space.group].color + '">' + (level === 5 ? 'T' : level || '') + '</button>';
      }).join('');
      const status = [player.penalty ? 'In Prison (' + player.penalty.attempts + '/3 rolls)' : '', player.jailFree ? 'Prison pass ×' + player.jailFree : '',
        ...Object.entries(MarketWars.PERK_NAMES).map(([key, name]) => player.perks?.[key] ? name + ' ×' + player.perks[key] : '')].filter(Boolean).join(' · ');
      return '<article class="player-card compact' + (player.id === game.active.id ? ' active' : '') + (player.bankrupt ? ' bankrupt' : '') + '" style="--player-color:' + uiColor(player.color) + '"' + (status ? ' title="' + escapeHTML(status) + '"' : '') + '>'
        + '<div class="player-card-top">' + tokenHTML(player.token) + '<div class="player-name">' + escapeHTML(player.name) + '</div><span class="cash-amount" id="cash-' + player.id + '">' + money(player.cash) + '</span></div>'
        + '<div class="player-own"><span class="own-count">' + (player.bankrupt ? 'Bankrupt' : owned.length + (owned.length === 1 ? ' property' : ' properties')) + '</span>'
        + '<div class="player-properties" aria-label="' + escapeHTML(player.name) + ' properties">' + chips + '</div></div></article>';
    }).join('');
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) document.querySelectorAll('.cash-amount').forEach(el => {
      if (oldCash.has(el.id) && oldCash.get(el.id) !== el.textContent) el.animate([{ backgroundColor: '#d4ead6', transform: 'scale(1.08)' }, { backgroundColor: 'transparent', transform: 'scale(1)' }], { duration: 650 });
    });
    document.querySelectorAll('.player-name').forEach((element,index) => { if (s.players[index]?.type === 'bot') element.insertAdjacentHTML('beforeend','<span class="bot-badge">BOT</span>'); });
    $('active-count').textContent = game.living.length + ' ACTIVE';
    $('role-tip').innerHTML = s.settings.hints ? '<b>COLLECT COLORS.</b>Own 2 properties of a color to double their undeveloped rent and start building houses.' : '';
    const list = $('player-cards'), card = list.querySelector('.player-card.active');
    const listRect = list.getBoundingClientRect(), cardRect = card.getBoundingClientRect();
    if (getComputedStyle(list).flexDirection === 'row') {
      if (cardRect.right > listRect.right) list.scrollLeft += cardRect.right - listRect.right;
      else if (cardRect.left < listRect.left) list.scrollLeft -= listRect.left - cardRect.left;
    } else {
      if (cardRect.bottom > listRect.bottom) list.scrollTop += cardRect.bottom - listRect.bottom;
      else if (cardRect.top < listRect.top) list.scrollTop -= listRect.top - cardRect.top;
    }
  }
  function renderSidebar() {
    const player = game.active, s = game.state;
    $('turn-action-card').innerHTML = '<span class="role-badge" style="--role-color:' + uiColor(player.color) + '">TURN ' + s.turn + '</span><h2>' + escapeHTML(player.name) + ', ' + (s.phase === 'ready' ? 'you&#39;re up.' : 'your move.') + '</h2><p>' + phaseDescription() + '</p>' + (['offer', 'event', 'auction', 'trade', 'debt'].includes(s.phase) ? button('Resume action ↗', 'resume', 'style="width:100%"', false, 'primary') : s.phase === 'ready' && player.penalty ? '<div class="release-choices">' + button('Roll for doubles ↗', 'roll', '', game.busy, 'primary') + button('Pay ' + money(game.prisonFine()) + ' to leave', 'release', '', player.cash < game.prisonFine()) + '</div>' : (s.phase === 'end' && s.extraRoll ? button('Roll again ↗', 'roll', 'style="width:100%"', game.busy || !game.canRoll(), 'primary') : button(s.phase === 'end' ? 'End turn →' : player.penalty ? 'Roll for doubles ↗' : 'Roll dice ↗', s.phase === 'end' ? 'end' : 'roll', 'style="width:100%"', game.busy, 'primary')));
    if (canProposeTrade()) $('turn-action-card').insertAdjacentHTML('beforeend', button('Propose trade ⇄', 'trade-compose', 'style="width:100%;margin-top:8px"'));
    const buffs = (player.penalty ? '<span class="penalty-badge">In Prison · rent active · ' + player.penalty.attempts + '/3</span>' : '') + (player.jailFree ? '<span class="pass-badge" title="Used automatically the next time you would go to Prison">Prison pass × ' + player.jailFree + '</span>' : '') + perkBadgesHTML(player);
    if (buffs) $('turn-action-card').insertAdjacentHTML('beforeend', '<div class="turn-buffs">' + buffs + '</div>');
    $('turn-action-card').insertAdjacentHTML('beforeend', '<p id="turn-timer" class="turn-timer" aria-live="off"></p>'); updateTimer();
    $('turn-action-card').insertAdjacentHTML('beforeend', cityStatusHTML());
    const tray = document.createElement('div'); tray.className = 'sidebar-dice';
    tray.innerHTML = '' + diceBlockHTML(s) + '<span>' + (s.phase === 'rolling' ? 'Rolling…' : s.hasRolled ? s.dice.reduce((a, b) => a + b, 0) + ' TOTAL' : 'YOUR NEXT OPPORTUNITY') + '</span>';
    $('turn-action-card').append(tray); throwDice();
    const space = spaces()[selectedSpace], group = GROUPS[space.group];
    if (space.price) {
      const asset = game.asset(space.id), owner = game.player(asset.owner), rent = owner ? game.calculateRent(space.id) : game.calculateRent(space.id, undefined, player, 0);
      $('property-preview').style.setProperty('--group-color', group.color);
      $('property-preview').innerHTML = '<div class="eyebrow">' + group.name.toUpperCase() + '</div><h3>' + space.name + '</h3>' + ownerHTML(owner) + buildingsHTML(space, asset, owner) + (asset.mortgaged ? '<p>Mortgaged</p>' : '') + '<div class="property-price">' + money(space.price) + '</div><div class="preview-facts"><span>Current rent<b>' + money(rent) + (space.type === 'utility' ? '¹' : '') + '</b></span><span>Building cost<b>' + (space.type === 'property' ? money(game.buildingCost(owner || player, space)) : 'Not eligible') + '</b></span></div>' + button('View property details ↗', 'details', 'data-id="' + space.id + '" style="width:100%"') + (owner?.id === ownSeat() ? button('Auction property', 'auction', 'data-id="' + space.id + '"', !['ready', 'end'].includes(s.phase) || asset.mortgaged) : '');
    } else {
      $('property-preview').style.setProperty('--group-color', 'var(--cyan)');
      $('property-preview').innerHTML = '<div class="eyebrow">CITY SPACE</div><h3>' + space.name + '</h3><p>' + specialDescription(space.type) + '</p>' + button('View space details ↗', 'details', 'data-id="' + space.id + '" style="width:100%;margin-top:18px"');
    }
    const financialPlayer = game.player(ownSeat()) || player, f = game.finances(financialPlayer);
    $('financial-summary').innerHTML = '<div class="section-label">YOUR FINANCIAL POSITION</div>' + [['Cash', financialPlayer.cash], ['Property value', f.propertyValue], ['Building value', f.buildingValue], ['Mortgage debt', f.mortgageDebt], ['Rent earned', financialPlayer.stats.rentEarned], ['Rent paid', financialPlayer.stats.rentPaid], ['Net worth', f.netWorth]].map(([label, value]) => '<div class="finance-row' + (label === 'Net worth' ? ' total' : '') + '"><span>' + label + '</span><b>' + money(value) + '</b></div>').join('');
  }
  function specialDescription(type) {
    const pot = game ? money(game.state.jackpot ?? 100) : '$100';
    return {
      start: 'Collect $200 each time you pass or land on Launch while moving forward.',
      tax: 'Pay the lesser of $200 and 10% of your cash. The $200 grows to $400, $600, $800 and $1,000 in later game stages. Half of it goes into the Free Market jackpot.',
      wealth: 'Pay $15 for each property and $25 for each building level you own (more in later game stages). Own nothing, owe nothing. Half goes into the Free Market jackpot.',
      market: 'Draw a Market Event from ' + MarketWars.DECKS.market.length + ' original cards. Resolve it before continuing.',
      economic: 'Draw an Economic Event from ' + MarketWars.DECKS.economic.length + ' original cards. Some events affect every active player.',
      prison: 'Landing here locks you up. Get out by rolling doubles, paying the fine, or paying it after three failed rolls. The fine is $50 and rises by $100 every 20 rounds. A stored Get out of Prison free card is used automatically. You keep collecting rent while inside.',
      free: 'Win the jackpot! Half of every tax, fine and card payment goes into the pot, which starts at $100 and resets after each win. The pot right now: ' + pot + '.',
      wheel: 'Spin the Wheel of Fortune: a jackpot, cash wins, a free house, a power-up or a free spin, but also a bad spin and the Taxman. The wheel is weighted so an average spin is worth about zero. Cash prizes grow with the game stage.',
      exchange: 'Dividend Day: collect $5 for every property anyone owns, times the game stage.',
      luxury: 'Pay $100 times the game stage. Half of it goes into the Free Market jackpot.',
      express: 'The Express Line takes you straight to a random station. Collect Launch money if the ride passes Launch, then buy the station or pay its rent.',
      bank: 'Receive interest: $50, rising by $50 every 7 rounds. Property mortgages are the only bank borrowing available.',
      auction: 'A randomly chosen unowned asset is offered for purchase. Buy it or skip it. Only an owner can later choose to auction a property. If all assets are owned, receive $40.'
    }[type];
  }
  // ── Wheel of Fortune ── The server picks the slice; the browser only draws the wheel and turns it to that slice.
  const WHEEL_COLORS = { cash: ['#e9c46a', '#f0d68a'], pay: ['#c4584a', '#d97a6c'], build: ['#4f9d8f', '#6bb8aa'], power: ['#7b6cc4', '#9487d8'], free: ['#4a86b8', '#6aa2d0'] };
  function wheelHTML() {
    const slices = game.wheelSegments(), seg = 360 / slices.length, point = (angle, radius) => [150 + radius * Math.sin(angle * Math.PI / 180), 150 - radius * Math.cos(angle * Math.PI / 180)];
    const paths = slices.map((slice, i) => {
      const [x1, y1] = point(i * seg, 140), [x2, y2] = point((i + 1) * seg, 140), colors = WHEEL_COLORS[slice.kind];
      // Labels run along the slice (more room than across it); on the left half they are flipped so they never read upside down.
      const mid = (i + .5) * seg, [tx, ty] = point(mid, 90), turn = mid > 180 ? mid + 90 : mid - 90;
      const lines = slice.amountText ? [slice.label, slice.amountText] : slice.label.split(' '), sizes = slice.amountText ? [11.5, 18] : [13.5, 13.5];
      const tspans = lines.map((line, n) => '<tspan x="' + tx.toFixed(2) + '" dy="' + (n === 0 ? (-(lines.length - 1) * .55).toFixed(2) + 'em' : '1.1em') + '" font-size="' + sizes[n] + '">' + escapeHTML(line) + '</tspan>').join('');
      return '<path d="M150 150 L' + x1.toFixed(2) + ' ' + y1.toFixed(2) + ' A140 140 0 0 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + ' Z" fill="' + colors[i % 2] + '" stroke="#2a1f12" stroke-width="2.5"/>'
        + '<text transform="rotate(' + turn + ' ' + tx.toFixed(2) + ' ' + ty.toFixed(2) + ')" y="' + ty.toFixed(2) + '" text-anchor="middle" dominant-baseline="middle" font-weight="800" fill="' + (slice.kind === 'cash' ? '#2a1f12' : '#fff') + '">' + tspans + '</text>';
    }).join('');
    return '<div class="wheel-wrap"><div class="wheel-pointer" aria-hidden="true"></div><div class="wheel-disc" id="wheel-disc"><svg viewBox="0 0 300 300" role="img" aria-label="Wheel of Fortune with ' + slices.length + ' slices: ' + slices.map(slice => slice.text).join(', ') + '">'
      + paths + '<circle cx="150" cy="150" r="140" fill="none" stroke="#c9a24a" stroke-width="6"/><circle cx="150" cy="150" r="20" fill="#2a1f12" stroke="#c9a24a" stroke-width="4"/></svg></div></div>';
  }
  // Each slice's chance, so the odds are never hidden behind equal-looking slices.
  function wheelOddsHTML() {
    return '<ul class="wheel-odds" aria-label="Chance of each slice">' + game.wheelSegments().map(slice => '<li class="tier-' + slice.tier + '"><i style="background:' + WHEEL_COLORS[slice.kind][0] + '"></i><span>' + escapeHTML(slice.text) + '</span><b>' + (slice.chance * 100).toFixed(slice.chance < .1 ? 1 : 0) + '%</b></li>').join('') + '</ul>';
  }
  function renderWheel() {
    const player = game.active, stage = game.stage(), chain = game.state.wheelFree || 0;
    showModal('wheel', 'Wheel of Fortune', wheelHTML() + '<p class="wheel-caption">' + escapeHTML(player.name) + (chain ? ' has a free spin (' + chain + ' of 3 in a row).' : player.type === 'bot' ? ' is about to spin.' : ', spin to see what the city has in store.') + (stage > 1 ? ' Cash prizes are ×' + stage + ' at this stage of the game.' : '') + '</p>' + wheelOddsHTML(), button(chain ? 'Free spin ↗' : 'Spin the wheel ↗', 'spin', '', false, 'primary'), { mandatory: true, eyebrow: 'STEP RIGHT UP' });
  }
  // The Free house prize: choose where the free building level goes.
  function renderFreeBuild() {
    const player = game.active, mine = player.id === ownSeat(), targets = game.freeBuildTargets(player);
    showModal('freebuild', 'Free house', '<p>' + escapeHTML(player.name) + (mine ? ', choose a property for your free building level. The even-building rule applies, but you do not need to land there.' : ' is choosing where to build.') + '</p><div class="freebuild-list">'
      + targets.map(space => '<div class="freebuild-item" style="--group-color:' + GROUPS[space.group].color + '"><div><b>' + escapeHTML(space.name) + '</b><span>' + GROUPS[space.group].name + ' · ' + levelName(game.asset(space.id).buildings) + ' → ' + levelName(game.asset(space.id).buildings + 1) + '</span></div>' + button('Build free', 'free-build', 'data-id="' + space.id + '"', false, 'primary') + '</div>').join('') + '</div>', '', { mandatory: true, eyebrow: 'WHEEL PRIZE' });
  }
  function perkBadgesHTML(player) {
    return Object.entries(MarketWars.PERK_NAMES).map(([key, name]) => player.perks?.[key] ? '<span class="perk-badge perk-' + key + '" title="' + name + ': ' + player.perks[key] + ' use' + (player.perks[key] === 1 ? '' : 's') + ' left">' + name.replace('Rent ', '') + ' ×' + player.perks[key] + '</span>' : '').join('');
  }
  // Banner above the board: the active City Event with its rounds left, and the one announced for next round.
  function updateCityBanner() {
    const el = $('city-banner'); if (!el || !game) return;
    const lines = game.cityLines(); el.hidden = !lines.length;
    el.innerHTML = lines.map(line => '<span class="city-chip ' + (/^Next round/.test(line) ? 'upcoming' : 'active') + '">' + escapeHTML(line) + '</span>').join('');
  }
  function showWheelResult(last) {
    const player = game.player(last.player), segments = game.wheelSegments(), reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    wheelBusy = true; clearTimeout(wheelTimer);
    showModal('wheel-result', 'Wheel of Fortune', wheelHTML() + '<p class="wheel-caption">' + escapeHTML(player.name) + ' spins…</p><p class="wheel-outcome" id="wheel-outcome" hidden></p>', button('Continue', 'wheel-continue', '', false, 'primary'), { eyebrow: 'THE WHEEL HAS SPOKEN' });
    const disc = $('wheel-disc'), caption = dialog.querySelector('.wheel-caption'), outcome = $('wheel-outcome');
    const reveal = () => {
      if (modalKind !== 'wheel-result') return;
      caption.textContent = player.name + ' landed on “' + segments[last.index].text + '”.';
      outcome.hidden = false; outcome.textContent = last.outcome;
      outcome.dataset.kind = segments[last.index].kind;
      // Give everyone a moment to read it, then move on to whatever the wheel set up (a card or a payment).
      wheelTimer = setTimeout(() => { if (wheelBusy && modalKind === 'wheel-result') { wheelBusy = false; closeModal(); } }, 6000);
    };
    const turns = 360 * 5 + (360 - (last.index + .5) * (360 / segments.length));
    if (reduced) { disc.style.transform = 'rotate(' + turns + 'deg)'; reveal(); return; }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      disc.style.transition = 'transform ' + (3.6 / settings.animationSpeed) + 's cubic-bezier(.1,.7,.1,1)';
      disc.style.transform = 'rotate(' + turns + 'deg)';
    }));
    wheelTimer = setTimeout(reveal, 3700 / settings.animationSpeed);
  }
  // Status shown under the turn card: jackpot, game stage and City Events.
  function cityStatusHTML() {
    const s = game.state, stage = game.stage(), rows = ['<p><b>Round ' + (s.round || 1) + '</b> · Free Market jackpot <b>' + money(s.jackpot ?? 100) + '</b></p>'];
    if (stage > 1) rows.push('<p>Game stage ×' + stage + ': card, wheel and tax amounts are multiplied.</p>');
    game.cityLines().forEach(line => rows.push('<p class="city-event">' + escapeHTML(line) + '</p>'));
    return '<div class="city-status" aria-label="City status">' + rows.join('') + '</div>';
  }
  // ── Notifications ── Each one says whose news it is and whether it is good or bad for them:
  // green for gains, red for losses, violet for power-ups, orange for Prison, gold for deals, blue for City Events.
  const TOAST_ICONS = {
    gain: '<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/>', loss: '<path d="M12 5v14M5.5 12.5 12 19l6.5-6.5"/>',
    power: '<path d="M12 2.5l2.3 6.2 6.2 2.3-6.2 2.3L12 19.5l-2.3-6.2L3.5 11l6.2-2.3z"/><path d="M19 17.5v4M17 19.5h4"/>',
    prison: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3M12 14.5v2.5"/>',
    deal: '<path d="M3.5 11 12 4l8.5 7M6.5 9.5V20h11V9.5M10 20v-5h4v5"/>', city: '<path d="M3 21h18M5 21V10l5-3v14M10 21V4l9 4.5V21M13.5 11h2M13.5 15h2"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 8v.5M12 11.5V17"/>',
  };
  const TOAST_TITLES = { gain: 'Gain', loss: 'Loss', power: 'Power-up', prison: 'Locked up', deal: 'Deal', city: 'City Event', info: 'Update' };
  const TOAST_NOISE = /begins turn|spun the Wheel|steps onto the Wheel|^Card die|^Tailwind:|offered .+ a trade|^A new circuit/;
  function toneOf(entry) {
    if (entry.tone) return entry.tone;
    if (/ received | passed Launch/.test(entry.message)) return 'gain';
    if (/ paid /.test(entry.message)) return 'loss';
    return 'info';
  }
  function toastWorthy(entry) {
    if (TOAST_NOISE.test(entry.message)) return false;
    return !!entry.tone || entry.kind === 'money' || entry.kind === 'important' || /^(No rent|Wealth Tax|Business Tax|Free Market)/.test(entry.message);
  }
  function toastTitle(entry, tone) {
    if (/wins MONOPOLY/.test(entry.message)) return 'Victory';
    if (/is bankrupt/.test(entry.message)) return 'Bankrupt';
    if (tone === 'power') return Object.values(MarketWars.PERK_NAMES || {}).find(name => entry.message.includes(name)) || (/Prison free/.test(entry.message) ? 'Prison pass' : /rolls again/.test(entry.message) ? 'Roll Again' : 'Power-up');
    if (/free spin/.test(entry.message)) return 'Free spin';
    if (/free level/.test(entry.message)) return 'Free building';
    if (/Launch/.test(entry.message) && tone === 'gain') return 'Launch';
    if (/purchased|won .+ for/.test(entry.message)) return 'Purchased';
    if (/developed/.test(entry.message)) return 'Built';
    if (/declined the trade offer/.test(entry.message)) return 'Trade declined';
    if (/accepted/.test(entry.message)) return 'Trade';
    return TOAST_TITLES[tone] || 'Update';
  }
  function toastAmount(entry, tone) {
    if (!['gain', 'loss'].includes(tone)) return 0;
    const amounts = (entry.message.match(/\$[\d,]+/g) || []).map(value => Number(value.replace(/[$,]/g, '')));
    return / plus /.test(entry.message) ? amounts.reduce((a, b) => a + b, 0) : amounts[0] || 0;
  }
  function flash(entry) {
    if (typeof entry === 'string') entry = { message: entry, kind: 'normal' };
    const hold = toastHoldUntil - Date.now();
    if (hold > 0) { setTimeout(() => flash(entry), hold); return; }
    let stack = $('toast-stack');
    if (!stack) { stack = document.createElement('div'); stack.id = 'toast-stack'; stack.className = 'toast-stack'; stack.setAttribute('aria-live', 'polite'); document.body.append(stack); }
    if ([...stack.children].some(item => item.dataset.message === entry.message && !item.classList.contains('hide'))) return;
    const tone = toneOf(entry), who = Number.isInteger(entry.player) ? game?.player(entry.player) : null, amount = toastAmount(entry, tone);
    const item = document.createElement('div');
    item.className = 'toast-item tone-' + tone + (who && who.id === ownSeat() ? ' mine' : ''); item.dataset.message = entry.message; item.setAttribute('role', 'status');
    const life = ['loss', 'prison', 'power'].includes(tone) ? 5200 : 4300;
    item.style.setProperty('--life', life + 'ms');
    item.innerHTML = '<span class="toast-icon" aria-hidden="true"><svg viewBox="0 0 24 24">' + TOAST_ICONS[tone] + '</svg></span>'
      + '<div class="toast-body"><div class="toast-head"><span class="toast-title">' + escapeHTML(toastTitle(entry, tone)) + '</span>'
      + (who ? '<span class="toast-who">' + tokenHTML(who.token) + escapeHTML(who.id === ownSeat() ? 'You' : who.name) + '</span>' : '')
      + (amount ? '<b class="toast-amount">' + (tone === 'gain' ? '+' : '−') + '<span>' + money(amount) + '</span></b>' : '') + '</div>'
      + '<p class="toast-text"></p></div><i class="toast-life" aria-hidden="true"></i>';
    item.querySelector('.toast-text').textContent = entry.message;
    // A bot's few-word remark on a declined trade, shown as its own quote line.
    if (entry.remark) { const quote = document.createElement('p'); quote.className = 'toast-remark'; quote.textContent = '“' + entry.remark + '”'; item.querySelector('.toast-body').append(quote); }
    stack.append(item);
    // Count the amount up so the change reads at a glance.
    const figure = item.querySelector('.toast-amount span');
    if (figure && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const start = performance.now(), step = now => { const t = Math.min(1, (now - start) / 520); figure.textContent = money(Math.round(amount * (1 - Math.pow(1 - t, 3)))); if (t < 1 && item.isConnected) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }
    const dismiss = () => {
      if (item.classList.contains('hide')) return;
      item.style.marginBottom = -(item.offsetHeight + 8) + 'px'; item.classList.add('hide');
      setTimeout(() => item.remove(), 360);
    };
    item.addEventListener('click', dismiss);
    const live = [...stack.children].filter(el => !el.classList.contains('hide'));
    if (live.length > 3) live.slice(0, live.length - 3).forEach(el => el.dispatchEvent(new Event('click')));
    setTimeout(dismiss, life);
  }
  // A "+$70" or "−$150" rises from the player's cash when it changes.
  function floatCash(id, delta) {
    const target = $('cash-' + id); if (!target || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const show = () => {
      const anchor = $('cash-' + id); if (!anchor) return;
      const rect = anchor.getBoundingClientRect(); if (!rect.width) return;
      const float = document.createElement('span'); float.className = 'cash-float ' + (delta > 0 ? 'gain' : 'loss');
      float.textContent = (delta > 0 ? '+' : '−') + money(Math.abs(delta));
      float.style.left = Math.min(Math.max(rect.left + rect.width / 2, 50), innerWidth - 50) + 'px'; float.style.top = rect.top + 'px';
      // A clipping layer keeps a float from widening the page if the window shrinks while it rises.
      let layer = $('fx-floats'); if (!layer) { layer = document.createElement('div'); layer.id = 'fx-floats'; layer.setAttribute('aria-hidden', 'true'); document.body.append(layer); }
      layer.append(float); setTimeout(() => float.remove(), 1600);
    };
    const hold = toastHoldUntil - Date.now();
    hold > 0 ? setTimeout(show, hold) : show();
  }
  // ── Card dice ── The server has already rolled; every screen throws the same die and lands on that value.
  function showCardDie(last) {
    const player = game.player(last.player), reduced = matchMedia('(prefers-reduced-motion: reduce)').matches, speed = settings.animationSpeed || 1;
    const throwTime = reduced ? 0 : 1500 / speed, readTime = 1900;
    dieBusy = true; clearTimeout(dieTimer); toastHoldUntil = Date.now() + throwTime + readTime + 650;
    $('fx-stage')?.remove();
    const stage = document.createElement('div'); stage.id = 'fx-stage'; stage.className = 'fx-stage tone-' + (last.tone || 'neutral');
    const area = document.querySelector('.board-area')?.getBoundingClientRect();
    if (area?.width) Object.assign(stage.style, { left: area.left + 'px', top: Math.max(0, area.top) + 'px', width: area.width + 'px', height: Math.min(area.height, innerHeight - Math.max(0, area.top)) + 'px' });
    stage.innerHTML = '<div class="fx-panel" role="status" aria-live="polite"><p class="fx-kicker">CARD DIE</p>'
      + '<p class="fx-title">' + tokenHTML(player.token) + '<span>' + escapeHTML(player.id === ownSeat() ? 'You roll' : player.name + ' rolls') + ' for “' + escapeHTML(last.title) + '”</span></p>'
      + '<div class="fx-scene"><div class="fx-cube">' + Object.entries(CUBE_FACES).map(([value, face]) => '<span class="fx-face ' + face + '">' + pipsHTML(Number(value)) + '</span>').join('') + '</div><span class="fx-shadow"></span></div>'
      + '<div class="fx-result" hidden><b></b><span></span></div></div>';
    document.body.append(stage);
    const cube = stage.querySelector('.fx-cube'), shadow = stage.querySelector('.fx-shadow'), [x, y] = CUBE_TURN[last.value] || [0, 0];
    const pose = (lift, ex, ey) => 'translate3d(0,' + lift + 'px,0) rotateX(-15deg) rotateY(-19deg) rotateX(' + (x + ex) + 'deg) rotateY(' + (y + ey) + 'deg)';
    const rest = pose(0, 0, 0);
    const reveal = () => {
      if (!stage.isConnected) return;
      cube.style.transform = rest; stage.classList.add('revealed');
      const result = stage.querySelector('.fx-result'); result.hidden = false;
      result.querySelector('b').textContent = last.result || String(last.value);
      result.querySelector('span').textContent = last.detail || 'Rolled ' + last.value;
      playSound(last.tone === 'gain' ? 'income' : last.tone === 'loss' ? 'payment' : 'event');
      dieTimer = setTimeout(() => {
        stage.classList.add('leaving'); setTimeout(() => stage.remove(), 320);
        dieBusy = false; if (game) { syncModal(true); applyPermissions(); }
      }, readTime);
    };
    if (reduced) { reveal(); return; }
    playSound('dice');
    const timing = { duration: throwTime, easing: 'cubic-bezier(.33,.6,.4,1)', fill: 'forwards' };
    cube.animate([
      { transform: pose(-210, 1080, 720), offset: 0 }, { transform: pose(0, 300, 210), offset: .5 },
      { transform: pose(-54, 90, 60), offset: .7 }, { transform: pose(0, 0, 0), offset: .86 },
      { transform: pose(-10, 0, 0), offset: .93 }, { transform: rest, offset: 1 },
    ], timing);
    shadow.animate([
      { transform: 'scale(.35)', opacity: .2, offset: 0 }, { transform: 'scale(1)', opacity: .7, offset: .5 },
      { transform: 'scale(.7)', opacity: .45, offset: .7 }, { transform: 'scale(1)', opacity: .7, offset: .86 },
      { transform: 'scale(.92)', opacity: .65, offset: .93 }, { transform: 'scale(1)', opacity: .7, offset: 1 },
    ], timing);
    dieTimer = setTimeout(reveal, throwTime);
  }
  // Mirrors turnDeadline() in lib/bot-timing.ts; the server enforces the real limit.
  function turnDeadline() {
    const t = metadata?.transition, s = game?.state;
    if (!metadata?.updated_at || !s || ['rolling', 'moving', 'victory'].includes(s.phase)) return null;
    const seat = actingSeat();
    if (metadata.members[seat]?.type === 'bot') return null;
    return Date.parse(metadata.updated_at) + (t?.action === 'roll' ? 950 : 0) + (t?.action === 'spin' ? 4500 : 0) + (t?.die ? 4000 : 0) + (t?.path?.length || 0) * 150 + (s.phase === 'event' ? 4000 : 1100) + 90000;
  }
  function updateTimer() {
    const el = $('turn-timer'); if (!el || !game) return;
    const deadline = turnDeadline();
    if (deadline === null) { el.textContent = ''; return; }
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000)), s = game.state;
    const who = game.player(actingSeat());
    el.textContent = '⏱ ' + (ownSeat() === who.id ? 'Your' : who.name + '’s') + ' time: ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
    el.classList.toggle('urgent', left <= 15);
  }
  setInterval(updateTimer, 1000);
  function renderLog() {
    const entries = game.state.log.filter(entry => entry.id > lastLogId);
    if (lastLogId) entries.filter(toastWorthy).forEach((entry, index) => setTimeout(() => flash(entry), index * 140));
    const log = $('game-log');
    entries.forEach(entry => { const row = document.createElement('div'); row.className = 'log-row ' + entry.kind; const label = document.createElement('span'); label.textContent = 'T' + String(entry.turn).padStart(2, '0'); const message = document.createElement('span'); message.textContent = entry.message + (entry.remark ? ' “' + entry.remark + '”' : ''); row.append(label, message); log.append(row); });
    while (log.childElementCount > 100) log.firstElementChild.remove();
    if (entries.length) { lastLogId = entries.at(-1).id; log.scrollTop = log.scrollHeight; }
    $('log-count').textContent = game.state.history.length + ' ROLLS RECORDED';
  }
  function onGameChange() {
    if (!game) return;
    // The selected space must exist on this game's board (40, 50 or 60 spaces).
    if (!spaces()[selectedSpace]) selectedSpace = game.active.position;
    const s = game.state;
    if (s.phase !== 'rolling' && !diceAudio.paused) { diceAudio.pause(); diceAudio.currentTime = 0; }
    if (s.phase === 'victory') { closeModal(); renderVictory(); showScreen('victory'); autoSave(); return; }
    if (lastWheelId === null) lastWheelId = s.lastWheel?.id || 0;
    else if (s.lastWheel && s.lastWheel.id > lastWheelId) { lastWheelId = s.lastWheel.id; showWheelResult(s.lastWheel); }
    if (lastDieId === null) lastDieId = s.lastDie?.id || 0;
    else if (s.lastDie && s.lastDie.id > lastDieId) { lastDieId = s.lastDie.id; showCardDie(s.lastDie); }
    if (s.phase === 'moving' && lastPhase === 'moving') { updateTokens(); return; }
    if (lastPhase === 'moving' && !game.busy) selectedSpace = game.active.position;
    const oldCash = Object.fromEntries(s.players.map(player => [player.id, $('cash-' + player.id)?.textContent]));
    $('turn-label').textContent = 'TURN ' + String(s.turn).padStart(2, '0');
    updateBoardHint();
    if (s.phase === 'rolling' && lastPhase !== 'rolling') rollStartedAt = performance.now();
    renderPlayers(); renderCenter(); updateBoard(); updateTokens(); renderSidebar(); renderLog();
    s.players.forEach(player => { if (oldCash[player.id] && oldCash[player.id] !== money(player.cash)) $('cash-' + player.id)?.classList.add('money-changed'); });
    s.players.forEach(player => {
      const before = cashSeen[player.id]; cashSeen[player.id] = player.cash;
      if (before !== undefined && before !== player.cash) floatCash(player.id, player.cash - before);
    });
    lastPhase = s.phase;
    syncModal(); autoSave(); applyPermissions();
  }
  function autoSave() { $('save-status').textContent = 'Room ' + (metadata?.code || '') + ' · Saved online'; }
  function saveGame(manual = true) { if (manual) notify('Every completed action is saved online automatically.'); }
  function syncModal(force = false) {
    const s = game.state;
    if (wheelBusy || dieBusy) return;
    const key = JSON.stringify([s.phase, s.offer, s.event, s.auction, s.trade, s.pending, game.managerPlayer.cash]);
    if (s.phase === 'debt' && modalKind === 'manager') { renderManager(); return; }
    if (['offer', 'event', 'auction', 'trade', 'wheel', 'freebuild', 'debt'].includes(s.phase)) {
      if (actingSeat() !== ownSeat() && !['event', 'auction', 'trade', 'wheel'].includes(s.phase)) { if (isMandatoryModal()) closeModal(); return; }
      if (key === modalKey && !force) return;
      modalKey = key;
      if (s.phase === 'offer') renderOffer();
      if (s.phase === 'event') renderEvent();
      if (s.phase === 'auction') renderAuction();
      if (s.phase === 'trade') renderTrade();
      if (s.phase === 'wheel') renderWheel();
      if (s.phase === 'freebuild') renderFreeBuild();
      if (s.phase === 'debt') renderDebt();
    } else if (jailPromptDue()) {
      // A jailed player must choose: roll for doubles or pay to leave. Raising cash in the portfolio is allowed first.
      if (modalKind === 'manager') { renderManager(); return; }
      const jailKey = JSON.stringify(['jail', s.turn, s.round, game.active.cash]);
      if (jailKey !== modalKey || force || modalKind !== 'jail') { modalKey = jailKey; renderJailPrompt(); }
    } else if (buildPromptDue()) {
      const buildKey = buildPromptKey();
      if (buildKey !== modalKey || force) { modalKey = buildKey; renderBuildPrompt(); }
    } else if (isMandatoryModal() || modalKind === 'build-prompt') closeModal();
    else if (modalKind === 'manager') renderManager();
    else if (modalKind === 'details') renderDetails(selectedSpace);
  }
  // ── Turn prompts ── Shown only to the player whose turn it is, on every screen size.
  let buildPromptIgnored = '';
  function myTurn() { const s = game.state; return ownSeat() === s.currentPlayer && !game.active.bankrupt && game.active.type !== 'bot' && !game.busy && !animating; }
  function jailPromptDue() { return myTurn() && game.state.phase === 'ready' && !!game.active.penalty && (!modalKind || ['jail', 'manager'].includes(modalKind)); }
  function buildPromptKey() { const s = game.state, player = game.active; return 'build:' + s.turn + ':' + player.position + ':' + game.asset(player.position)?.buildings; }
  function buildPromptDue() {
    const s = game.state, player = game.active, space = spaces()[player.position];
    if (!myTurn() || s.phase !== 'end' || s.extraRoll || space.type !== 'property' || game.asset(space.id).owner !== player.id) return false;
    if (game.buildReason(player, space.id) || buildPromptIgnored === buildPromptKey()) return false;
    return !modalKind || modalKind === 'build-prompt';
  }
  function renderBuildPrompt() {
    const player = game.active, space = spaces()[player.position], asset = game.asset(space.id), cost = game.buildingCost(player, space);
    const next = asset.buildings + 1 >= TOWER_LEVEL ? 'a tower' : asset.buildings ? 'house ' + (asset.buildings + 1) : 'a house';
    const after = asset.buildings + 1, rentNow = game.calculateRent(space.id, 7), rentAfter = game.calculateRent(space.id, 7, undefined, after);
    showModal('build-prompt', 'Build on ' + escapeHTML(space.name) + '?', '<div class="detail-banner" style="--group-color:' + GROUPS[space.group].color + '"><h3>' + escapeHTML(space.name) + '</h3><span>' + money(cost) + '</span></div>'
      + '<p>You landed on your own property. Build ' + next + ' now for ' + money(cost) + '. Rent goes from ' + money(rentNow) + ' to ' + money(rentAfter) + '. You can build one level per landing.</p>'
      + '<p class="note">You have ' + money(player.cash) + '. Ignore to keep your cash; you can still build from the property card until you end your turn.</p>',
      button('Ignore', 'build-ignore') + button('Build ' + next + ' · ' + money(cost), 'build', 'data-id="' + space.id + '"', false, 'primary'), { eyebrow: 'BUILD' });
  }
  function renderJailPrompt() {
    const player = game.active, fine = game.prisonFine(), short = player.cash < fine;
    showModal('jail', 'You are in Prison', '<p>Choose how to try to leave this turn: roll for doubles, or pay ' + money(fine) + ' and roll normally.</p>'
      + '<p class="note">Attempt ' + (player.penalty.attempts + 1) + ' of 3. After three failed rolls you must pay ' + money(fine) + ' anyway. You keep collecting rent while inside.'
      + (short ? ' You have ' + money(player.cash) + ', so raise cash in your portfolio to pay.' : '') + '</p>',
      (short ? button('Raise cash', 'manager') : '') + button('Pay ' + money(fine) + ' to leave', 'release', '', short) + button('Roll for doubles ↗', 'roll', '', false, 'primary'), { eyebrow: 'PRISON', mandatory: true });
  }
  function rentRows(space, player) {
    if (space.type !== 'property') {
      const rent = MarketWars.SERVICE_RENT[space.type], stage = game.stage(), utility = space.type === 'utility';
      const owned = game.asset(space.id).owner === null ? 0 : game.owned(game.player(game.asset(space.id).owner)).filter(item => item.group === space.group && !game.asset(item.id).mortgaged).length;
      const cell = factor => utility ? 'Dice × ' + factor * stage : money(factor * stage);
      return '<table class="rent-table"><thead><tr><th>Owner holds</th><th>Rent' + (stage > 1 ? ' (stage ×' + stage + ')' : '') + '</th></tr></thead><tbody>'
        // One row per station (or utility) on this board: 2 on the square board, up to 4 stations on the hexagon.
        + rent.slice(0, game.groupSpaces(space.group).length).map((factor, i) => '<tr' + (owned === i + 1 || (i === rent.length - 1 && owned > i) ? ' class="current"' : '') + '><td>' + (i + 1) + ' ' + (utility ? (i ? 'utilities' : 'utility') : (i ? 'stations' : 'station')) + '</td><td>' + cell(factor) + '</td></tr>').join('') + '</tbody></table>'
        + '<p class="note">' + (utility ? 'Utility rent is the visitor’s dice total × ' + rent[0] + ' with one utility, or × ' + rent[1] + ' with both.' : 'Station rent grows with every station the owner holds: ' + rent.slice(0, game.groupSpaces(space.group).length).map(money).join(', ') + '.') + ' Stations and utilities cannot be built on, so their rent is multiplied by the game stage: ×2 after round 15, ×3 after 30, ×4 after 80 and ×5 after 130.</p>';
    }
    // A third column shows the rent once the owner holds the whole color, which doubles every built level.
    const total = game.groupSpaces(space.group).length, owner = game.player(game.asset(space.id).owner), full = !!owner && game.ownsFullSet(owner, space.group);
    const levelRent = i => i === 4 ? space.apartmentRent : space.houseRents[i];
    return '<table class="rent-table"><thead><tr><th>Development</th><th>Rent</th><th>All ' + total + ' owned</th></tr></thead><tbody>'
      + '<tr' + (game.asset(space.id).buildings === 0 ? ' class="current"' : '') + '><td>Undeveloped</td><td>' + money(space.baseRent) + '</td><td>' + money(space.baseRent * 2) + '</td></tr>'
      + '<tr><td>Owner holds 2+ of this color</td><td>' + money(space.baseRent * 2) + '</td><td>' + money(space.baseRent * 2) + '</td></tr>'
      + Array.from({ length: 5 }, (_, i) => '<tr' + (game.asset(space.id).buildings === i + 1 ? ' class="current"' : '') + '><td>' + levelName(i + 1) + '</td><td>' + money(levelRent(i)) + '</td><td>' + money(levelRent(i) * 2) + '</td></tr>').join('')
      + '</tbody></table><p class="note">Own at least 2 ' + GROUPS[space.group].name + ' properties to double their undeveloped rent. Own all ' + total + ' and every rent on them doubles, from 1 house up to the tower' + (full ? ' (' + escapeHTML(owner.name) + ' owns the full set)' : '') + '. Each level costs ' + money(game.buildingCost(player, space)) + '.</p>';
  }
  function colorCountHTML(space, player) {
    if (!player) return '';
    const owned = game.groupOwnedCount(player, space.group), total = game.groupSpaces(space.group).length;
    return '<p class="color-count" style="--group-color:' + GROUPS[space.group].color + '"><span class="color-dot" aria-hidden="true"></span>' + escapeHTML(player.name) + ' owns <b>' + owned + ' of ' + total + '</b> ' + GROUPS[space.group].name + ' properties</p>';
  }
  function renderOffer() {
    const space = spaces()[game.state.offer], player = game.active, price = game.purchasePrice(player, space);
    showModal('offer', 'Make it yours.', '<div class="detail-banner" style="--group-color:' + GROUPS[space.group].color + '"><div><span class="role-badge" style="--role-color:' + GROUPS[space.group].color + '">' + GROUPS[space.group].name.toUpperCase() + '</span><h3>' + space.name + '</h3></div><span>' + money(price) + '</span></div>' + colorCountHTML(space, player) + '<p>' + escapeHTML(player.name) + ', purchase this property for ' + money(price) + '. Once it is yours, you can choose to auction it from its card or your portfolio.</p>' + buildingsHTML(space, game.asset(space.id), null) + '<div class="detail-grid"><div>Your cash<b>' + money(player.cash) + '</b></div><div>Base rent<b>' + money(game.calculateRent(space.id, undefined, player, 0)) + '</b></div><div>Mortgage value<b>' + money(space.mortgageValue) + '</b></div><div>Building cost<b>' + (space.type === 'property' ? money(game.buildingCost(player, space)) : 'Not eligible') + '</b></div></div>' + rentRows(space, player), button('Skip purchase', 'skip') + button('Buy · ' + money(price), 'buy', '', player.cash < price, 'primary'), { mandatory: true, eyebrow: 'UNOWNED PROPERTY' });
  }
  function renderEvent() {
    const event = game.state.event, card = MarketWars.DECKS[event.deck][event.index], rolls = ['rollcash', 'rollpay', 'gamble'].includes(card.effect);
    showModal('event', event.deck === 'market' ? 'Market Event' : 'Economic Event', '<div class="event-card rarity-' + card.rarity + '"><span class="rarity-tag">' + card.rarity.toUpperCase() + '</span><div class="event-icon" aria-hidden="true">' + (event.deck === 'market' ? '↗' : '⌁') + '</div><h3>' + card.title + '</h3><p>' + escapeHTML(game.describeCard(card)) + '</p></div><p class="note">Drawn by ' + escapeHTML(game.active.name) + (game.active.type === 'bot' ? '. The bot will resolve this card automatically.' : rolls ? '. Nothing is rolled until ' + (game.active.id === ownSeat() ? 'you press the button: roll the die yourself.' : game.active.name + ' rolls the die.') : '. The effect takes place when you continue.') + '</p>', button(rolls ? 'Roll the die ↗' : 'Resolve event →', 'apply-event', '', false, 'primary'), { mandatory: true, eyebrow: 'THE MARKET HAS NEWS' });
  }
  function renderAuction() {
    const auction = game.state.auction, space = spaces()[auction.property], bidder = game.player(auction.bidder), leader = game.player(auction.leader), seller = game.player(auction.seller);
    showModal('auction', space.name, ownerHTML(seller) + buildingsHTML(space, game.asset(space.id), seller) + '<p>' + (seller ? escapeHTML(seller.name) + ' is selling this property with its buildings. The winner pays the seller. If nobody bids, the owner keeps it.' : 'This saved bank auction is in progress.') + '</p><div class="auction-price">' + money(auction.bid) + '</div><div class="auction-leader">' + (leader ? tokenHTML(leader.token) + ' ' + escapeHTML(leader.name) + ' holds the highest bid' : 'No bids yet · opening bid $10') + '</div><div class="auction-players">' + auction.order.map(id => '<span class="' + (auction.passed.includes(id) ? 'passed' : '') + '">' + tokenHTML(game.player(id).token) + ' ' + escapeHTML(game.player(id).name) + (id === auction.leader ? ' · leading' : '') + '</span>').join('') + '</div><div class="auction-turn"><h3 style="color:' + uiColor(bidder.color) + '">' + escapeHTML(bidder.name) + ' bids next</h3><label for="bid-increment">Bid increment · cash available ' + money(bidder.cash) + '</label><input id="bid-increment" type="number" min="10" step="1" max="' + Math.max(10, bidder.cash - auction.bid) + '" value="10"' + (bidder.id !== ownSeat() ? ' disabled' : '') + '><p class="note">' + (bidder.id === ownSeat() ? 'Your bid. Passing withdraws you from this auction.' : 'Waiting for ' + escapeHTML(bidder.name) + '. The auction updates live for everyone.') + '</p></div>', button('Pass', 'pass') + button('Place bid', 'bid', '', bidder.cash < auction.bid + 10, 'primary'), { mandatory: true, eyebrow: seller ? 'OWNER’S PROPERTY AUCTION' : 'BANK AUCTION' });
  }
  // Trading. Any property can change hands; its buildings and mortgage travel with it.
  // Any property can be traded; its buildings and mortgage go with it.
  const tradeBlock = () => '';
  function tradeableIds(player) { return game.owned(player).filter(space => !tradeBlock(space.id)).map(space => space.id); }
  function canProposeTrade() {
    const s = game.state, me = game.player(ownSeat());
    return !!me && !me.bankrupt && me.id === s.currentPlayer && ['ready', 'end'].includes(s.phase) && (s.tradesThisTurn || 0) < 3 && game.living.length > 1;
  }
  function tradeItemHTML(id, input) {
    const space = spaces()[id], blocked = input ? tradeBlock(id) : '';
    return '<label class="trade-item' + (blocked ? ' blocked' : '') + '" style="--group-color:' + GROUPS[space.group].color + '"' + (blocked ? ' title="' + escapeHTML(blocked) + '"' : '') + '>'
      + (input ? '<input type="checkbox" data-trade-side="' + input + '" value="' + id + '"' + (blocked ? ' disabled' : '') + '>' : '')
      + '<span>' + escapeHTML(space.name) + (game.asset(id).mortgaged ? ' <small>MORTGAGED</small>' : '') + (game.asset(id).buildings ? ' <small class="trade-houses">' + (game.asset(id).buildings === 5 ? 'TOWER' : game.asset(id).buildings + (game.asset(id).buildings === 1 ? ' HOUSE' : ' HOUSES')) + '</small>' : '') + (blocked ? '<em class="trade-block">' + escapeHTML(blocked) + '</em>' : '') + '</span><b>' + money(space.price) + '</b></label>';
  }
  function renderTradeComposer(targetId) {
    const me = game.player(ownSeat()), rivals = game.living.filter(player => player.id !== me.id);
    const target = rivals.find(player => player.id === targetId) || rivals.find(player => game.owned(player).length) || rivals[0];
    const side = (key, player) => {
      // List everything the player owns, with its houses.
      const owned = game.owned(player).map(space => space.id);
      const empty = !owned.length ? (key === 'give' ? 'You own no properties yet.' : escapeHTML(player.name) + ' owns no properties yet.') : '';
      const note = '';
      return '<section class="trade-side"><h3>' + (key === 'give' ? 'You give' : escapeHTML(player.name) + ' gives you') + '</h3><div class="trade-list">' + (owned.length ? owned.map(id => tradeItemHTML(id, key)).join('') : '<p class="trade-empty">' + empty + '</p>') + note + '</div><label for="trade-cash-' + key + '">Cash · up to ' + money(player.cash) + '</label><input id="trade-cash-' + key + '" type="number" min="0" step="10" max="' + player.cash + '" value="0"></section>';
    };
    showModal('trade-compose', 'Propose a trade.', '<label for="trade-target">Trade with</label><select id="trade-target">' + rivals.map(player => '<option value="' + player.id + '"' + (player.id === target.id ? ' selected' : '') + '>' + escapeHTML(player.name) + (player.type === 'bot' ? ' (bot)' : '') + ' · ' + game.owned(player).length + (game.owned(player).length === 1 ? ' property' : ' properties') + '</option>').join('') + '</select><div class="trade-grid">' + side('give', me) + side('get', target) + '</div><p class="note">Pick properties and cash on either side. Houses and mortgages move with the property to its new owner. ' + (target.type === 'bot' ? escapeHTML(target.name) + ' is a bot and accepts offers it thinks are fair.' : escapeHTML(target.name) + ' has 90 seconds to answer.') + ' You can make up to 3 offers per turn.</p>', button('Cancel', 'close') + button('Send offer ↗', 'trade', '', false, 'primary'), { wide: true, eyebrow: 'TRADE' });
  }
  function tradeFromForm() {
    const ids = key => [...dialog.querySelectorAll('[data-trade-side="' + key + '"]:checked')].map(element => Number(element.value));
    const cash = key => Math.max(0, Math.floor(Number($('trade-cash-' + key)?.value) || 0));
    return { to: Number($('trade-target')?.value), give: { cash: cash('give'), properties: ids('give') }, get: { cash: cash('get'), properties: ids('get') } };
  }
  function renderTrade() {
    const trade = game.state.trade, from = game.player(trade.from), to = game.player(trade.to), mine = to.id === ownSeat();
    const side = (title, part) => '<section class="trade-side"><h3>' + title + '</h3><div class="trade-list">' + (part.properties.map(id => tradeItemHTML(id)).join('') + (part.cash ? '<div class="trade-item cash"><span>Cash</span><b>' + money(part.cash) + '</b></div>' : '') || '<p class="trade-empty">Nothing</p>') + '</div></section>';
    showModal('trade', mine ? 'You have a trade offer.' : escapeHTML(from.name) + ' proposed a trade.', '<p>' + escapeHTML(from.name) + ' offers ' + (mine ? 'you' : escapeHTML(to.name)) + ' this deal.</p><div class="trade-grid">' + side(escapeHTML(from.name) + ' gives', trade.give) + side(escapeHTML(to.name) + ' gives', trade.get) + '</div>' + [...new Set([...trade.give.properties, ...trade.get.properties].map(id => spaces()[id].group))].map(group => colorCountHTML(game.groupSpaces(group)[0], to)).join('') + '<p class="note">' + (mine ? 'Accept to swap these assets now, or decline to keep everything as it is. Answer within 90 seconds or the offer is declined.' : 'Waiting for ' + escapeHTML(to.name) + ' to answer.') + '</p>', button('Decline', 'reject-trade') + button('Accept trade', 'accept-trade', '', false, 'primary'), { mandatory: true, eyebrow: 'TRADE OFFER' });
  }
  function renderDebt() {
    const debt = game.state.pending, player = game.managerPlayer, creditor = game.player(debt.creditor), potential = game.liquidatable(player);
    showModal('debt', 'A payment is due.', '<p><b>' + escapeHTML(player.name) + '</b> owes ' + (creditor ? escapeHTML(creditor.name) : 'the bank') + ' for ' + escapeHTML(debt.reason) + '.</p><div class="debt-total">' + money(debt.amount) + '</div><div class="detail-grid"><div>Cash available<b>' + money(player.cash) + '</b></div><div>Cash after all liquidation<b>' + money(potential) + '</b></div></div><p class="note">Sell buildings and mortgage properties to raise cash. The payment stays pending until it is settled. ' + (potential < debt.amount ? 'Even selling and mortgaging every asset cannot cover this debt; bankruptcy is available.' : 'Your assets can cover this debt. Liquidate enough assets before continuing.') + '</p>', button('Manage assets', 'manager') + (potential < debt.amount ? button('Declare bankruptcy', 'bankrupt', '', false, 'danger') : '') + button('Pay ' + money(debt.amount), 'settle', '', player.cash < debt.amount, 'primary'), { mandatory: true, eyebrow: 'FINANCIAL RECOVERY' });
  }
  function assetButtons(space, player) {
    const asset = game.asset(space.id), allowed = game.canManage(), buildReason = game.buildReason(player, space.id), mortgageReason = game.mortgageReason(player, space.id);
    return button('Auction property', 'auction', 'data-id="' + space.id + '" title="Auction a property you own. Unmortgage it first."', !allowed || !['ready', 'end'].includes(game.state.phase) || asset.mortgaged) + (space.type === 'property' ? button('Build ' + money(game.buildingCost(player, space)), 'build', 'data-id="' + space.id + '" title="' + escapeHTML(buildReason) + '"', !allowed || !!buildReason) + button('Sell level', 'sell', 'data-id="' + space.id + '" title="' + escapeHTML(game.sellReason(player, space.id)) + '"', !allowed || !!game.sellReason(player, space.id)) : '') + (asset.mortgaged ? button('Unmortgage ' + money(game.unmortgageCost(space.id)), 'unmortgage', 'data-id="' + space.id + '" title="110% of the ' + money(asset.mortgageReceived ?? space.mortgageValue) + ' received"', !allowed || game.state.phase === 'debt' || player.cash < game.unmortgageCost(space.id)) : button('Mortgage ' + money(game.mortgageProceeds(player, space)) + (game.mortgageProceeds(player, space) > space.mortgageValue ? ' (+25%)' : ''), 'mortgage', 'data-id="' + space.id + '" title="' + escapeHTML(mortgageReason) + '"', !allowed || !!mortgageReason));
  }
  // While raising cash for a debt: a bar that fills as cash approaches the amount owed, with Pay beside it.
  let lastDebtPercent = null;
  function debtMeterHTML(debt, player) {
    const creditor = game.player(debt.creditor), short = Math.max(0, debt.amount - player.cash), ready = short === 0;
    const percent = Math.min(100, Math.round(player.cash / debt.amount * 100));
    return '<div class="debt-meter' + (ready ? ' ready' : '') + '" role="group" aria-label="Payment progress"><div class="debt-meter-top"><span>You owe <b>' + money(debt.amount) + '</b> to ' + (creditor ? escapeHTML(creditor.name) : 'the bank') + ' · ' + escapeHTML(debt.reason) + '</span>'
      + button(ready ? 'Pay ' + money(debt.amount) + ' now' : 'Pay ' + money(debt.amount), 'settle', '', !ready, 'primary') + '</div>'
      + '<div class="debt-bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + debt.amount + '" aria-valuenow="' + Math.min(player.cash, debt.amount) + '" aria-label="Cash raised toward the payment"><i data-target="' + percent + '" style="width:' + (lastDebtPercent ?? percent) + '%"></i></div>'
      + '<p class="debt-meter-status">' + (ready ? 'Cash ' + money(player.cash) + ' covers the payment. You can pay now.' : 'Cash ' + money(player.cash) + ' of ' + money(debt.amount) + ' · <b>' + money(short) + ' more needed</b>. Sell buildings or mortgage properties below.') + '</p></div>';
  }
  function renderManager() {
    const player = game.player(ownSeat()) || game.managerPlayer, f = game.finances(player), owned = game.owned(player), debt = game.state.pending?.payer === player.id ? game.state.pending : null;
    const summary = '<div class="manager-summary">' + [['Cash', player.cash], ['Property value', f.propertyValue], ['Building value', f.buildingValue], ['Mortgage debt', f.mortgageDebt], ['Net worth', f.netWorth], ['Rent earned', player.stats.rentEarned], ['Rent paid', player.stats.rentPaid]].map(([label, value]) => '<span><b>' + money(value) + '</b>' + label + '</span>').join('') + '</div>';
    const groups = Object.keys(GROUPS).filter(key => owned.some(space => space.group === key));
    const assets = owned.length ? groups.map(group => '<section class="manager-group" style="--group-color:' + GROUPS[group].color + '"><h3>' + GROUPS[group].name.toUpperCase() + ' · ' + owned.filter(space => space.group === group).length + '/' + game.groupSpaces(group).length + '</h3>' + owned.filter(space => space.group === group).map(space => {
      const asset = game.asset(space.id), reason = game.buildReason(player, space.id);
      return '<div class="asset-card"><div><div class="asset-name">' + space.name + '</div>' + ownerHTML(player) + buildingsHTML(space, asset, player) + '<div class="asset-meta">Value ' + money(space.price) + ' · Rent ' + money(game.calculateRent(space.id)) + '<br>' + (asset.mortgaged ? 'MORTGAGED · rent inactive' : levelName(asset.buildings)) + '</div></div><div class="asset-actions">' + assetButtons(space, player) + '</div>' + (reason && space.type === 'property' ? '<p class="asset-reason">' + reason + '</p>' : '') + '</div>';
    }).join('') + '</section>').join('') : '<div class="empty-state"><h3>Your portfolio starts here.</h3><p>Buy a property or win an auction to add your first asset.</p></div>';
    showModal('manager', escapeHTML(player.name) + '\u2019s portfolio', (debt ? debtMeterHTML(debt, player) : (!game.canManage() ? '<p class="note">Inspect your assets now. Changes unlock after this action is resolved.</p>' : '')) + summary + assets, (canProposeTrade() ? button('Propose trade ⇄', 'trade-compose') : '') + (debt ? button('Back to payment', 'back-debt') + button('Pay ' + money(debt.amount), 'settle', '', player.cash < debt.amount, 'primary') : button('Done', 'close', '', false, 'primary')), { wide: true, mandatory: !!debt, eyebrow: 'ASSET MANAGEMENT' });
    const bar = dialog.querySelector('.debt-bar i');
    if (bar) { void bar.offsetWidth; bar.style.width = bar.dataset.target + '%'; lastDebtPercent = Number(bar.dataset.target); } else lastDebtPercent = null;
  }
  // Owners can build straight from the deed. The engine's own rules decide whether it is allowed;
  // when it is not, the reason is shown under the disabled button.
  function deedBuildHTML(space, owner) {
    if (space.type !== 'property' || !owner || owner.id !== ownSeat()) return '';
    const asset = game.asset(space.id), reason = game.buildReason(owner, space.id) || (!game.canManage() ? 'Finish the current action before building.' : '');
    const next = asset.buildings + 1 >= TOWER_LEVEL ? 'tower' : 'house';
    const label = asset.buildings >= TOWER_LEVEL ? 'Fully developed' : 'Build ' + next + ' · ' + money(game.buildingCost(owner, space));
    return '<div class="deed-build"><div class="deed-build-row"><span class="deed-build-title">Develop this property</span>' + button(label, 'build', 'data-id="' + space.id + '"', !!reason, 'primary') + '</div>'
      + (reason ? '<p class="note deed-build-reason">' + escapeHTML(reason) + '</p>' : '<p class="note deed-build-reason ok">You landed on your property. Build one level now; land here again to add the next.</p>') + '</div>';
  }
  function renderDetails(id) {
    const space = spaces()[id];
    if (!space.price) { showModal('details', space.name, '<p>' + specialDescription(space.type) + '</p>' + (space.type === 'prison' ? '<p class="note">To leave a penalty: pay the ' + money(game.prisonFine()) + ' fine before rolling, roll doubles, or pay it after three failed rolls. The third failed roll moves you after payment. You can raise cash before paying. The fine rises by $100 every 20 rounds.</p>' : ''), button('Back to board', 'close', '', false, 'primary')); return; }
    const asset = game.asset(id), owner = game.player(asset.owner), player = owner || game.active;
    showModal('details', space.name, '<div class="detail-banner" style="--group-color:' + GROUPS[space.group].color + '"><div><span class="role-badge" style="--role-color:' + GROUPS[space.group].color + '">' + GROUPS[space.group].name.toUpperCase() + '</span><p>' + ownerHTML(owner) + '</p></div><span>' + money(space.price) + '</span></div>' + colorCountHTML(space, game.player(ownSeat()) || game.active) + '<div class="detail-grid"><div>Current rent<b>' + money(game.calculateRent(id)) + '</b></div><div>Development<b>' + buildingsHTML(space, asset, owner) + '</b></div><div>Mortgage value<b>' + money(space.mortgageValue) + '</b></div><div>Unmortgage cost<b>' + money(game.unmortgageCost(id)) + '</b></div></div>' + (asset.mortgaged ? '<p class="note">This property is mortgaged. No rent is collected.</p>' : '') + deedBuildHTML(space, owner) + rentRows(space, player), (owner?.id === ownSeat() ? button('Manage property ↗', 'manager') : '') + button('Back to board', 'close', '', false, 'primary'), { eyebrow: 'PROPERTY DEED' });
  }
  function renderRules() {
    const blocks = [
      ['The objective', 'Be the last financially active player. Everyone starts with $1,500 on Launch. Play online with 2–4 players, each on their own device.'],
      ['A turn at the table', 'Roll two dice and move clockwise. Passing or landing on Launch gives $200. Resolve your space, manage assets, then end your turn. Doubles give you another roll, and the doubles stop is only a waypoint. Three consecutive doubles send you to Prison.'],
      ['One set of rules', 'Every player plays by the same classic rules. There are no roles: the same prices, rents, taxes and penalties apply to everyone.'],
      ['Buying & rent', 'Buy an unowned asset at the listed price or skip it. Skipping leaves it with the bank; there is no auction. After purchasing, the owner can choose to auction it during their turn. Rent automatically goes to the owner. Owning at least 2 properties of a color doubles their undeveloped rent. Owning every property of a color doubles all of its rents, including houses and the tower. Mortgaged assets collect no rent.'],
      ['Building permission', 'You can build on any property you own, even if it is your only one of that color. You build only on the property you land on, after the dice move you there (a doubles stop does not count), and only one level per landing. A property you just bought, traded for or inherited must be landed on again on a later turn first. Build evenly: every property you own in that color needs a building before any of them gets a second. Tap the property on the board to build from its card, or use the Property manager.'],
      ['Board sizes', 'The Host picks the board in the lobby. Classic is the square board with 40 spaces. Skyline is a pentagon with 50: its new side has the Stock Exchange corner (Dividend Day: $5 for every property anyone owns, times the game stage), Skyline Row ($420–$440), Royal Marina ($460–$480), Hyperloop Station, an Economic Event and a Luxury Tax ($100 × stage). Grand is a hexagon with 60: it adds a second side with the Grand Terminal corner (the Express Line takes you to a random station, paying Launch money if you pass it), Orbital Quarter ($500–$520), Crown Heights ($540–$560), Starport, two card spaces and another Luxury Tax. With more stations, station rent climbs with each one owned: $50, $150, $250, $400.'],
      ['Trading', 'On your turn, before rolling or after resolving your move, propose a trade to any player: properties and cash on either side. They accept or decline, and an unanswered offer is declined after 90 seconds. Any property can be traded; its houses and mortgage move with it to the new owner, who must land on it before building there. Up to 3 offers per turn. Bots trade carefully. A bot never breaks up a color set it owns, never sells the last property of a set to anyone (unless the same trade finishes a set for the bot), and will not sell part of a color it holds 2 of. Otherwise it values a property by its price, buildings and what it means to both players, and asks a premium of at least 25% that rises against the leading player, when it has plenty of cash, and with every recent offer from the same player. When it declines, it says why and may name a property of yours it would trade for. It keeps a cash reserve for rent when paying cash. A bot offers to buy only the last property it needs to finish a color, at most once every 8 rounds, and never repeats a declined offer for 20 rounds.'],
      ['Leaving a game', 'Exit game removes you from the table for good. Your properties and buildings return to the bank and play continues. Each player has 90 seconds to act before their turn passes.'],
      ['Buildings', 'Develop land from one to four houses, then a commercial tower (level 5). Each level costs the district price shown on every deed. Build and sell evenly: a property cannot be more than one level ahead of your other properties in its color. Sell one level for half its cost, rounded down. Utilities and transit stations cannot be developed.'],
      ['Mortgages', 'Receive half the purchase price when mortgaging. Sell every building in that color first. Fire Sale: if you have under $200 in cash when you mortgage, you receive 25% more. Unmortgaging always costs 110% of the amount you actually received, rounded up. No unsecured loans or player loans.'],
      ['Open auctions', 'Only the owner can start an auction, after buying the property and during their own turn. Unmortgage it first. Other active players can bid; the seller cannot bid. Raise by at least $10 within your cash balance. The winner pays the seller and receives the property with its buildings. If nobody bids, the owner keeps it.'],
      ['Prison', 'Landing on Prison locks you up. So do some event cards and three doubles in a row. To get out, roll doubles, pay the fine before rolling, or pay it after three failed rolls. The fine is $50, rising by $100 every 20 rounds (round 21: $150, round 41: $250), then move the last dice total. You keep collecting rent while inside. A Get out of Prison free card, kept in your hand, is used automatically whenever you would be sent to Prison.'],
      ['Taxes & city services', 'Business Tax is the lesser of $200 and 10% of your cash. Wealth Tax is $15 per property and $25 per building level, so you owe nothing if you own nothing. In later game stages these grow. City Bank pays $50 interest, rising by $50 every 7 rounds (round 8: $100, round 15: $150). Utilities charge the dice total ×6, or ×15 with both. Transit rent is $50 with one station and $150 with both. Station and utility rents also grow with the game stage.'],
      ['Power-ups', 'Timed buffs show on your player card with their remaining uses (for example Tailwind ×2). Launch Boost: the next 2 times you pass or land on Launch you get $150 on top of the normal $200. Tailwind: your next 2 rolls use three dice and keep the best two; doubles are judged on the kept two. Rent Shield: no rent on your next 2 landings on other players\' properties, stations and utilities included. Rent Doubler: your next 2 rent collections are doubled, up to $400 each, and a rent already above $400 is never reduced. Rent Reversal: on your next 3 landings on other players\' properties, the owner pays you instead. Landings that owe no rent (mortgaged or your own property) do not use a charge. When several apply: a City Event multiplier is applied to the rent first, then Rent Doubler and its cap, then Rent Reversal comes before Rent Shield.'],
      ['Free Market jackpot', 'Half of every tax, fine and card payment goes into the Free Market pot. It starts at $100. Land on Free Market to win the whole pot; it then resets to $100.'],
      ['Wheel of Fortune', 'Landing on the Wheel of Fortune corner spins it. Slices: Jackpot +$400 and Taxman −$250 (rare); Good spin +$200, Small win +$100 and Bad spin −$150 (common); Free house, Power-up and Free spin (uncommon). Free house: you pick a property for one free building level (the even-building rule applies, landing there is not needed; with nothing to build on you get $100 instead). Power-up: a random timed buff. Free spin: spin again, at most 3 in a row. The server spins, weighted so an average spin is worth about zero, and the cash amounts grow with the game stage.'],
      ['Event cards', 'Market and Economic decks hold 52 cards each, drawn by rarity: common 70%, uncommon 25%, rare 5%. A card never repeats within 12 draws. Some pay a fixed amount, some roll a die, some gamble on one, some help the poorest player or tax the richest into the jackpot, and rare cards give you a Get out of Prison free card, Rent Shield, Rent Doubler, Rent Reversal or Roll Again (roll again straight away).'],
      ['City Events & game stages', 'Every 5 rounds (a round is every player taking a turn) a City Event strikes, chosen at random but never the same one twice in a row, and announced one round ahead in the banner above the board: Property Boom (every rent +50% for 2 rounds), Recession (building costs −30% and every rent −25% for 2 rounds) or Tax Audit (the richest player pays the poorest $100, rising by $100 every 10 rounds up to $500; ties go to the lower seat). Card, wheel and tax amounts, and station and utility rents, are multiplied by the game stage: ×2 after round 15, ×3 after round 30, ×4 after round 80 and ×5 after round 130.'],
      ['Debt & bankruptcy', 'An unaffordable payment pauses play. The debtor can sell levels and mortgage assets, including when an event hits them outside their turn. If full liquidation cannot cover the debt, declare bankruptcy. A player creditor receives remaining cash and assets, including mortgages and buildings. Bank debts return assets to the bank, clearing development and mortgages.'],
      ['Wealth, score & saving', 'Net worth is cash + original property prices + buildings at their construction cost. Mortgage debt is shown separately. Score adds bonus income to net worth. Every completed action is saved online; your room link resumes pending cards, auctions, and debts. Default games have no turn limit.']
    ];
    showModal('rules', 'One market. One winner.', '<p>Buy properties, build businesses, survive economic events, and outlast your rivals.</p><div class="rules-grid">' + blocks.map(([title, text]) => '<section class="rule-block"><h3>' + title + '</h3><p>' + text + '</p></section>').join('') + '</div>', button('Ready to play', 'close', '', false, 'primary'), { wide: true, eyebrow: 'THE MARKET WARS RULEBOOK' });
  }
  function renderSettings() {
    const current = game?.state.settings || settings;
    const toggle = (id, label, note) => '<div class="settings-row"><label for="setting-' + id + '">' + label + '<small>' + note + '</small></label><input type="checkbox" id="setting-' + id + '" data-setting="' + id + '"' + (current[id] ? ' checked' : '') + '></div>';
    const speed = (id, label, note) => '<div class="settings-row"><label for="setting-' + id + '">' + label + '<small>' + note + '</small></label><select id="setting-' + id + '" data-setting="' + id + '">' + [1, 1.5, 2].map(value => '<option value="' + value + '"' + (current[id] === value ? ' selected' : '') + '>' + value + '× speed</option>').join('') + '</select></div>';
    showModal('settings', 'Make it your game.', toggle('sound', 'Sound effects', 'Dice, property visits, purchases, and buildings') + speed('animationSpeed', 'Animation speed', 'Dice and visual feedback') + speed('movementSpeed', 'Movement speed', 'Token movement around the board') + toggle('hints', 'Show hints', 'Strategy reminders and board guidance') + '<p class="note">Reduced-motion preferences are respected automatically. Settings apply immediately.</p>', button('Done', 'close', '', false, 'primary'), { eyebrow: 'TABLE SETTINGS' });
  }
  listen(dialog, 'change', event => {
    if (event.target.id === 'trade-target') { renderTradeComposer(Number(event.target.value)); applyPermissions(); return; }
    const key = event.target.dataset.setting;
    if (!key) return;
    const value = event.target.type === 'checkbox' ? event.target.checked : Number(event.target.value);
    settings[key] = value; if (game) game.state.settings[key] = value;
    if (key === 'sound' && !value) {
      visitorAudio.pause(); visitorAudio.currentTime = 0;
      diceAudio.pause(); diceAudio.currentTime = 0;
    }
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { notify('Settings will apply for this session. Browser storage is unavailable.'); }
    if (game) { renderCenter(); if (game.state.settings.autoSave && !game.busy) saveGame(false); }
  });
  function renderVictory() {
    const winner = game.player(game.state.winner), f = game.finances(winner), stats = winner.stats;
    $('victory-screen').innerHTML = '<div class="victory-medal" aria-hidden="true">' + tokenHTML(winner.token) + '</div><div class="eyebrow">THE LAST PLAYER STANDING</div><h1>' + escapeHTML(winner.name) + ' wins!</h1><span class="role-badge" style="--role-color:' + uiColor(winner.color) + '">' + 'NORTHSTAR CITY CHAMPION</span><div class="victory-metrics">' + [['Cash', money(winner.cash)], ['Properties', f.properties], ['Buildings', f.buildings], ['Net worth', money(f.netWorth)], ['Final score', f.score.toLocaleString('en-US')]].map(([label, value]) => '<div><b>' + value + '</b>' + label + '</div>').join('') + '</div><p>Your strategy outlasted the market in ' + game.state.turn + ' turns.</p><div class="victory-stats">' + [['Properties purchased', stats.propertiesPurchased], ['Rent earned', money(stats.rentEarned)], ['Rent paid', money(stats.rentPaid)], ['Buildings built', stats.buildingsBuilt], ['Taxes paid', money(stats.taxesPaid)], ['Launch bonuses', stats.startBonuses], ['Auctions won', stats.auctionWins], ['Cards drawn', stats.cardsDrawn], ['Turns played', stats.turnsPlayed]].map(([label, value]) => '<p>' + label + ' <b>' + value + '</b></p>').join('') + '</div><div class="victory-actions">' + button('Play again ↗', 'replay', '', false, 'primary large') + button('New game', 'new') + button('Main menu', 'menu') + '</div>';
  }
  async function handleAction(action, element) {
    if (action === 'build-ignore') { closeModal(); return; }
    if (action === 'wheel-continue') { wheelBusy = false; clearTimeout(wheelTimer); closeModal(); if (game) { syncModal(true); applyPermissions(); } return; }
    if (action === 'close') { if (modalKind === 'manager' && game?.state.pending?.payer === ownSeat()) { modalKey = ''; renderDebt(); } else closeModal(); return; }
    if (['new', 'replay', 'join', 'load', 'menu'].includes(action)) { closeModal(); online.navigate(action); return; }
    if (action === 'theme') { setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); return; }
    if (action === 'exit-game') {
      if (isMandatoryModal()) return;
      const out = !game || game.state.phase === 'victory' || game.state.players[ownSeat()]?.bankrupt;
      showModal('exit', 'Exit this game?', out ? '<p>You will return to the main menu.</p>' : '<p>You will leave the table for good. Your properties and buildings go back to the bank, and the game continues without you.</p>', button('Stay in game', 'close') + button('Exit game', 'confirm-exit', '', false, 'danger'), { eyebrow: 'LEAVE THE TABLE' });
      return;
    }
    if (action === 'confirm-exit') { closeModal(); void online.exitGame(); return; }
    if (action === 'rules') { if (isMandatoryModal()) return; renderRules(); return; }
    if (action === 'settings') { if (isMandatoryModal()) return; renderSettings(); return; }
    if (!game) return;
    const id = Number(element?.dataset.id);
    const mutations = ['roll', 'end', 'buy', 'skip', 'auction', 'bid', 'pass', 'apply-event', 'release', 'build', 'sell', 'mortgage', 'unmortgage', 'settle', 'bankrupt', 'trade', 'accept-trade', 'reject-trade', 'spin', 'free-build'];
    if (mutations.includes(action)) {
      if (!canAct(action)) { notify('Wait for the acting player or reconnect to the room.'); return; }
      const trade = action === 'trade' ? tradeFromForm() : undefined, tradeError = trade && game.tradeReason(ownSeat(), trade);
      if (tradeError) { notify(tradeError); return; }
      sending = true; applyPermissions();
      try { await online.command({ action, id, increment: action === 'bid' ? Number($('bid-increment').value) : undefined, trade }); }
      finally { sending = false; applyPermissions(); }
      return;
    }
    switch (action) {
      case 'manager': renderManager(); applyPermissions(); break;
      case 'trade-compose': if (canProposeTrade()) { renderTradeComposer(); applyPermissions(); } break;
      case 'back-debt': modalKey = ''; renderDebt(); break;
      case 'resume': syncModal(true); applyPermissions(); break;
      case 'save': saveGame(); break;
      case 'board-fit': case 'board-zoom': game.state.settings.boardZoom = action === 'board-zoom'; updateBoardView(); autoSave(); break;
      case 'locate-token': {
        const position = game.player(ownSeat())?.position ?? game.active.position;
        selectedSpace = position; updateBoard(); renderSidebar(); applyPermissions();
        const tile = $('game-board').querySelector('[data-id="' + position + '"]');
        tile.focus({preventScroll:true}); tile.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
        break;
      }
      case 'locate-active': readableBoard?.locate(game.active.position); break;
      case 'inspect': selectedSpace = id; updateBoard(); renderSidebar(); renderDetails(id); break;
      case 'details': selectedSpace = id; renderDetails(id); break;
    }
  }
  listen(document, 'click', async event => {
    const element = event.target.closest('[data-action]');
    if (!element || element.disabled) return;
    try { await handleAction(element.dataset.action, element); } catch (error) { notify(error.message || 'That action is unavailable.'); if (game) syncModal(true); }
  });
  listen(document, 'keydown', event => {
    if (screen !== 'game' || dialog.open || event.target.matches('input,select,textarea,button,canvas')) return;
    if (event.code === 'Space' && game.canRoll()) { event.preventDefault(); void handleAction('roll').catch(error => notify(error.message)); }
    if (event.key === 'e' && game.state.phase === 'end' && !game.state.extraRoll) { event.preventDefault(); void handleAction('end').catch(error => notify(error.message)); }
  });

  // Preview board (home screen) still uses the lightweight CSS grid
  // The landing preview uses the same framed tabletop board as the game.
  { const preview = $('preview-board'), frame = document.createElement('div'); frame.className = 'classic-board-view preview-board-view'; preview.before(frame); frame.append(preview); }
  buildBoard($('preview-board'), true);
  { const fit = () => fitTileNames($('preview-board')); requestAnimationFrame(fit); document.fonts?.ready.then(fit); listen(window, 'resize', fit); }
  showScreen('home');

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    if (game && screen === 'game') onGameChange();
    try { localStorage.setItem('market-wars-theme', theme); } catch { /* The choice still applies for this visit. */ }
    document.querySelectorAll('[data-action=theme]').forEach(el => { el.textContent = theme === 'dark' ? '☀' : '☾'; el.setAttribute('aria-pressed', String(theme === 'dark')); el.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'); });
  }
  try { setTheme(localStorage.getItem('market-wars-theme') === 'dark' ? 'dark' : 'light'); } catch { setTheme('light'); }
  function ownSeat() { return metadata?.members.findIndex(member => member.user_id === online.userId()) ?? -1; }
  function actingSeat() { return game?.state.pending?.payer ?? game?.state.auction?.bidder ?? game?.state.trade?.to ?? game?.state.currentPlayer; }
  function canAct(action) {
    const actor = ['bid', 'pass'].includes(action) ? game?.state.auction?.bidder : ['accept-trade', 'reject-trade'].includes(action) ? game?.state.trade?.to : ['build', 'sell', 'mortgage', 'unmortgage', 'settle', 'bankrupt'].includes(action) ? game?.state.pending?.payer ?? game?.state.currentPlayer : game?.state.currentPlayer;
    return !!game && !game.busy && !sending && !animating && online.connected() && ownSeat() === actor && !game.state.players[ownSeat()]?.bankrupt;
  }
  function applyPermissions() {
    document.querySelectorAll('[data-action]').forEach(element => {
      const action = element.dataset.action;
      if (['roll', 'end', 'buy', 'skip', 'auction', 'bid', 'pass', 'apply-event', 'release', 'build', 'sell', 'mortgage', 'unmortgage', 'settle', 'bankrupt', 'trade', 'accept-trade', 'reject-trade', 'spin', 'free-build'].includes(action)) {
        const ruleDisabled = element.dataset.ruleDisabled;
        if (ruleDisabled !== undefined) element.disabled = ruleDisabled === 'true' || !canAct(action);
        else element.disabled ||= !canAct(action);
      }
    });
    if (game && $('save-status')) autoSave();
  }
  async function renderRoom(room) {
    if (metadata?.code !== room.code) { revision = -1; game = null; acceptedState = null; animationGeneration++; }
    metadata = room;
    if (!room.state) { animationGeneration++; closeModal(); showScreen('lobby'); return; }
    if (room.revision <= revision) { applyPermissions(); return; }
    const first = revision < 0, consecutive = room.revision === revision + 1, previous = acceptedState;
    acceptedState = structuredClone(room.state); animating = false;
    revision = room.revision;
    const generation = ++animationGeneration;
    game = new Game(room.members);
    game.state = structuredClone(room.state);
    Object.assign(game.state.settings, settings);
    if (first) {
      if ($('ownership-notice')) $('ownership-notice').hidden = true;
      lastLogId = 0; lastPhase = null; lastWheelId = null; wheelBusy = false; lastDieId = null; dieBusy = false; cashSeen = {}; toastHoldUntil = 0; $('fx-stage')?.remove(); $('game-log').innerHTML = '';
      // Restore the original square board for every new room.
      buildBoard($('game-board'));
      const fit = () => { if ($('game-board')) { fitTileNames($('game-board')); updateTokens(); } };
      requestAnimationFrame(fit); document.fonts?.ready.then(fit);
    }
    // A board of a different size (a new game on the pentagon or hexagon board) is drawn afresh.
    if (!first && $('game-board') && $('game-board').querySelectorAll('.board-tile').length !== game.board.length) {
      buildBoard($('game-board')); requestAnimationFrame(() => { if ($('game-board')) { fitTileNames($('game-board')); updateTokens(); } });
    }
    if (!['manager', 'details'].includes(modalKind) && room.state.phase !== previous?.phase) closeModal();
    modalKey = ''; showScreen('game');
    const transition = room.transition;
    if (!first && consecutive && transition && previous && (transition.action === 'roll' || transition.path?.length)) {
      const final = structuredClone(game.state), player = transition.player;
      animating = true; closeModal();
      game.state = structuredClone(previous); Object.assign(game.state.settings, settings);
      game.state.dice = transition.dice; game.state.droppedDie = final.droppedDie ?? null;
      game.state.players[player].position = previous.players[player].position;
      game.state.phase = transition.action === 'roll' ? 'rolling' : 'moving';
      onGameChange();
      if (transition.action === 'roll') { playSound('dice'); await pause(950 / settings.animationSpeed); }
      for (const position of transition.path || []) {
        if (generation !== animationGeneration) return;
        game.state.phase = 'moving'; game.state.players[player].position = position;
        onGameChange(); await pause(150 / settings.movementSpeed);
      }
      if (generation !== animationGeneration) return;
      game.state = final;
      selectedSpace = game.active.position;
    }
    animating = false;
    onGameChange();
    if (!first) { showOwnershipChanges(previous); applyPermissions(); }
    if (!first && consecutive) for (const sound of transition?.sounds || []) if (sound !== 'dice') playSound(sound);
  }
  function pause(ms) { return new Promise(resolve => setTimeout(resolve, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms)); }
  return {
    renderRoom,
    setConnection() { if (game) { renderCenter(); renderSidebar(); applyPermissions(); } },
    showHome() { animationGeneration++; animating = false; metadata = null; game = null; revision = -1; closeModal(); showScreen('home'); },
    showLobby() { closeModal(); showScreen('lobby'); },
    destroy() {
      animationGeneration++;
      controller.abort();
      clearTimeout(toastTimer);
      clearTimeout(ownershipTimer);
      dialog.close();
      visitorAudio.pause();
      diceAudio.pause();
      void audioContext?.close();
      // Clean up Three.js scene
      boardResize.disconnect();
      boardReady = false;
      const board = $('game-board');
      board.classList.add('board-3d-hidden'); board.setAttribute('aria-hidden', 'true'); board.inert = true;
      $('classic-board-view')?.remove();
      document.querySelector('.game-layout').classList.remove('classic-layout', 'readable-layout');
      document.querySelector('.readable-view-switch')?.remove();
    }
  };
}
