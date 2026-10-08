'use strict';

/* All decisions use the model. The browser renderer never supplies financial data. */
const MarketWars = (() => {
  const SAVE_KEY = 'market-wars-save-v1';
  const SETTINGS_KEY = 'market-wars-settings-v1';
  const START_CASH = 1500;
  const START_BONUS = 200;
  // Black, royal blue, magenta, lime: far apart in hue and lightness, and none matches a board colour group.
  const TOKEN_COLORS = { black: '#17171c', blue: '#1e40e6', magenta: '#e3008c', lime: '#7ed321' };
  const COLORS = Object.values(TOKEN_COLORS);
  // Rooms and saves from before colour markers used emoji tokens; give each such player the first free colour.
  const normalizeTokens = players => {
    const taken = new Set(players.map(player => player.token).filter(token => TOKENS[token]));
    return players.map(player => {
      if (TOKENS[player.token]) return player;
      const token = Object.keys(TOKENS).find(key => !taken.has(key)) || player.token;
      taken.add(token);
      return { ...player, token };
    });
  };
  // A player's token is their colour marker. Labels for display; TOKEN_COLORS paints pawns, shields and houses.
  const TOKENS = { black: 'Black', blue: 'Royal blue', magenta: 'Magenta', lime: 'Lime' };
  const GROUPS = {
    harbor: { name: 'Tidehaven', color: '#bd8453', cost: 50 },
    canal: { name: 'Canal Quarter', color: '#57b9ca', cost: 60 },
    garden: { name: 'Verdant Park', color: '#d675a3', cost: 80 },
    studio: { name: 'Studio Row', color: '#e69b40', cost: 100 },
    metro: { name: 'Civic Center', color: '#db6456', cost: 120 },
    tech: { name: 'Circuit District', color: '#e4cc47', cost: 140 },
    ridge: { name: 'Summit Heights', color: '#52a677', cost: 160 },
    premium: { name: 'Aurora Mile', color: '#a378be', cost: 180 },
    transport: { name: 'Transit Network', color: '#66818a', cost: 0 },
    utility: { name: 'City Services', color: '#77968e', cost: 0 }
  };
  const land = (name, group, price, baseRent) => ({ type: 'property', name, group, price, baseRent });
  const special = (name, type, symbol, caption) => ({ name, type, symbol, caption });
  const BOARD = [
    special('Launch', 'start', '↗', '+$200'),
    land('Beacon Wharf', 'harbor', 100, 8), land('Sailmaker Lane', 'harbor', 120, 10),
    special('Market Event', 'market', '↗', 'DRAW A CARD'),
    land('Lockside Walk', 'canal', 140, 12), special('Business Tax', 'tax', '%', 'PAY $200'),
    land('Ripple Arcade', 'canal', 140, 12), land('Waterwheel Row', 'canal', 160, 14),
    { type: 'transport', name: 'Northline Rail', group: 'transport', price: 180, baseRent: 20 },
    land('Clover Commons', 'garden', 160, 14), special('Prison', 'prison', '▥', 'JUST VISITING'),
    land('Fern Promenade', 'garden', 180, 16), special('Economic Event', 'economic', '⌁', 'DRAW A CARD'),
    land('Orchard Terrace', 'garden', 180, 16), land('Mosaic Works', 'studio', 200, 18),
    { type: 'utility', name: 'Solar Cooperative', group: 'utility', price: 150, baseRent: 4 },
    land('Foundry Studios', 'studio', 220, 20), special('Market Event', 'market', '↗', 'DRAW A CARD'),
    land('Atelier Square', 'studio', 220, 20), land('Exchange Walk', 'metro', 240, 22),
    special('Free Market', 'free', '◎', 'OPEN ECONOMY'), land('Meridian Plaza', 'metro', 240, 22),
    land('Civic Boulevard', 'metro', 260, 24),
    { type: 'transport', name: 'Skyway Terminal', group: 'transport', price: 200, baseRent: 20 },
    land('Binary Gardens', 'tech', 280, 26), special('Wealth Tax', 'wealth', '%', 'PAY $100'),
    land('Photon Avenue', 'tech', 300, 28), land('Venture Campus', 'tech', 300, 28),
    special('Economic Event', 'economic', '⌁', 'DRAW A CARD'),
    { type: 'utility', name: 'Reservoir Network', group: 'utility', price: 180, baseRent: 4 },
    special('Go to Prison', 'gotoprison', '➜', 'GO DIRECTLY'), land('Cloudcrest Drive', 'ridge', 320, 30),
    land('Overlook Terrace', 'ridge', 340, 32), special('City Bank', 'bank', '▤', '+$50 INTEREST'),
    land('Pinnacle Court', 'ridge', 340, 32), land('Radiant Avenue', 'premium', 360, 34),
    special('Market Event', 'market', '↗', 'DRAW A CARD'), land('Solstice Square', 'premium', 380, 38),
    special('Open Auction', 'auction', '◇', 'NEW OPPORTUNITY'), land('Aurora Esplanade', 'premium', 400, 42)
  ].map((space, id) => {
    if (!space.price) return { ...space, id };
    return {
      ...space, id,
      mortgageValue: Math.floor(space.price / 2), buildingCost: GROUPS[space.group].cost,
      houseRents: [4, 10, 22, 36].map(multiplier => space.baseRent * multiplier),
      apartmentRent: space.baseRent * 50
    };
  });
  const MARKET_CARDS = [
    { title: 'A strong opening', text: 'Your first product launch sells out. Receive $150.', effect: 'cash', amount: 150 },
    { title: 'Unexpected upkeep', text: 'A burst pipe interrupts business. Pay $80 for repairs.', effect: 'pay', amount: 80 },
    { title: 'Quarterly momentum', text: 'A reliable quarter earns a performance bonus. Receive $200.', effect: 'cash', amount: 200 },
    { title: 'Licensing deal', text: 'Another business licenses your original design. Receive $100.', effect: 'cash', amount: 100 },
    { title: 'Delayed shipment', text: 'You cover expedited delivery for a missed shipment. Pay $60.', effect: 'pay', amount: 60 },
    { title: 'Fresh start', text: 'A new venture takes you to Launch. Collect $200.', effect: 'advance', destination: 0 },
    { title: 'Transit partnership', text: 'Visit the next transit station. Collect Launch income if you pass it; resolve the station normally.', effect: 'nearest', target: 'transport' },
    { title: 'District renewal', text: 'Maintain your portfolio: pay $20 per house and $80 per tower.', effect: 'repairs' },
    { title: 'Customer loyalty', text: 'Your regular customers bring new business. Receive $90.', effect: 'cash', amount: 90 },
    { title: 'Market investigation', text: 'Your business faces a review. Go directly to Prison. Do not pass Launch; do not collect $200.', effect: 'penalty' },
    { title: 'Independent spirit', text: 'Your side project pays off. Receive $100.', effect: 'cash', amount: 100 },
    { title: 'Inventory surplus', text: 'Sell excess inventory at a neighborhood fair. Receive $70.', effect: 'cash', amount: 70 },
    { title: 'Brand refresh', text: 'Commission a new identity for your business. Pay $90.', effect: 'pay', amount: 90 },
    { title: 'Community dividend', text: 'A shared campaign succeeds. Every active player receives $40.', effect: 'allcash', amount: 40 },
    { title: 'Open doors', text: 'Visit Free Market. Collect Launch income if you pass it.', effect: 'advance', destination: 20 }
  ];
  const ECONOMIC_CARDS = [
    { title: 'Fair trading review', text: 'Pay $50 in oversight fees.', effect: 'pay', amount: 50 },
    { title: 'Small business fund', text: 'The enterprise fund backs your business. Receive $100.', effect: 'cash', amount: 100 },
    { title: 'Cooling economy', text: 'Every active player pays $50 to stabilize the market.', effect: 'allpay', amount: 50 },
    { title: 'Expansion grant', text: 'Your business plan earns a city grant. Receive $120.', effect: 'cash', amount: 120 },
    { title: 'Clean energy rebate', text: 'Receive $50, plus $40 for each utility you own.', effect: 'utilitycash' },
    { title: 'New compliance rules', text: 'A regulatory hearing pauses your operation. Go directly to Prison.', effect: 'penalty' },
    { title: 'Bank settlement', text: 'Visit City Bank to collect $50 interest. Collect Launch income if you pass it.', effect: 'advance', destination: 33 },
    { title: 'Infrastructure levy', text: 'Contribute $70 to the city’s public works budget.', effect: 'pay', amount: 70 },
    { title: 'Export opportunity', text: 'A new regional agreement opens a customer market. Receive $160.', effect: 'cash', amount: 160 },
    { title: 'Hiring incentive', text: 'A city jobs programme rewards your hiring. Receive $90.', effect: 'cash', amount: 90 },
    { title: 'Insurance adjustment', text: 'Your insurer refunds an overpayment. Receive $60.', effect: 'cash', amount: 60 },
    { title: 'Building inspection', text: 'Pay $15 per house and $60 per tower for safety inspections.', effect: 'repairs', house: 15, tower: 60 },
    { title: 'Regional recovery', text: 'Every active player receives a $75 recovery dividend.', effect: 'allcash', amount: 75 },
    { title: 'Business filing', text: 'Renew your business registration. Pay $40.', effect: 'pay', amount: 40 },
    { title: 'Portfolio dividend', text: 'Receive $25 for every active, unmortgaged property you own.', effect: 'portfoliocash' }
  ];
  const DECKS = { market: MARKET_CARDS, economic: ECONOMIC_CARDS };
  const DEFAULT_SETTINGS = { sound: true, animationSpeed: 1, movementSpeed: 1, autoSave: true, hints: true, boardZoom: false };
  const stats = () => ({ propertiesPurchased: 0, rentEarned: 0, rentPaid: 0, buildingsBuilt: 0, taxesPaid: 0, startBonuses: 0, auctionWins: 0, cardsDrawn: 0, turnsPlayed: 0, bonusIncome: 0 });
  const money = amount => '$' + Math.round(amount).toLocaleString('en-US');
  const levelName = level => level === 5 ? 'Commercial tower' : level === 0 ? 'Undeveloped' : level + (level === 1 ? ' house' : ' houses');
  const clone = value => JSON.parse(JSON.stringify(value));
  const shuffle = (array, random) => {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  };
  function validatePlayers(players) {
    if (players.length < 2 || players.length > 4) return 'Choose between 2 and 4 players.';
    if (players.some(player => !player.name.trim() || player.name.trim().length > 20)) return 'Each player needs a name of 1–20 characters.';
    if (new Set(players.map(player => player.name.trim().toLowerCase())).size !== players.length) return 'Give each player a unique name.';
    if (new Set(players.map(player => player.token)).size !== players.length) return 'Choose a different color for each player.';
    if (players.some(player => !TOKENS[player.token])) return 'Choose a valid player color.';
    return '';
  }

  class Game {
    constructor(players, settings = {}, options = {}) {
      players = normalizeTokens(players);
      const error = validatePlayers(players);
      if (error) throw new Error(error);
      this.random = options.random || Math.random;
      // One fair die face (1–6). The server supplies an exact cryptographic draw; tests use `random`.
      this.rollDie = options.rollDie || (() => 1 + Math.floor(this.random() * 6));
      this.wait = options.wait || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
      this.onChange = options.onChange || (() => {});
      this.onSound = options.onSound || (() => {});
      this.state = {
        version: 1, players: players.map((player, id) => ({ id, name: player.name.trim(), token: player.token, color: TOKEN_COLORS[player.token], type: 'human', cash: START_CASH, position: 0, bankrupt: false, penalty: null, stats: stats() })),
        properties: Object.fromEntries(BOARD.filter(space => space.price).map(space => [space.id, { owner: null, buildings: 0, mortgaged: false }])),
        currentPlayer: 0, turn: 1, phase: 'ready', dice: [1, 1], hasRolled: false, doublesCount: 0, extraRoll: false,
        offer: null, auction: null, trade: null, tradesThisTurn: 0, tradeHistory: [], event: null, pending: null, payments: [], continuation: null,
        decks: Object.fromEntries(Object.entries(DECKS).map(([name, cards]) => [name, { order: shuffle(cards.map((_, i) => i), this.random), cursor: 0 }])),
        settings: { ...DEFAULT_SETTINGS, ...settings }, log: [], history: [], winner: null, createdAt: Date.now(), savedAt: null
      };
      this.active.stats.turnsPlayed++;
      this.log('The market is open. Every player starts with $1,500.', 'important');
      this.log(this.active.name + ' takes the first turn.');
    }
    get active() { return this.state.players[this.state.currentPlayer]; }
    get living() { return this.state.players.filter(player => !player.bankrupt); }
    get busy() { return ['rolling', 'moving'].includes(this.state.phase); }
    get managerPlayer() { return this.state.pending ? this.player(this.state.pending.payer) : this.active; }
    player(id) { return this.state.players.find(player => player.id === id); }
    asset(id) { return this.state.properties[id]; }
    owned(player) { return BOARD.filter(space => space.price && this.asset(space.id).owner === player.id); }
    groupSpaces(group) { return BOARD.filter(space => space.group === group && space.price); }
    completeGroup(player, group) { return this.groupSpaces(group).every(space => this.asset(space.id).owner === player.id && !this.asset(space.id).mortgaged); }
    groupOwnedCount(player, group, activeOnly = false) { return this.groupSpaces(group).filter(space => this.asset(space.id).owner === player.id && !(activeOnly && this.asset(space.id).mortgaged)).length; }
    // Every player pays the printed district price per building and the listed price for land.
    buildingCost(player, space) { return space.buildingCost; }
    purchasePrice(player, space) { return space.price; }
    finances(player) {
      const assets = this.owned(player);
      const propertyValue = assets.reduce((sum, space) => sum + space.price, 0);
      const buildingValue = assets.reduce((sum, space) => sum + this.asset(space.id).buildings * this.buildingCost(player, space), 0);
      const mortgageDebt = assets.reduce((sum, space) => sum + (this.asset(space.id).mortgaged ? Math.ceil(space.mortgageValue * 110 / 100) : 0), 0);
      const buildings = assets.reduce((sum, space) => sum + this.asset(space.id).buildings, 0);
      const netWorth = player.cash + propertyValue + buildingValue;
      return { propertyValue, buildingValue, mortgageDebt, buildings, netWorth, properties: assets.length, score: netWorth + player.stats.bonusIncome };
    }
    calculateRent(id, diceTotal = this.state.dice[0] + this.state.dice[1], ownerOverride = null, levelOverride = null) {
      const space = BOARD[id], asset = this.asset(id);
      if (!space?.price || !asset) return 0;
      const owner = ownerOverride || this.player(asset.owner);
      if (!owner || (!ownerOverride && (asset.mortgaged || owner.bankrupt))) return 0;
      const count = this.owned(owner).filter(item => item.group === space.group && !this.asset(item.id).mortgaged).length || 1;
      // Classic rents: $25 per station doubling with each one owned; utilities ×4, or ×10 with both.
      if (space.type === 'transport') return 25 * 2 ** (count - 1);
      if (space.type === 'utility') return diceTotal * (count > 1 ? 10 : 4);
      const level = levelOverride ?? asset.buildings;
      if (level > 0) return level === 5 ? space.apartmentRent : space.houseRents[level - 1];
      // Owning at least 2 properties of the color doubles rent on undeveloped land.
      return this.groupOwnedCount(owner, space.group) >= 2 ? space.baseRent * 2 : space.baseRent;
    }
    liquidatable(player) {
      return player.cash + this.owned(player).reduce((sum, space) => {
        const asset = this.asset(space.id);
        return sum + asset.buildings * Math.floor(this.buildingCost(player, space) / 2) + (asset.mortgaged ? 0 : space.mortgageValue);
      }, 0);
    }
    log(message, kind = 'normal') {
      const entry = { message, kind, turn: this.state.turn, id: (this.state.log.at(-1)?.id || 0) + 1 };
      this.state.log.push(entry);
      if (this.state.log.length > 200) this.state.log.shift();
      const turn = this.state.history.at(-1);
      if (turn && turn.turn === this.state.turn) turn.transactions.push(message);
    }
    emit() { this.onChange(this.state); }
    sound(kind) { if (this.state.settings.sound) this.onSound(kind); }
    require(condition, message) { if (!condition) throw new Error(message); }
    canRoll() { return !this.active.bankrupt && (this.state.phase === 'ready' || (this.state.phase === 'end' && this.state.extraRoll)); }
    canManage() { return !this.managerPlayer.bankrupt && ['ready', 'end', 'debt'].includes(this.state.phase); }
    credit(player, amount, reason, bonus = true) {
      if (player.bankrupt || amount <= 0) return;
      player.cash += amount;
      if (bonus) player.stats.bonusIncome += amount;
      this.log(player.name + ' received ' + money(amount) + ': ' + reason + '.', 'money');
      this.sound('income');
    }
    async rollDice() {
      this.require(this.canRoll(), 'Resolve the current action before rolling.');
      const s = this.state, player = this.active;
      s.phase = 'rolling'; s.extraRoll = false; s.hasRolled = true;
      s.dice = [this.rollDie(), this.rollDie()];
      this.sound('dice'); this.emit();
      await this.wait(650 / s.settings.animationSpeed);
      const total = s.dice[0] + s.dice[1], doubles = s.dice[0] === s.dice[1];
      this.log(player.name + ' rolled ' + s.dice.join(' + ') + ' = ' + total + (doubles ? ' (doubles).' : '.'));
      s.history.push({ turn: s.turn, player: player.id, dice: [...s.dice], landing: null, transactions: [] });
      if (s.history.length > 100) s.history.shift();
      if (player.penalty) {
        if (doubles) {
          this.log(player.name + ' rolled doubles and left Prison.');
          player.penalty = null;
          await this.movePlayer(total);
        } else {
          player.penalty.attempts++;
          if (player.penalty.attempts >= 3) {
            this.log('Three attempts used. ' + player.name + ' owes $50 to leave the penalty space.');
            this.beginPayments([{ payer: player.id, creditor: null, amount: 50, reason: 'mandatory penalty release', category: 'fee' }], { kind: 'releaseMove', steps: total });
          } else {
            this.log(player.name + ' remains in Prison (attempt ' + player.penalty.attempts + '/3).');
            this.finishResolution();
          }
        }
        return;
      }
      s.doublesCount = doubles ? s.doublesCount + 1 : 0;
      if (s.doublesCount === 3) { this.sendPlayerToPenalty(player); this.finishResolution(); return; }
      s.extraRoll = doubles;
      // A doubles stop is only a waypoint: no purchase, rent, tax or event until the final roll.
      await this.movePlayer(total, { resolve: !doubles, waypoint: doubles });
    }
    async movePlayer(steps, { resolve = true, awardStart = true, waypoint = false } = {}) {
      const s = this.state, player = this.active;
      if (player.bankrupt || s.phase === 'victory') return;
      s.phase = 'moving'; this.emit();
      const direction = steps < 0 ? -1 : 1;
      for (let i = 0; i < Math.abs(steps); i++) {
        player.position = (player.position + direction + BOARD.length) % BOARD.length;
        if (player.position === 0 && direction > 0 && awardStart) {
          player.cash += START_BONUS; player.stats.startBonuses++; player.stats.bonusIncome += START_BONUS;
          this.log(player.name + ' passed Launch and received $200.', 'money'); this.sound('income');
        }
        this.emit();
        await this.wait(150 / s.settings.movementSpeed);
      }
      this.log(player.name + ' landed on ' + BOARD[player.position].name + '.');
      const history = s.history.at(-1);
      if (history) history.landing = player.position;
      if (waypoint) this.log(player.name + ' rolled doubles, so nothing happens on ' + BOARD[player.position].name + '. Roll again.', 'important');
      if (resolve) this.resolveSpace(); else this.finishResolution();
    }
    resolveSpace() {
      const player = this.active, space = BOARD[player.position], s = this.state;
      if (space.price) {
        const asset = this.asset(space.id);
        if (asset.owner === null) { s.offer = space.id; s.phase = 'offer'; this.emit(); return; }
        if (asset.owner !== player.id) {
          const owner = this.player(asset.owner), rent = this.calculateRent(space.id);
          this.log(space.name + ' belongs to ' + owner.name + '.');
          this.sound('visitor');
          if (rent > 0) { this.beginPayments([{ payer: player.id, creditor: owner.id, amount: rent, reason: space.name + ' rent', category: 'rent' }]); return; }
          this.log('No rent is due: the property is mortgaged.');
        } else if (asset.ready === false) {
          // Newly acquired land unlocks building once its owner lands on it again.
          asset.ready = true;
          this.log(player.name + ' returned to ' + space.name + (space.type === 'property' ? ' and can now build there.' : '.'), 'important');
        }
        this.finishResolution(); return;
      }
      switch (space.type) {
        case 'market': case 'economic': this.drawCard(space.type); return;
        case 'tax': case 'wealth': {
          const amount = space.type === 'tax' ? 200 : 100;
          this.beginPayments([{ payer: player.id, creditor: null, amount, reason: space.name, category: 'tax' }]); return;
        }
        case 'free': this.log('Free Market is open. ' + player.name + ' takes a breather.'); break;
        case 'bank': this.credit(player, 50, 'City Bank interest'); break;
        case 'gotoprison': this.sendPlayerToPenalty(player); break;
        case 'auction': {
          const available = BOARD.filter(item => item.price && this.asset(item.id).owner === null);
          if (available.length) {
            s.offer = available[Math.floor(this.random() * available.length)].id; s.phase = 'offer';
            this.log('The market offers ' + BOARD[s.offer].name + ' for purchase.'); this.emit(); return;
          }
          this.credit(player, 40, 'all city assets are allocated; auction dividend'); break;
        }
        case 'prison': this.log(player.name + ' is just visiting; there is no penalty.'); break;
        case 'start': this.log('A new circuit of the city begins.'); break;
      }
      this.finishResolution();
    }
    purchaseProperty() {
      const s = this.state, player = this.active, id = s.offer, space = BOARD[id];
      this.require(s.phase === 'offer' && space?.price && this.asset(id).owner === null, 'This property is no longer available.');
      const price = this.purchasePrice(player, space);
      this.require(player.cash >= price, 'You do not have enough cash.');
      player.cash -= price; this.asset(id).owner = player.id; this.asset(id).ready = false; player.stats.propertiesPurchased++;
      this.log(player.name + ' purchased ' + space.name + ' for ' + money(price) + '.', 'money');
      s.offer = null; this.sound('purchase'); this.finishResolution();
    }
    declineProperty() {
      this.require(this.state.phase === 'offer', 'There is no property offer to skip.');
      this.log(this.active.name + ' passed on ' + BOARD[this.state.offer].name + '. It stays with the bank.');
      this.state.offer = null; this.finishResolution();
    }
    startAuction(id) {
      const s = this.state;
      this.require(BOARD[id]?.price && this.asset(id).owner === this.active.id && ['ready', 'end'].includes(s.phase), 'Only the owner can auction a purchased property during their turn.');
      this.require(!this.asset(id).mortgaged, 'Unmortgage this property before auctioning it.');
      const seller = this.active.id, returnPhase = s.phase;
      const rotated = this.living.map(player => player.id).filter(playerId => playerId !== seller);
      this.require(rotated.length > 0, 'There are no other bidders.');
      s.offer = null; s.phase = 'auction';
      s.auction = { property: id, seller, returnPhase, bid: 0, leader: null, order: rotated, passed: [], bidder: rotated[0] };
      this.log(this.active.name + ' is auctioning ' + BOARD[id].name + ', including its buildings.', 'important');
      this.emit();
    }
    auctionBid(increment) {
      const s = this.state, auction = s.auction;
      this.require(s.phase === 'auction' && auction, 'There is no active auction.');
      const bidder = this.player(auction.bidder);
      this.require(Number.isInteger(increment) && increment >= 10, 'The bid increment must be a whole amount of at least $10.');
      const bid = auction.bid + increment;
      this.require(bidder.cash >= bid, 'The bidder cannot cover that amount.');
      auction.bid = bid; auction.leader = bidder.id;
      this.log(bidder.name + ' bids ' + money(bid) + ' for ' + BOARD[auction.property].name + '.');
      this.advanceAuction();
    }
    auctionPass() {
      this.require(this.state.phase === 'auction', 'There is no active auction.');
      const auction = this.state.auction;
      auction.passed.push(auction.bidder);
      this.log(this.player(auction.bidder).name + ' leaves the auction.');
      this.advanceAuction();
    }
    advanceAuction() {
      const s = this.state, auction = s.auction;
      const challengers = auction.order.filter(id => !auction.passed.includes(id) && id !== auction.leader && !this.player(id).bankrupt);
      if (!challengers.length) {
        if (auction.leader !== null) {
          const winner = this.player(auction.leader);
          winner.cash -= auction.bid; this.asset(auction.property).owner = winner.id; this.asset(auction.property).ready = false;
          if (auction.seller != null) this.player(auction.seller).cash += auction.bid;
          winner.stats.auctionWins++; winner.stats.propertiesPurchased++;
          this.log(winner.name + ' won ' + BOARD[auction.property].name + ' for ' + money(auction.bid) + '.', 'money'); this.sound('purchase');
        } else this.log('No bids were made. The property stays with ' + (auction.seller != null ? this.player(auction.seller).name : 'the bank') + '.');
        const returnPhase = auction.returnPhase;
        s.auction = null;
        if (returnPhase) { s.phase = returnPhase; this.emit(); }
        else this.finishResolution(); // Existing saved bank auctions can still finish.
        return;
      }
      const current = auction.order.indexOf(auction.bidder);
      for (let step = 1; step <= auction.order.length; step++) {
        const id = auction.order[(current + step) % auction.order.length];
        if (challengers.includes(id)) { auction.bidder = id; break; }
      }
      this.emit();
    }
    drawCard(deckName) {
      const s = this.state, deck = s.decks[deckName];
      if (deck.cursor >= deck.order.length) { deck.order = shuffle(deck.order, this.random); deck.cursor = 0; }
      const index = deck.order[deck.cursor++];
      s.event = { deck: deckName, index }; s.phase = 'event'; this.active.stats.cardsDrawn++;
      this.log(this.active.name + ' drew “' + DECKS[deckName][index].title + '”.'); this.sound('event'); this.emit();
    }
    async applyCard() {
      const s = this.state;
      this.require(s.phase === 'event' && s.event, 'There is no event to resolve.');
      const card = DECKS[s.event.deck][s.event.index], player = this.active;
      s.event = null;
      const payment = (payer, amount) => ({ payer: payer.id, creditor: null, amount, reason: card.title, category: 'fee' });
      switch (card.effect) {
        case 'cash': this.credit(player, card.amount, card.title); break;
        case 'pay': this.beginPayments([payment(player, card.amount)]); return;
        case 'allcash': this.living.forEach(item => this.credit(item, card.amount, card.title)); break;
        case 'allpay': this.beginPayments(this.living.map(item => payment(item, card.amount))); return;
        case 'repairs': {
          const amount = this.owned(player).reduce((sum, space) => sum + (this.asset(space.id).buildings === 5 ? (card.tower || 80) : this.asset(space.id).buildings * (card.house || 20)), 0);
          this.log('Portfolio maintenance totals ' + money(amount) + '.'); this.beginPayments([payment(player, amount)]); return;
        }
        case 'advance': {
          const steps = (card.destination - player.position + BOARD.length) % BOARD.length;
          await this.movePlayer(steps || (card.destination === 0 ? BOARD.length : 0)); return;
        }
        case 'nearest': {
          let steps = 1;
          while (BOARD[(player.position + steps) % BOARD.length].type !== card.target) steps++;
          await this.movePlayer(steps); return;
        }
        case 'penalty': this.sendPlayerToPenalty(player); break;
        case 'utilitycash': this.credit(player, 50 + this.owned(player).filter(space => space.type === 'utility').length * 40, card.title); break;
        case 'portfoliocash': this.credit(player, this.owned(player).filter(space => !this.asset(space.id).mortgaged).length * 25, card.title); break;
      }
      this.finishResolution();
    }
    sendPlayerToPenalty(player) {
      player.position = 10; player.penalty = { kind: 'prison', attempts: 0 };
      this.state.extraRoll = false;
      this.log(player.name + ' was sent to Prison. Rent collection continues.', 'important');
      this.sound('event');
    }
    payPenalty() {
      this.require(this.state.phase === 'ready' && this.active.penalty, 'You can pay for release at the beginning of a detained turn.');
      this.beginPayments([{ payer: this.active.id, creditor: null, amount: 50, reason: 'voluntary penalty release', category: 'fee' }], { kind: 'release' });
    }
    beginPayments(payments, continuation = { kind: 'finish' }) {
      this.state.payments = payments.filter(payment => payment.amount > 0);
      this.state.continuation = continuation;
      this.processPayments();
    }
    processPayments() {
      const s = this.state;
      if (s.phase === 'victory') return;
      s.pending = null;
      while (s.payments.length) {
        const payment = s.payments[0], payer = this.player(payment.payer);
        if (payer.bankrupt) { s.payments.shift(); continue; }
        if (payer.cash < payment.amount) { s.pending = payment; s.phase = 'debt'; this.emit(); return; }
        payer.cash -= payment.amount;
        const creditor = payment.creditor === null ? null : this.player(payment.creditor);
        if (creditor && !creditor.bankrupt) creditor.cash += payment.amount;
        if (payment.category === 'rent') { payer.stats.rentPaid += payment.amount; if (creditor) creditor.stats.rentEarned += payment.amount; }
        if (payment.category === 'tax') payer.stats.taxesPaid += payment.amount;
        this.log(payer.name + ' paid ' + money(payment.amount) + (creditor ? ' to ' + creditor.name : ' to the bank') + ': ' + payment.reason + '.', 'money');
        if (payment.category !== 'rent') this.sound('payment');
        s.payments.shift();
      }
      const continuation = s.continuation || { kind: 'finish' };
      s.continuation = null;
      if (this.active.bankrupt) { this.finishResolution(); return; }
      if (continuation.kind === 'release' || continuation.kind === 'releaseMove') {
        this.active.penalty = null; this.log(this.active.name + ' paid for release.');
        if (continuation.kind === 'releaseMove') { void this.movePlayer(continuation.steps); return; }
        s.phase = 'ready'; this.emit(); return;
      }
      this.finishResolution();
    }
    settleDebt() {
      this.require(this.state.phase === 'debt' && this.state.pending, 'There is no outstanding debt.');
      this.require(this.managerPlayer.cash >= this.state.pending.amount, 'Raise enough cash before settling this debt.');
      this.processPayments();
    }
    declareBankruptcy() {
      const s = this.state, debt = s.pending;
      this.require(s.phase === 'debt' && debt, 'Bankruptcy is available when a payment cannot be made.');
      const payer = this.player(debt.payer), creditor = debt.creditor === null ? null : this.player(debt.creditor);
      this.require(this.liquidatable(payer) < debt.amount, 'Your assets can cover this payment. Sell buildings and mortgage properties first.');
      if (creditor && !creditor.bankrupt) creditor.cash += payer.cash;
      this.owned(payer).forEach(space => {
        const asset = this.asset(space.id);
        if (creditor && !creditor.bankrupt) { asset.owner = creditor.id; asset.ready = false; }
        else { asset.owner = null; asset.buildings = 0; asset.mortgaged = false; delete asset.ready; }
      });
      if (debt.category === 'rent' && creditor) { creditor.stats.rentEarned += payer.cash; payer.stats.rentPaid += payer.cash; }
      payer.cash = 0; payer.bankrupt = true; payer.penalty = null;
      this.log(payer.name + ' is bankrupt. Assets ' + (creditor ? 'transfer to ' + creditor.name + '.' : 'return to the bank.'), 'important');
      s.pending = null; s.payments.shift();
      if (this.checkWinner()) { this.emit(); return; }
      this.processPayments();
    }
    actionOwner(id) {
      const space = BOARD[id], asset = this.asset(id), player = this.managerPlayer;
      this.require(this.canManage(), 'Property changes are allowed before rolling, after resolving a move, or while raising cash for debt.');
      this.require(space?.price && asset?.owner === player.id, 'Only the acting owner may change this property.');
      return { space, asset, player };
    }
    buildReason(player, id) {
      const space = BOARD[id], asset = this.asset(id);
      if (space.type !== 'property') return 'Transit stations and utilities cannot be developed.';
      if (asset.mortgaged) return 'Unmortgage this property before building.';
      if (asset.ready === false) return 'Land on ' + space.name + ' again to start building here.';
      if (asset.buildings >= 5) return 'This property already has a commercial tower.';
      const s = this.state;
      if (s.phase === 'debt') return 'Raise cash and settle the debt before investing.';
      // Build only on the property you landed on this turn (a doubles stop is only a waypoint), one level per landing.
      if (player.id !== this.active.id || player.position !== id || s.phase !== 'end' || !s.hasRolled || s.extraRoll || player.penalty) return 'Land on ' + space.name + ' to build here.';
      if (asset.builtTurn === s.turn) return 'You built here this turn. Land on ' + space.name + ' again to add another building.';
      if (this.groupOwnedCount(player, space.group, true) < 2) return 'Own at least 2 unmortgaged ' + GROUPS[space.group].name + ' properties before building.';
      // Build evenly: none of your properties in a color may get more than one level ahead of your others there.
      if (this.buildPeers(player, space).some(item => this.asset(item.id).buildings < asset.buildings)) return 'Build evenly. Develop the other ' + GROUPS[space.group].name + ' properties first.';
      if (player.cash < this.buildingCost(player, space)) return 'Not enough cash to build.';
      return '';
    }
    // The player's own unmortgaged properties in the same color; building and selling stay even across them.
    buildPeers(player, space) { return this.groupSpaces(space.group).filter(item => this.asset(item.id).owner === player.id && !this.asset(item.id).mortgaged); }
    sellReason(player, id) {
      const space = BOARD[id], asset = this.asset(id);
      if (asset.buildings <= 0) return 'There are no buildings to sell.';
      if (this.buildPeers(player, space).some(item => this.asset(item.id).buildings > asset.buildings)) return 'Sell evenly. Remove buildings from the more developed ' + GROUPS[space.group].name + ' properties first.';
      return '';
    }
    buildStructure(id) {
      const { space, asset, player } = this.actionOwner(id);
      this.require(!this.buildReason(player, id), this.buildReason(player, id));
      const cost = this.buildingCost(player, space);
      player.cash -= cost; asset.buildings++; asset.builtTurn = this.state.turn; player.stats.buildingsBuilt++;
      this.log(player.name + ' developed ' + space.name + ': ' + levelName(asset.buildings) + ' (' + money(cost) + ').', 'money');
      this.sound('build'); this.emit();
    }
    sellBuilding(id) {
      const { space, asset, player } = this.actionOwner(id);
      this.require(!this.sellReason(player, id), this.sellReason(player, id));
      const amount = Math.floor(this.buildingCost(player, space) / 2);
      asset.buildings--; player.cash += amount;
      this.log(player.name + ' sold one building level on ' + space.name + ' for ' + money(amount) + '.', 'money'); this.emit();
    }
    mortgageReason(player, id) {
      const space = BOARD[id], asset = this.asset(id);
      if (asset.mortgaged) return 'This property is already mortgaged.';
      if (asset.buildings > 0) return 'Sell all buildings on this property first.';
      if (this.groupSpaces(space.group).some(item => this.asset(item.id).owner === player.id && this.asset(item.id).buildings > 0)) return 'Sell all buildings in this district before mortgaging.';
      return '';
    }
    mortgageProperty(id) {
      const { space, asset, player } = this.actionOwner(id);
      this.require(!this.mortgageReason(player, id), this.mortgageReason(player, id));
      asset.mortgaged = true; player.cash += space.mortgageValue;
      this.log(player.name + ' mortgaged ' + space.name + ' for ' + money(space.mortgageValue) + '.', 'money'); this.emit();
    }
    unmortgageProperty(id) {
      const { space, asset, player } = this.actionOwner(id);
      const cost = Math.ceil(space.mortgageValue * 110 / 100);
      this.require(asset.mortgaged && this.state.phase !== 'debt', 'Unmortgaging is unavailable while paying a debt or on an active property.');
      this.require(player.cash >= cost, 'Not enough cash to unmortgage.');
      asset.mortgaged = false; player.cash -= cost;
      this.log(player.name + ' unmortgaged ' + space.name + ' for ' + money(cost) + '.', 'money'); this.emit();
    }
    // Trades: the active player offers properties and/or cash for another player's properties and/or cash.
    // offer = { to, give: { cash, properties: [ids] }, get: { cash, properties: [ids] } }
    tradeReason(fromId, offer) {
      const from = this.player(fromId), to = this.player(offer?.to);
      if (!from || from.bankrupt) return 'Only an active player can propose a trade.';
      if (!to || to.bankrupt || to.id === from.id) return 'Choose another active player to trade with.';
      const sides = [[from, offer.give], [to, offer.get]];
      for (const [owner, side] of sides) {
        if (!side || !Number.isSafeInteger(side.cash) || side.cash < 0 || !Array.isArray(side.properties) || new Set(side.properties).size !== side.properties.length) return 'This trade offer is incomplete.';
        if (side.cash > owner.cash) return owner.name + ' does not have ' + money(side.cash) + ' in cash.';
        for (const id of side.properties) {
          if (!Number.isInteger(id) || !BOARD[id]?.price || this.asset(id).owner !== owner.id) return owner.name + ' does not own every property in this offer.';
          if (this.groupSpaces(BOARD[id].group).some(item => this.asset(item.id).buildings > 0)) return 'Sell every building in ' + GROUPS[BOARD[id].group].name + ' before trading its properties.';
        }
      }
      if (!offer.give.properties.length && !offer.get.properties.length) return 'A trade must include at least one property.';
      return '';
    }
    proposeTrade(offer) {
      const s = this.state, from = this.active;
      this.require(['ready', 'end'].includes(s.phase) && !s.pending && !s.auction && !s.trade, 'You can propose a trade before rolling or after resolving your move.');
      this.require((s.tradesThisTurn || 0) < 3, 'You can propose up to 3 trades per turn.');
      const trade = { from: from.id, to: offer?.to, give: { cash: offer?.give?.cash, properties: offer?.give?.properties }, get: { cash: offer?.get?.cash, properties: offer?.get?.properties } };
      this.require(!this.tradeReason(from.id, trade), this.tradeReason(from.id, trade));
      s.trade = { ...trade, returnPhase: s.phase }; s.phase = 'trade'; s.tradesThisTurn = (s.tradesThisTurn || 0) + 1;
      s.tradeHistory = [...(s.tradeHistory || []), { from: trade.from, to: trade.to, turn: s.turn, properties: [...trade.give.properties, ...trade.get.properties] }].slice(-20);
      this.log(from.name + ' offered ' + this.player(trade.to).name + ' a trade: ' + this.tradeSummary(trade.give) + ' for ' + this.tradeSummary(trade.get) + '.', 'important');
      this.emit();
    }
    tradeSummary(side) {
      const parts = side.properties.map(id => BOARD[id].name);
      if (side.cash) parts.push(money(side.cash));
      return parts.length ? parts.join(' + ') : 'nothing';
    }
    acceptTrade() {
      const s = this.state, trade = s.trade;
      this.require(s.phase === 'trade' && trade, 'There is no trade offer to answer.');
      this.require(!this.tradeReason(trade.from, trade), this.tradeReason(trade.from, trade));
      const from = this.player(trade.from), to = this.player(trade.to);
      from.cash += trade.get.cash - trade.give.cash; to.cash += trade.give.cash - trade.get.cash;
      trade.give.properties.forEach(id => { this.asset(id).owner = to.id; this.asset(id).ready = false; });
      trade.get.properties.forEach(id => { this.asset(id).owner = from.id; this.asset(id).ready = false; });
      this.log(to.name + ' accepted. ' + from.name + ' traded ' + this.tradeSummary(trade.give) + ' for ' + this.tradeSummary(trade.get) + '.', 'money');
      s.phase = trade.returnPhase; s.trade = null; this.sound('purchase'); this.emit();
    }
    rejectTrade(reason = 'declined') {
      const s = this.state, trade = s.trade;
      this.require(s.phase === 'trade' && trade, 'There is no trade offer to answer.');
      this.log(this.player(trade.to).name + ' ' + reason + ' the trade offer from ' + this.player(trade.from).name + '.');
      s.phase = trade.returnPhase; s.trade = null; this.emit();
    }
    finishResolution() {
      const s = this.state;
      if (s.phase === 'victory') return;
      s.phase = 'end'; s.offer = null; s.event = null;
      if (this.checkWinner()) { this.emit(); return; }
      if (this.active.bankrupt) { this.nextTurn(); return; }
      this.emit();
    }
    nextTurn() {
      const s = this.state;
      this.require(s.phase === 'end' && !s.pending && !s.payments.length, 'Roll and resolve every required action before ending your turn.');
      this.require(!s.extraRoll || this.active.bankrupt, 'You rolled doubles. Roll again before ending your turn.');
      if (this.checkWinner()) { this.emit(); return; }
      let index = s.currentPlayer;
      do { index = (index + 1) % s.players.length; } while (s.players[index].bankrupt);
      s.currentPlayer = index; s.turn++; s.phase = 'ready'; s.hasRolled = false; s.extraRoll = false; s.doublesCount = 0; s.tradesThisTurn = 0;
      this.active.stats.turnsPlayed++;
      this.log(this.active.name + ' begins turn ' + s.turn + '.', 'important'); this.emit();
    }
    // A player quits mid-game: their assets return to the bank and play continues.
    forfeit(id) {
      const s = this.state, player = this.player(id);
      this.require(player && !player.bankrupt && s.phase !== 'victory', 'This player is no longer in the game.');
      this.require(!this.busy, 'Wait for the current move to finish.');
      this.require(!s.auction && !s.pending && !s.payments.length, 'Finish the current auction or payment before leaving.');
      if (s.trade) { s.phase = s.trade.returnPhase; s.trade = null; this.log('The open trade offer was withdrawn.'); }
      this.owned(player).forEach(space => { Object.assign(this.asset(space.id), { owner: null, buildings: 0, mortgaged: false }); delete this.asset(space.id).ready; });
      player.cash = 0; player.bankrupt = true; player.penalty = null;
      this.log(player.name + ' left the game. Their properties return to the bank.', 'important');
      if (this.checkWinner()) { this.emit(); return; }
      if (s.currentPlayer === id) { s.phase = 'end'; s.offer = null; s.event = null; s.extraRoll = false; this.nextTurn(); return; }
      this.emit();
    }
    // Turn timer expired: drop any unused roll or open offer and pass the turn.
    timeoutTurn() {
      const s = this.state;
      this.require(['ready', 'end', 'offer'].includes(s.phase) && !s.pending && !s.auction, 'This turn cannot time out now.');
      if (s.phase === 'offer') this.log(this.active.name + ' ran out of time. ' + BOARD[s.offer].name + ' stays with the bank.');
      s.phase = 'end'; s.offer = null; s.extraRoll = false;
      this.log(this.active.name + ' ran out of time. The turn passes.', 'important');
      this.nextTurn();
    }
    checkWinner() {
      if (this.living.length !== 1) return false;
      const s = this.state;
      s.winner = this.living[0].id; s.phase = 'victory'; s.pending = null; s.payments = []; s.continuation = null; s.auction = null; s.event = null; s.offer = null; s.trade = null;
      this.log(this.living[0].name + ' wins MARKET WARS!', 'important'); this.sound('victory'); return true;
    }
    serialize() {
      this.require(!this.busy, 'Wait until the dice and movement finish before saving.');
      this.state.savedAt = Date.now();
      return JSON.stringify(this.state);
    }
    static restore(serialized, options = {}) {
      const s = JSON.parse(serialized);
      if (Array.isArray(s?.players)) s.players = normalizeTokens(s.players);
      if (!s || s.version !== 1 || !Array.isArray(s.players) || validatePlayers(s.players) || !s.properties || !['ready', 'end', 'offer', 'auction', 'trade', 'event', 'debt', 'victory'].includes(s.phase)) throw new Error('This saved game is not compatible. Start a new game.');
      const number = value => Number.isFinite(value) && value >= 0;
      if (s.players.some((p, i) => p.id !== i || !Number.isInteger(p.position) || p.position < 0 || p.position >= BOARD.length || !number(p.cash) || !p.stats || Object.keys(stats()).some(key => !number(p.stats[key])) || typeof p.bankrupt !== 'boolean' || (p.penalty && (!['prison', 'pricewar'].includes(p.penalty.kind) || !Number.isInteger(p.penalty.attempts) || p.penalty.attempts < 0 || p.penalty.attempts > 3)))) throw new Error('The saved player data is damaged.');
      if (BOARD.filter(space => space.price).some(space => {
        const asset = s.properties[space.id];
        return !asset || (asset.owner !== null && !s.players[asset.owner]) || !Number.isInteger(asset.buildings) || asset.buildings < 0 || asset.buildings > 5 || typeof asset.mortgaged !== 'boolean' || (asset.mortgaged && asset.buildings > 0);
      })) throw new Error('The saved property data is damaged.');
      if (!s.players[s.currentPlayer] || !Number.isInteger(s.turn) || s.turn < 1 || !Array.isArray(s.dice) || s.dice.length !== 2 || s.dice.some(value => !Number.isInteger(value) || value < 1 || value > 6) || !Array.isArray(s.log) || !Array.isArray(s.history) || !s.settings || !s.decks || !Array.isArray(s.payments)) throw new Error('The saved turn data is damaged.');
      for (const [name, cards] of Object.entries(DECKS)) {
        const deck = s.decks[name];
        if (!deck || !Array.isArray(deck.order) || deck.order.length !== cards.length || new Set(deck.order).size !== cards.length || deck.order.some(i => !Number.isInteger(i) || i < 0 || i >= cards.length) || !Number.isInteger(deck.cursor) || deck.cursor < 0 || deck.cursor > cards.length) throw new Error('The saved card deck is damaged.');
      }
      if ((s.phase === 'offer' && (!BOARD[s.offer]?.price || s.properties[s.offer].owner !== null)) || (s.phase === 'event' && !DECKS[s.event?.deck]?.[s.event?.index]) || (s.phase === 'auction' && (!s.auction || !BOARD[s.auction.property]?.price || !s.players[s.auction.bidder] || !number(s.auction.bid) || !Array.isArray(s.auction.order) || !Array.isArray(s.auction.passed))) || (s.phase === 'debt' && (!s.pending || !s.players[s.pending.payer] || !number(s.pending.amount) || s.payments.length === 0)) || (s.phase === 'victory' && !s.players[s.winner]) || (s.phase === 'trade' && (!s.trade || !s.players[s.trade.from] || !s.players[s.trade.to] || !['ready', 'end'].includes(s.trade.returnPhase)))) throw new Error('The saved action is damaged.');
      // Games saved before the single rule set may hold a Price War detention; it becomes Prison.
      s.players.forEach(p => { delete p.role; p.color = TOKEN_COLORS[p.token] || p.color; if (p.penalty?.kind === 'pricewar') { p.penalty.kind = 'prison'; p.position = 10; } });
      const game = new Game(s.players, s.settings, options);
      game.state = s;
      game.state.settings = { ...DEFAULT_SETTINGS, ...s.settings };
      return game;
    }
  }

  return { Game, BOARD, GROUPS, DECKS, TOKENS, COLORS, DEFAULT_SETTINGS, SAVE_KEY, SETTINGS_KEY, money, levelName, validatePlayers, normalizeTokens, TOKEN_COLORS, clone };
})();
globalThis.MarketWars = MarketWars;


if (typeof module !== "undefined") module.exports = MarketWars;
