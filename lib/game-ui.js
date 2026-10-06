import MarketWars from './game-engine.cjs';
import { createBoard3D } from './board-3d';

export function initializeUI(online) {
  const { Game, BOARD, GROUPS, TOKENS, COLORS, DEFAULT_SETTINGS, SAVE_KEY, SETTINGS_KEY, money, roleName, levelName, validatePlayers } = MarketWars;
  const $ = id => document.getElementById(id);
  const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const button = (label, action, extra = '', disabled = false, type = 'secondary') => '<button class="' + type + '" data-action="' + action + '" data-rule-disabled="' + disabled + '" ' + extra + (disabled ? ' disabled' : '') + '>' + label + '</button>';
  const getStorage = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const settings = (() => { try { return { ...DEFAULT_SETTINGS, ...JSON.parse(getStorage(SETTINGS_KEY) || '{}') }; } catch { return { ...DEFAULT_SETTINGS }; } })();
  let game = null, screen = 'home', selectedSpace = 1, modalKind = null, modalKey = '', toastTimer, audioContext, lastPhase, lastLogId = 0;
  const visitorAudio = new Audio('/faah_sound.mpeg');
  visitorAudio.preload = 'auto';
  visitorAudio.volume = .65;
  const diceAudio = new Audio('/Dice_sound.mpeg');
  diceAudio.preload = 'auto';
  diceAudio.volume = .55;
  const controller = new AbortController();
  const listen = (target, type, callback) => target.addEventListener(type, callback, { signal: controller.signal });
  let metadata = null, sending = false, revision = -1, animationGeneration = 0;
  const dialog = $('modal');
  listen(dialog, 'cancel', event => {
    if (isMandatoryModal()) event.preventDefault(); else closeModal();
  });
  listen(dialog, 'click', event => { if (event.target === dialog && !isMandatoryModal()) closeModal(); });

  // ── 3D board controller ────────────────────────────────────────────────────
  /** @type {import('./board-3d').Board3DController | null} */
  let board3d = null;

  function init3DBoard(containerId) {
    const container = $(containerId);
    if (!container || board3d) return;
    board3d = createBoard3D(
      container,
      BOARD,
      GROUPS,
      spaceId => {
        // Mirror the same logic as the CSS-grid tile click
        selectedSpace = spaceId;
        if (game) { board3d?.updateTiles(buildAssetMap(), selectedSpace); renderSidebar(); renderDetails(spaceId); }
      },
    );
    board3d.init();
    // Observe container size changes
    const ro = new ResizeObserver(() => board3d?.resize());
    ro.observe(container);
  }

  /** Build the asset map the 3D board expects. */
  function buildAssetMap() {
    if (!game) return {};
    const map = {};
    BOARD.forEach(space => {
      if (!space.price) return;
      const asset = game.asset(space.id);
      const owner = game.player(asset.owner);
      map[space.id] = {
        owner: asset.owner,
        buildings: asset.buildings,
        mortgaged: asset.mortgaged,
        ownerColor: owner ? owner.color : null,
      };
    });
    return map;
  }

  function notify(message) {
    $('toast').textContent = message; $('toast').classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3600);
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
    screen = name;
    ['home', 'game', 'victory'].forEach(id => $(id + '-screen').hidden = id !== name);
    $('header-meta').innerHTML = '<span class="live-dot"></span>' + (name === 'game' ? 'ONLINE MULTIPLAYER · A SHARED ECONOMY' : 'THE ECONOMY IS YOURS TO CHANGE');
    $('continue-button').hidden = !getStorage('market-wars-room');
    window.scrollTo({ top: 0, behavior: 'instant' });

    // Initialise the 3D board when the game screen first becomes visible
    if (name === 'game') {
      requestAnimationFrame(() => {
        init3DBoard('board-3d-container');
        board3d?.resize();
      });
    }
  }
  function showModal(kind, title, body, actions = '', { wide = false, eyebrow = 'MARKET WARS', mandatory = false } = {}) {
    modalKind = kind;
    const focus = document.activeElement;
    const focusAction = focus?.dataset?.action, focusId = focus?.dataset?.id;
    dialog.classList.toggle('wide', wide);
    $('modal-content').innerHTML = '<div class="modal-inner"><div class="modal-header"><div><div class="eyebrow">' + eyebrow + '</div><h2 id="modal-title">' + title + '</h2></div>' + (!mandatory ? '<button class="modal-close" data-action="close" aria-label="Close dialog">×</button>' : '') + '</div><div class="modal-body">' + body + '</div>' + (actions ? '<div class="modal-actions">' + actions + '</div>' : '') + '</div>';
    if (!dialog.open) dialog.showModal();
    else if (focusAction) {
      const match = [...dialog.querySelectorAll('button')].find(el => el.dataset.action === focusAction && el.dataset.id === focusId && !el.disabled);
      match?.focus();
    }
  }
  function closeModal() { dialog.close(); modalKind = null; modalKey = ''; }
  function isMandatoryModal() { return ['offer', 'auction', 'event', 'debt'].includes(modalKind) || (modalKind === 'manager' && game?.state.pending?.payer === ownSeat()); }
  function roleDescription(role) { return role === 'monopolist' ? 'Control complete districts to build. Higher developed rents reward a patient strategy.' : 'Build on individual properties for 25% less. Lower taxes and Free Market bonuses keep you agile.'; }

  // boardCoordinates kept for any legacy callers, though 3D uses its own mapping
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
  // The preview board on the home screen still uses the CSS grid (lightweight,
  // no WebGL needed there). The in-game board is the Three.js scene.
  function buildBoard(container, preview = false) {
    container.innerHTML = BOARD.map(space => {
      const { row, col } = boardCoordinates(space.id), group = GROUPS[space.group];
      const contents = '<span class="tile-strip"></span><span class="tile-face">' + (!space.price ? '<span class="tile-symbol" aria-hidden="true">' + space.symbol + '</span>' : '') + '<span class="tile-name">' + space.name + '</span>' + (space.price ? '<span class="tile-price">' + money(space.price) + '</span><span class="tile-owner"></span><span class="tile-buildings"></span>' : '<span class="tile-kind">' + space.caption + '</span>') + '</span>' + (space.price ? '<span class="owner-mark"></span>' : '');
      const edge = space.id % 10 === 0 ? '' : row === 10 ? ' edge-south' : col === 0 ? ' edge-west' : row === 0 ? ' edge-north' : ' edge-east';
      const attributes = ' class="board-tile' + edge + (!space.price ? ' special' : '') + (space.id % 10 === 0 ? ' corner' : '') + '" style="grid-row:' + (row + 1) + ';grid-column:' + (col + 1) + ';--group-color:' + (group?.color || '#82978f') + '"';
      return preview ? '<div' + attributes + '>' + contents + '</div>' : '<button' + attributes + ' data-action="inspect" data-id="' + space.id + '" aria-label="' + space.name + '">' + contents + '</button>';
    }).join('') + '<div class="board-center" id="' + (preview ? 'preview-center' : 'board-center') + '"></div>' + (!preview ? '<div id="token-layer" class="token-layer" aria-hidden="true"></div>' : '');
    if (preview) $('preview-center').innerHTML = skylineHTML() + deckSlipsHTML() + '<div class="board-wordmark">MARKET<span>WARS</span></div><div class="eyebrow">MONOPOLISTS VS COMPETITORS</div><p class="preview-center-copy">A CITY OF OPPORTUNITY.<br>A GAME OF CONSEQUENCES.</p>';
  }

  // ── 3D board update (replaces updateBoard + updateTokens for live game) ────
  function updateBoard() {
    if (!game) return;
    const s = game.state;

    // 3D tile state
    if (board3d) {
      board3d.updateTiles(buildAssetMap(), selectedSpace);
    }

    // Keep the hidden CSS-grid tile data in sync for a11y / fallback
    BOARD.forEach(space => {
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
  }

  function updateTokens() {
    if (!game || !board3d) return;
    const tokens = game.state.players.map(player => ({
      id: player.id,
      position: player.position,
      color: player.color,
      token: player.token,
      bankrupt: player.bankrupt,
      active: player.id === game.active.id,
    }));
    board3d.updateTokens(tokens, game.state.settings.movementSpeed ?? 1);
  }

  // ── dice HTML for panels (sidebar / center) ────────────────────────────────
  // The 3D scene owns its own dice mesh; the HTML dice in the center panel
  // are kept as a lightweight visual echo and remain unchanged.
  function diceHTML(value) {
    const spots = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] }[value];
    return '<span class="die" role="img" aria-label="Die: ' + value + '">' + spots.map(spot => '<i class="pip" style="grid-row:' + Math.ceil(spot / 3) + ';grid-column:' + ((spot - 1) % 3 + 1) + '"></i>').join('') + '</span>';
  }

  function phaseDescription() {
    const s = game.state, player = game.active;
    if (s.phase === 'ready') return player.penalty ? (player.penalty.kind === 'prison' ? 'Prison' : 'Price War') + ': roll doubles or pay $50 to leave.' : 'The city is waiting. Make your move.';
    if (s.phase === 'rolling') return 'The dice are in motion…';
    if (s.phase === 'moving') return 'Moving through Northstar City…';
    if (s.phase === 'offer') return 'Buy this property or open an auction.';
    if (s.phase === 'auction') return 'An auction is in progress.';
    if (s.phase === 'event') return 'Resolve your event card.';
    if (s.phase === 'debt') return game.managerPlayer.name + ' needs to settle a payment.';
    return s.extraRoll ? 'Doubles! Roll again, manage assets, or end your turn.' : 'Manage your assets, then pass the turn.';
  }

  function renderCenter() {
    const s = game.state, player = game.active;
    $('board-center').innerHTML = skylineHTML() + '<div class="board-wordmark">MARKET<span>WARS</span></div><div class="eyebrow">MONOPOLISTS VS COMPETITORS</div><div class="center-role" style="color:' + player.color + '">TURN ' + String(s.turn).padStart(2, '0') + ' · ' + roleName(player).toUpperCase() + '</div><div class="center-player">' + escapeHTML(player.name) + '<span style="color:var(--muted)">&#39;s turn</span></div><p class="center-status">' + phaseDescription() + '</p><div class="dice' + (s.phase === 'rolling' ? ' rolling' : '') + '">' + s.dice.map(diceHTML).join('') + '</div><div class="dice-total">' + (s.hasRolled ? s.dice[0] + s.dice[1] + ' TOTAL' + (s.dice[0] === s.dice[1] ? ' · DOUBLES' : '') : 'TWO DICE. YOUR NEXT OPPORTUNITY.') + '</div><div class="center-controls">' + button(s.phase === 'end' && s.extraRoll ? 'Roll again ↗' : 'Roll dice ↗', 'roll', '', !game.canRoll(), 'primary') + button('End turn →', 'end', '', s.phase !== 'end') + '</div>' + (player.penalty && s.phase === 'ready' ? '<div class="center-controls">' + button('Pay $50 to leave', 'release') + '</div>' : '');
    document.querySelectorAll('.mobile-controls [data-action=roll]').forEach(el => { el.disabled = !game.canRoll(); el.textContent = s.extraRoll ? 'Roll again' : 'Roll dice'; });
    document.querySelectorAll('.mobile-controls [data-action=end]').forEach(el => el.disabled = s.phase !== 'end');
    document.querySelectorAll('.mobile-controls [data-action=release]').forEach(el => el.hidden = !(player.penalty && s.phase === 'ready'));

    // Drive the 3D dice — rolling animation or settled display
    if (board3d) {
      if (s.phase === 'rolling') {
        board3d.rollDice([s.dice[0], s.dice[1]], 'rolling');
      } else if (s.hasRolled) {
        board3d.setDice([s.dice[0], s.dice[1]]);
      }
    }

    updateBoardView();
  }

  function updateBoardView() {
    const zoomed = !!game.state.settings.boardZoom;
    $('game-board').closest('.board-scroll').classList.toggle('zoomed', zoomed);
    document.querySelectorAll('[data-action=board-fit]').forEach(el => el.setAttribute('aria-pressed', String(!zoomed)));
    document.querySelectorAll('[data-action=board-zoom]').forEach(el => el.setAttribute('aria-pressed', String(zoomed)));
    if (!zoomed) $('game-board').closest('.board-scroll').scrollLeft = 0;
  }
  function renderPlayers() {
    const s = game.state;
    $('player-cards').innerHTML = s.players.map(player => {
      const f = game.finances(player), penalty = player.penalty;
      return '<article class="player-card' + (player.id === game.active.id ? ' active' : '') + (player.bankrupt ? ' bankrupt' : '') + '" style="--player-color:' + player.color + ';--role-color:' + (player.role === 'monopolist' ? 'var(--gold)' : 'var(--cyan)') + '"><div class="player-card-top"><span class="avatar" aria-hidden="true">' + TOKENS[player.token] + '</span><div><div class="player-name">' + escapeHTML(player.name) + '</div><span class="role-badge">' + roleName(player).toUpperCase() + '</span></div></div><div class="cash-row"><span class="cash-amount" id="cash-' + player.id + '">' + money(player.cash) + '</span>' + (player.id === game.active.id && !player.bankrupt ? '<span class="turn-badge">' + (metadata?.members[player.id]?.user_id === online.userId() ? 'YOUR TURN' : 'ACTIVE TURN') + '</span>' : '') + '</div><div class="player-metrics"><span><b>' + f.properties + '</b>PROPERTIES</span><span><b>' + f.buildings + '</b>BUILDINGS</span><span><b>' + game.owned(player).filter(space => game.asset(space.id).mortgaged).length + '</b>MORTGAGES</span></div><div class="player-position"><span>Net worth</span><span>' + money(f.netWorth) + '</span></div><div class="player-position"><span>Score ' + f.score.toLocaleString('en-US') + '</span></div><div class="player-position"><span>↳ ' + (player.bankrupt ? 'Bankrupt' : BOARD[player.position].name) + '</span></div>' + (penalty ? '<span class="penalty-badge">' + (penalty.kind === 'prison' ? 'Prison · no rent' : 'Price War · rent active') + ' · ' + penalty.attempts + '/3</span>' : '') + '</article>';
    }).join('');
    $('active-count').textContent = game.living.length + ' ACTIVE';
    $('role-tip').innerHTML = s.settings.hints ? '<b>' + (game.active.role === 'monopolist' ? 'THINK IN DISTRICTS.' : 'GROW ON YOUR TERMS.') + '</b>' + roleDescription(game.active.role) : '';
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
    $('turn-action-card').innerHTML = '<span class="role-badge" style="--role-color:' + player.color + '">' + roleName(player).toUpperCase() + '</span><h2>' + escapeHTML(player.name) + ', ' + (s.phase === 'ready' ? 'you&#39;re up.' : 'your move.') + '</h2><p>' + phaseDescription() + '</p>' + (['offer', 'event', 'auction', 'debt'].includes(s.phase) ? button('Resume action ↗', 'resume', 'style="width:100%"', false, 'primary') : button(s.phase === 'end' ? 'End turn →' : 'Roll dice ↗', s.phase === 'end' ? 'end' : 'roll', 'style="width:100%"', game.busy, 'primary'));
    const space = BOARD[selectedSpace], group = GROUPS[space.group];
    if (space.price) {
      const asset = game.asset(space.id), owner = game.player(asset.owner), rent = owner ? game.calculateRent(space.id) : game.calculateRent(space.id, undefined, player, 0);
      $('property-preview').style.setProperty('--group-color', group.color);
      $('property-preview').innerHTML = '<div class="eyebrow">' + group.name.toUpperCase() + '</div><h3>' + space.name + '</h3><p>' + (owner ? 'Owned by ' + escapeHTML(owner.name) : 'Available from the bank') + (asset.mortgaged ? ' · mortgaged' : '') + '</p><div class="property-price">' + money(space.price) + '</div><div class="preview-facts"><span>Current rent<b>' + money(rent) + (space.type === 'utility' ? '¹' : '') + '</b></span><span>Building cost<b>' + (space.type === 'property' ? money(game.buildingCost(owner || player, space)) : 'Not eligible') + '</b></span></div>' + button('View property details ↗', 'details', 'data-id="' + space.id + '" style="width:100%"');
    } else {
      $('property-preview').style.setProperty('--group-color', 'var(--cyan)');
      $('property-preview').innerHTML = '<div class="eyebrow">CITY SPACE</div><h3>' + space.name + '</h3><p>' + specialDescription(space.type) + '</p>' + button('View space details ↗', 'details', 'data-id="' + space.id + '" style="width:100%;margin-top:18px"');
    }
    const financialPlayer = game.player(ownSeat()) || player, f = game.finances(financialPlayer);
    $('financial-summary').innerHTML = '<div class="section-label">YOUR FINANCIAL POSITION</div>' + [['Cash', financialPlayer.cash], ['Property value', f.propertyValue], ['Building value', f.buildingValue], ['Mortgage debt', f.mortgageDebt], ['Rent earned', financialPlayer.stats.rentEarned], ['Rent paid', financialPlayer.stats.rentPaid], ['Net worth', f.netWorth]].map(([label, value]) => '<div class="finance-row' + (label === 'Net worth' ? ' total' : '') + '"><span>' + label + '</span><b>' + money(value) + '</b></div>').join('');
  }
  function specialDescription(type) {
    return { start: 'Collect $200 each time you pass or land on Launch while moving forward.', tax: 'Business Tax: Monopolists pay $100; Competitors pay $80.', wealth: 'Pay 5% of net worth as a Monopolist or 4% as a Competitor, rounded up.', market: 'Draw an original Market Event. Resolve it before continuing.', economic: 'Draw an original Economic Event. Some events affect every active player.', prison: 'Monopolists sent here stop moving and collecting rent. Landing here normally is just a visit.', pricewar: 'Competitors sent here stop moving, but continue collecting rent. Landing here normally is just a visit.', free: 'Competitors receive a $75 enterprise bonus. Monopolists enjoy a safe space.', bank: 'Receive $50 interest. Property mortgages are the only bank borrowing available.', regulation: 'Go directly to your role&#39;s penalty: Monopolists to Prison, Competitors to Price War. Do not collect Launch income.', auction: 'A randomly chosen unowned asset goes to auction. If all assets are owned, receive $40.' }[type];
  }
  function renderLog() {
    const entries = game.state.log.filter(entry => entry.id > lastLogId);
    const log = $('game-log');
    entries.forEach(entry => { const row = document.createElement('div'); row.className = 'log-row ' + entry.kind; const label = document.createElement('span'); label.textContent = 'T' + String(entry.turn).padStart(2, '0'); const message = document.createElement('span'); message.textContent = entry.message; row.append(label, message); log.append(row); });
    while (log.childElementCount > 100) log.firstElementChild.remove();
    if (entries.length) { lastLogId = entries.at(-1).id; log.scrollTop = log.scrollHeight; }
    $('log-count').textContent = game.state.history.length + ' ROLLS RECORDED';
  }
  function onGameChange() {
    if (!game) return;
    const s = game.state;
    if (s.phase !== 'rolling' && !diceAudio.paused) { diceAudio.pause(); diceAudio.currentTime = 0; }
    if (s.phase === 'victory') { closeModal(); renderVictory(); showScreen('victory'); autoSave(); return; }
    if (s.phase === 'moving' && lastPhase === 'moving') { updateTokens(); return; }
    if (lastPhase === 'moving' && !game.busy) selectedSpace = game.active.position;
    const oldCash = Object.fromEntries(s.players.map(player => [player.id, $('cash-' + player.id)?.textContent]));
    $('turn-label').textContent = 'TURN ' + String(s.turn).padStart(2, '0');
    $('board-hint').textContent = s.settings.hints ? (matchMedia('(max-width:600px)').matches ? 'Drag to orbit · pinch to zoom · tap a tile' : 'Drag to orbit · scroll to zoom · click a tile to inspect') : 'NORTHSTAR CITY';
    renderPlayers(); renderCenter(); updateBoard(); updateTokens(); renderSidebar(); renderLog();
    s.players.forEach(player => { if (oldCash[player.id] && oldCash[player.id] !== money(player.cash)) $('cash-' + player.id)?.classList.add('money-changed'); });
    lastPhase = s.phase;
    syncModal(); autoSave(); applyPermissions();
  }
  function autoSave() { $('save-status').textContent = 'Room ' + (metadata?.code || '') + ' · Saved online'; }
  function saveGame(manual = true) { if (manual) notify('Every completed action is saved online automatically.'); }
  function syncModal(force = false) {
    const s = game.state;
    const key = JSON.stringify([s.phase, s.offer, s.event, s.auction, s.pending, game.managerPlayer.cash]);
    if (s.phase === 'debt' && modalKind === 'manager') { renderManager(); return; }
    if (['offer', 'event', 'auction', 'debt'].includes(s.phase)) {
      if (actingSeat() !== ownSeat()) { if (isMandatoryModal()) closeModal(); return; }
      if (key === modalKey && !force) return;
      modalKey = key;
      if (s.phase === 'offer') renderOffer();
      if (s.phase === 'event') renderEvent();
      if (s.phase === 'auction') renderAuction();
      if (s.phase === 'debt') renderDebt();
    } else if (isMandatoryModal()) closeModal();
    else if (modalKind === 'manager') renderManager();
    else if (modalKind === 'details') renderDetails(selectedSpace);
  }
  function rentRows(space, player) {
    if (space.type !== 'property') return '<p class="note">' + (space.type === 'utility' ? 'Utility rent is the dice total ×4 with one utility. With both utilities: ×10 for Monopolists, ×7 for Competitors.' : 'Transit rent is $30 per active station for Monopolists, or $25 per active station for Competitors.') + '</p>';
    return '<table class="rent-table"><thead><tr><th>Development</th><th>Monopolist</th><th>Competitor</th></tr></thead><tbody>' + Array.from({ length: 6 }, (_, level) => '<tr' + (game.asset(space.id).buildings === level ? ' class="current"' : '') + '><td>' + levelName(level) + '</td><td>' + money(level === 0 ? space.monopolistRent * 2 : space.baseRent * [1, 4, 10, 22, 36, 50][level]) + (level === 0 ? '²' : '') + '</td><td>' + money(space.baseRent * [1, 3, 7, 13, 20, 28][level]) + '</td></tr>').join('') + '</tbody></table><p class="note">² Monopolist undeveloped rent shown for a complete, unmortgaged district. Without it, base rent is ' + money(space.baseRent) + '. Build costs for ' + roleName(player) + ': ' + money(game.buildingCost(player, space)) + ' per level.</p>';
  }
  function renderOffer() {
    const space = BOARD[game.state.offer], player = game.active;
    showModal('offer', 'A new opportunity.', '<div class="detail-banner" style="--group-color:' + GROUPS[space.group].color + '"><div><span class="role-badge" style="--role-color:' + GROUPS[space.group].color + '">' + GROUPS[space.group].name.toUpperCase() + '</span><h3>' + space.name + '</h3></div><span>' + money(space.price) + '</span></div><p>' + escapeHTML(player.name) + ', add this asset to your portfolio or let the table bid for it.</p><div class="detail-grid"><div>Your cash<b>' + money(player.cash) + '</b></div><div>Base rent<b>' + money(game.calculateRent(space.id, undefined, player, 0)) + '</b></div><div>Mortgage value<b>' + money(space.mortgageValue) + '</b></div><div>Building cost<b>' + (space.type === 'property' ? money(game.buildingCost(player, space)) : 'Not eligible') + '</b></div></div>' + rentRows(space, player), button('Skip → auction', 'auction') + button('Auction', 'auction') + button('Buy · ' + money(space.price), 'buy', '', player.cash < space.price, 'primary'), { mandatory: true, eyebrow: 'UNOWNED PROPERTY' });
  }
  function renderEvent() {
    const event = game.state.event, card = MarketWars.DECKS[event.deck][event.index];
    showModal('event', event.deck === 'market' ? 'Market Event' : 'Economic Event', '<div class="event-card"><div class="event-icon" aria-hidden="true">' + (event.deck === 'market' ? '↗' : '⌁') + '</div><h3>' + card.title + '</h3><p>' + card.text + '</p></div><p class="note">Drawn by ' + escapeHTML(game.active.name) + '. The effect takes place when you continue.</p>', button('Resolve event →', 'apply-event', '', false, 'primary'), { mandatory: true, eyebrow: 'THE MARKET HAS NEWS' });
  }
  function renderAuction() {
    const auction = game.state.auction, space = BOARD[auction.property], bidder = game.player(auction.bidder), leader = game.player(auction.leader);
    showModal('auction', space.name, '<p>Bank price ' + money(space.price) + '. All active players can bid. Passing withdraws you from this auction.</p><div class="auction-price">' + money(auction.bid) + '</div><div class="auction-leader">' + (leader ? escapeHTML(leader.name) + ' holds the highest bid' : 'No bids yet · opening bid $10') + '</div><div class="auction-players">' + auction.order.map(id => '<span class="' + (auction.passed.includes(id) ? 'passed' : '') + '">' + escapeHTML(game.player(id).name) + (id === auction.leader ? ' · leading' : '') + '</span>').join('') + '</div><div class="auction-turn"><h3 style="color:' + bidder.color + '">' + escapeHTML(bidder.name) + ' bids next</h3><label for="bid-increment">Bid increment · cash available ' + money(bidder.cash) + '</label><input id="bid-increment" type="number" min="10" step="1" max="' + Math.max(10, bidder.cash - auction.bid) + '" value="10"><p class="note">Only the winner pays. The current highest bidder stays in automatically while the other players decide.</p></div>', button('Pass', 'pass') + button('Place bid', 'bid', '', bidder.cash < auction.bid + 10, 'primary'), { mandatory: true, eyebrow: 'OPEN MARKET AUCTION' });
  }
  function renderDebt() {
    const debt = game.state.pending, player = game.managerPlayer, creditor = game.player(debt.creditor), potential = game.liquidatable(player);
    showModal('debt', 'A payment is due.', '<p><b>' + escapeHTML(player.name) + '</b> owes ' + (creditor ? escapeHTML(creditor.name) : 'the bank') + ' for ' + escapeHTML(debt.reason) + '.</p><div class="debt-total">' + money(debt.amount) + '</div><div class="detail-grid"><div>Cash available<b>' + money(player.cash) + '</b></div><div>Cash after all liquidation<b>' + money(potential) + '</b></div></div><p class="note">Sell buildings and mortgage properties to raise cash. The payment stays pending until it is settled. ' + (potential < debt.amount ? 'Even selling and mortgaging every asset cannot cover this debt; bankruptcy is available.' : 'Your assets can cover this debt. Liquidate enough assets before continuing.') + '</p>', button('Manage assets', 'manager') + (potential < debt.amount ? button('Declare bankruptcy', 'bankrupt', '', false, 'danger') : '') + button('Pay ' + money(debt.amount), 'settle', '', player.cash < debt.amount, 'primary'), { mandatory: true, eyebrow: 'FINANCIAL RECOVERY' });
  }
  function assetButtons(space, player) {
    const asset = game.asset(space.id), allowed = game.canManage(), buildReason = game.buildReason(player, space.id), mortgageReason = game.mortgageReason(player, space.id);
    return (space.type === 'property' ? button('Build ' + money(game.buildingCost(player, space)), 'build', 'data-id="' + space.id + '" title="' + escapeHTML(buildReason) + '"', !allowed || !!buildReason) + button('Sell level', 'sell', 'data-id="' + space.id + '"', !allowed || asset.buildings === 0) : '') + (asset.mortgaged ? button('Unmortgage ' + money(Math.ceil(space.mortgageValue * 110 / 100)), 'unmortgage', 'data-id="' + space.id + '"', !allowed || game.state.phase === 'debt' || player.cash < Math.ceil(space.mortgageValue * 110 / 100)) : button('Mortgage ' + money(space.mortgageValue), 'mortgage', 'data-id="' + space.id + '" title="' + escapeHTML(mortgageReason) + '"', !allowed || !!mortgageReason));
  }
  function renderManager() {
    const player = game.player(ownSeat()) || game.managerPlayer, f = game.finances(player), owned = game.owned(player), debt = game.state.pending?.payer === player.id ? game.state.pending : null;
    const summary = '<div class="manager-summary">' + [['Cash', player.cash], ['Property value', f.propertyValue], ['Building value', f.buildingValue], ['Mortgage debt', f.mortgageDebt], ['Net worth', f.netWorth], ['Rent earned', player.stats.rentEarned], ['Rent paid', player.stats.rentPaid]].map(([label, value]) => '<span><b>' + money(value) + '</b>' + label + '</span>').join('') + '</div>';
    const groups = Object.keys(GROUPS).filter(key => owned.some(space => space.group === key));
    const assets = owned.length ? groups.map(group => '<section class="manager-group" style="--group-color:' + GROUPS[group].color + '"><h3>' + GROUPS[group].name.toUpperCase() + ' · ' + owned.filter(space => space.group === group).length + '/' + game.groupSpaces(group).length + '</h3>' + owned.filter(space => space.group === group).map(space => {
      const asset = game.asset(space.id), reason = game.buildReason(player, space.id);
      return '<div class="asset-card"><div><div class="asset-name">' + space.name + '</div><div class="asset-meta">Value ' + money(space.price) + ' · Rent ' + money(game.calculateRent(space.id)) + '<br>' + (asset.mortgaged ? 'MORTGAGED · rent inactive' : levelName(asset.buildings)) + '</div></div><div class="asset-actions">' + assetButtons(space, player) + '</div>' + (reason && space.type === 'property' ? '<p class="asset-reason">' + reason + '</p>' : '') + '</div>';
    }).join('') + '</section>').join('') : '<div class="empty-state"><h3>Your portfolio starts here.</h3><p>Buy a property or win an auction to add your first asset.</p></div>';
    showModal('manager', escapeHTML(player.name) + '\u2019s portfolio', (debt ? '<p class="note">Pending debt: ' + money(debt.amount) + '. Cash needed: ' + money(Math.max(0, debt.amount - player.cash)) + '. Sell buildings first, then mortgage assets.</p>' : (!game.canManage() ? '<p class="note">Inspect your assets now. Changes unlock after this action is resolved.</p>' : '')) + summary + assets, button(debt ? 'Back to payment →' : 'Done', debt ? 'back-debt' : 'close', '', false, 'primary'), { wide: true, mandatory: !!debt, eyebrow: roleName(player).toUpperCase() + ' · ASSET MANAGEMENT' });
  }
  function renderDetails(id) {
    const space = BOARD[id];
    if (!space.price) { showModal('details', space.name, '<p>' + specialDescription(space.type) + '</p>' + (['prison', 'pricewar'].includes(space.type) ? '<p class="note">To leave a penalty: pay $50 before rolling, roll doubles, or pay $50 after three failed rolls. The third failed roll moves you after payment. You can raise cash before paying.</p>' : ''), button('Back to board', 'close', '', false, 'primary')); return; }
    const asset = game.asset(id), owner = game.player(asset.owner), player = owner || game.active;
    showModal('details', space.name, '<div class="detail-banner" style="--group-color:' + GROUPS[space.group].color + '"><div><span class="role-badge" style="--role-color:' + GROUPS[space.group].color + '">' + GROUPS[space.group].name.toUpperCase() + '</span><p>' + (owner ? 'Owned by ' + escapeHTML(owner.name) : 'Unowned · available when landed on') + '</p></div><span>' + money(space.price) + '</span></div><div class="detail-grid"><div>Current rent<b>' + money(game.calculateRent(id)) + '</b></div><div>Development<b>' + levelName(asset.buildings) + '</b></div><div>Mortgage value<b>' + money(space.mortgageValue) + '</b></div><div>Unmortgage cost<b>' + money(Math.ceil(space.mortgageValue * 110 / 100)) + '</b></div></div>' + (asset.mortgaged ? '<p class="note">This property is mortgaged. No rent is collected.</p>' : '') + rentRows(space, player), (owner?.id === ownSeat() ? button('Manage property ↗', 'manager') : '') + button('Back to board', 'close', '', false, 'primary'), { eyebrow: 'PROPERTY DEED' });
  }
  function renderRules() {
    const blocks = [
      ['The objective', 'Be the last financially active player. Everyone starts with $1,500 on Launch. Play online with 2–4 players, each on their own device.'],
      ['A turn at the table', 'Roll two dice and move clockwise. Passing or landing on Launch gives $200. Resolve your space, manage assets, then end your turn. Doubles allow an optional extra roll; three consecutive doubles send you to your role\'s penalty.'],
      ['Monopolists', 'Own every property in a district, all unmortgaged, before building. A complete district doubles your Monopolist base rent; developed property earns higher rents. You collect no rent while in Prison.'],
      ['Competitors', 'Build on any individual land property. Building costs are 25% lower; Business Tax is $80 instead of $100 and Wealth Tax is 4% instead of 5%. Receive $75 at Free Market. Rent continues during Price War.'],
      ['Buying & rent', 'Buy an unowned asset at the listed price or auction it. Skipping also starts an auction. Rent automatically goes to the owner. Mortgaged assets collect no rent. Land rents appear in each property deed.'],
      ['Buildings', 'Develop land from one to four houses, then a commercial tower (level 5). Each level costs the district\'s building price. Sell one level for half its cost, rounded down. Utilities and transit stations cannot be developed. There is no even-building restriction.'],
      ['Mortgages', 'Receive half the purchase price when mortgaging. Sell all buildings on that property first; Monopolists must clear buildings from the entire district. Unmortgage for the mortgage value plus 10%, rounded up. No unsecured loans or player loans.'],
      ['Open auctions', 'All active players can bid, including the player who declined to buy. Raise by at least $10, within your cash balance. Passing withdraws you permanently. The highest bid wins when every challenger passes. If everyone passes without bidding, the asset stays with the bank.'],
      ['Prison & Price War', 'Regulation, some cards, or three doubles send Monopolists to Prison and Competitors to Price War. Landing on these spaces normally is only a visit. Pay $50 before rolling or roll doubles to leave. After three failed rolls, $50 is mandatory, then move the last dice total.'],
      ['Events & city services', 'Each event deck has 15 original cards, shuffled and recycled. Some affect everyone. City Bank pays $50 interest. Utilities charge the dice total ×4, rising to ×10 for a Monopolist or ×7 for a Competitor owning both. Transit rent is $30 or $25 per active station.'],
      ['Debt & bankruptcy', 'An unaffordable payment pauses play. The debtor can sell levels and mortgage assets, including when an event hits them outside their turn. If full liquidation cannot cover the debt, declare bankruptcy. A player creditor receives remaining cash and assets, including mortgages and buildings. Bank debts return assets to the bank, clearing development and mortgages.'],
      ['Wealth, score & saving', 'Net worth is cash + original property prices + buildings at your role\'s construction cost. Mortgage debt is shown separately. Score adds bonus income to net worth. Every completed action is saved online; your room link resumes pending cards, auctions, and debts. Default games have no turn limit.']
    ];
    showModal('rules', 'Two strategies. One winner.', '<p>Buy properties, build businesses, survive economic events, and outlast your rivals.</p><div class="rules-grid">' + blocks.map(([title, text]) => '<section class="rule-block"><h3>' + title + '</h3><p>' + text + '</p></section>').join('') + '</div>', button('Ready to play', 'close', '', false, 'primary'), { wide: true, eyebrow: 'THE MARKET WARS RULEBOOK' });
  }
  function renderSettings() {
    const current = game?.state.settings || settings;
    const toggle = (id, label, note) => '<div class="settings-row"><label for="setting-' + id + '">' + label + '<small>' + note + '</small></label><input type="checkbox" id="setting-' + id + '" data-setting="' + id + '"' + (current[id] ? ' checked' : '') + '></div>';
    const speed = (id, label, note) => '<div class="settings-row"><label for="setting-' + id + '">' + label + '<small>' + note + '</small></label><select id="setting-' + id + '" data-setting="' + id + '">' + [1, 1.5, 2].map(value => '<option value="' + value + '"' + (current[id] === value ? ' selected' : '') + '>' + value + '× speed</option>').join('') + '</select></div>';
    showModal('settings', 'Make it your game.', toggle('sound', 'Sound effects', 'Original synthesized sounds') + speed('animationSpeed', 'Animation speed', 'Dice and visual feedback') + speed('movementSpeed', 'Movement speed', 'Token movement around the board') + toggle('hints', 'Show hints', 'Strategy reminders and board guidance') + '<p class="note">Reduced-motion preferences are respected automatically. Settings apply immediately.</p>', button('Done', 'close', '', false, 'primary'), { eyebrow: 'TABLE SETTINGS' });
  }
  listen(dialog, 'change', event => {
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
    $('victory-screen').innerHTML = '<div class="victory-medal" aria-hidden="true">' + TOKENS[winner.token] + '</div><div class="eyebrow">THE LAST PLAYER STANDING</div><h1>' + escapeHTML(winner.name) + ' wins!</h1><span class="role-badge" style="--role-color:' + winner.color + '">' + roleName(winner).toUpperCase() + ' · NORTHSTAR CITY CHAMPION</span><div class="victory-metrics">' + [['Cash', money(winner.cash)], ['Properties', f.properties], ['Buildings', f.buildings], ['Net worth', money(f.netWorth)], ['Final score', f.score.toLocaleString('en-US')]].map(([label, value]) => '<div><b>' + value + '</b>' + label + '</div>').join('') + '</div><p>Your strategy outlasted the market in ' + game.state.turn + ' turns.</p><div class="victory-stats">' + [['Properties purchased', stats.propertiesPurchased], ['Rent earned', money(stats.rentEarned)], ['Rent paid', money(stats.rentPaid)], ['Buildings built', stats.buildingsBuilt], ['Taxes paid', money(stats.taxesPaid)], ['Launch bonuses', stats.startBonuses], ['Auctions won', stats.auctionWins], ['Cards drawn', stats.cardsDrawn], ['Turns played', stats.turnsPlayed]].map(([label, value]) => '<p>' + label + ' <b>' + value + '</b></p>').join('') + '</div><div class="victory-actions">' + button('Play again ↗', 'replay', '', false, 'primary large') + button('New game', 'new') + button('Main menu', 'menu') + '</div>';
  }
  async function handleAction(action, element) {
    if (action === 'close') { if (modalKind === 'manager' && game?.state.pending?.payer === ownSeat()) { modalKey = ''; renderDebt(); } else closeModal(); return; }
    if (['new', 'replay', 'join', 'load', 'menu'].includes(action)) { closeModal(); online.navigate(action); return; }
    if (action === 'rules') { if (isMandatoryModal()) return; renderRules(); return; }
    if (action === 'settings') { if (isMandatoryModal()) return; renderSettings(); return; }
    if (!game) return;
    const id = Number(element?.dataset.id);
    const mutations = ['roll', 'end', 'buy', 'auction', 'bid', 'pass', 'apply-event', 'release', 'build', 'sell', 'mortgage', 'unmortgage', 'settle', 'bankrupt'];
    if (mutations.includes(action)) {
      if (!canAct(action)) { notify('Wait for the acting player or reconnect to the room.'); return; }
      sending = true; applyPermissions();
      try { await online.command({ action, id, increment: action === 'bid' ? Number($('bid-increment').value) : undefined }); }
      finally { sending = false; applyPermissions(); }
      return;
    }
    switch (action) {
      case 'manager': renderManager(); applyPermissions(); break;
      case 'back-debt': modalKey = ''; renderDebt(); break;
      case 'resume': syncModal(true); applyPermissions(); break;
      case 'save': saveGame(); break;
      case 'board-fit': case 'board-zoom': game.state.settings.boardZoom = action === 'board-zoom'; updateBoardView(); autoSave(); break;
      case 'cam-reset': board3d?.resetCamera(); break;
      case 'cam-top':   board3d?.topCamera();   break;
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
    if (screen !== 'game' || dialog.open || event.target.matches('input,select,textarea')) return;
    if (event.code === 'Space' && game.canRoll()) { event.preventDefault(); void handleAction('roll').catch(error => notify(error.message)); }
    if (event.key === 'e' && game.state.phase === 'end') { event.preventDefault(); void handleAction('end').catch(error => notify(error.message)); }
  });

  // Preview board (home screen) still uses the lightweight CSS grid
  buildBoard($('preview-board'), true);
  showScreen('home');

  function ownSeat() { return metadata?.members.findIndex(member => member.user_id === online.userId()) ?? -1; }
  function actingSeat() { return game?.state.pending?.payer ?? game?.state.auction?.bidder ?? game?.state.currentPlayer; }
  function canAct(action) {
    const actor = ['bid', 'pass'].includes(action) ? game?.state.auction?.bidder : ['build', 'sell', 'mortgage', 'unmortgage', 'settle', 'bankrupt'].includes(action) ? game?.state.pending?.payer ?? game?.state.currentPlayer : game?.state.currentPlayer;
    return !!game && !game.busy && !sending && online.connected() && ownSeat() === actor && !game.state.players[ownSeat()]?.bankrupt;
  }
  function applyPermissions() {
    document.querySelectorAll('[data-action]').forEach(element => {
      const action = element.dataset.action;
      if (['roll', 'end', 'buy', 'auction', 'bid', 'pass', 'apply-event', 'release', 'build', 'sell', 'mortgage', 'unmortgage', 'settle', 'bankrupt'].includes(action)) {
        const ruleDisabled = element.dataset.ruleDisabled;
        if (ruleDisabled !== undefined) element.disabled = ruleDisabled === 'true' || !canAct(action);
        else element.disabled ||= !canAct(action);
      }
    });
    if (game && $('save-status')) autoSave();
  }
  async function renderRoom(room) {
    if (metadata?.code !== room.code) { revision = -1; game = null; animationGeneration++; }
    metadata = room;
    if (!room.state) { animationGeneration++; closeModal(); showScreen('lobby'); return; }
    if (room.revision <= revision) { applyPermissions(); return; }
    const first = revision < 0, consecutive = room.revision === revision + 1, previous = game?.state;
    revision = room.revision;
    const generation = ++animationGeneration;
    game = new Game(room.members);
    game.state = structuredClone(room.state);
    Object.assign(game.state.settings, settings);
    if (first) {
      lastLogId = 0; lastPhase = null; $('game-log').innerHTML = '';
      // Build the hidden CSS-grid board (for a11y) but don&#39;t show it
      buildBoard($('game-board'));
    }
    closeModal(); modalKey = ''; showScreen('game');
    const transition = room.transition;
    if (!first && consecutive && transition && previous && (transition.action === 'roll' || transition.path?.length)) {
      const final = structuredClone(game.state), player = transition.player;
      game.state.dice = transition.dice;
      game.state.players[player].position = previous.players[player].position;
      game.state.phase = transition.action === 'roll' ? 'rolling' : 'moving';
      onGameChange();
      if (transition.action === 'roll') { playSound('dice'); await pause(650 / settings.animationSpeed); }
      for (const position of transition.path || []) {
        if (generation !== animationGeneration) return;
        game.state.phase = 'moving'; game.state.players[player].position = position;
        onGameChange(); await pause(150 / settings.movementSpeed);
      }
      if (generation !== animationGeneration) return;
      game.state = final;
      selectedSpace = game.active.position;
    }
    onGameChange();
    if (!first && consecutive) for (const sound of transition?.sounds || []) if (sound !== 'dice') playSound(sound);
  }
  function pause(ms) { return new Promise(resolve => setTimeout(resolve, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms)); }
  return {
    renderRoom,
    setConnection() { if (game) { renderCenter(); renderSidebar(); applyPermissions(); } },
    showHome() { animationGeneration++; metadata = null; game = null; revision = -1; closeModal(); showScreen('home'); },
    showLobby() { closeModal(); showScreen('lobby'); },
    destroy() {
      animationGeneration++;
      controller.abort();
      clearTimeout(toastTimer);
      dialog.close();
      visitorAudio.pause();
      diceAudio.pause();
      void audioContext?.close();
      // Clean up Three.js scene
      board3d?.destroy();
      board3d = null;
    }
  };
}
