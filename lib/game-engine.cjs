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
    land('Lockside Walk', 'canal', 140, 12), special('Business Tax', 'tax', '%', '$200 OR 10%'),
    land('Ripple Arcade', 'canal', 140, 12), land('Waterwheel Row', 'canal', 160, 14),
    { type: 'transport', name: 'Northline Rail', group: 'transport', price: 180, baseRent: 20 },
    land('Clover Commons', 'garden', 160, 14), special('Prison', 'prison', '▥', 'LAND = LOCKED UP'),
    land('Fern Promenade', 'garden', 180, 16), special('Economic Event', 'economic', '⌁', 'DRAW A CARD'),
    land('Orchard Terrace', 'garden', 180, 16), land('Mosaic Works', 'studio', 200, 18),
    { type: 'utility', name: 'Solar Cooperative', group: 'utility', price: 150, baseRent: 4 },
    land('Foundry Studios', 'studio', 220, 20), special('Market Event', 'market', '↗', 'DRAW A CARD'),
    land('Atelier Square', 'studio', 220, 20), land('Exchange Walk', 'metro', 240, 22),
    special('Free Market', 'free', '◎', 'JACKPOT POT'), land('Meridian Plaza', 'metro', 240, 22),
    land('Civic Boulevard', 'metro', 260, 24),
    { type: 'transport', name: 'Skyway Terminal', group: 'transport', price: 200, baseRent: 20 },
    land('Binary Gardens', 'tech', 280, 26), special('Wealth Tax', 'wealth', '%', 'BY ASSETS'),
    land('Photon Avenue', 'tech', 300, 28), land('Venture Campus', 'tech', 300, 28),
    special('Economic Event', 'economic', '⌁', 'DRAW A CARD'),
    { type: 'utility', name: 'Reservoir Network', group: 'utility', price: 180, baseRent: 4 },
    special('Wheel of Fortune', 'wheel', '◎', 'SPIN TO WIN'), land('Cloudcrest Drive', 'ridge', 320, 30),
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
  // Card rarity: common 70% / uncommon 25% / rare 5% of draws. Amounts marked {a}/{b} are scaled by the game stage.
  // Per-property and per-building formulas are not scaled (they already grow with holdings). The first 15 cards of each deck
  // keep their original positions so a game saved mid-card still resolves the same card.
  const card = (title, text, effect, extra = {}, rarity = 'common') => ({ title, text, effect, rarity, ...extra });
  const MARKET_CARDS = [
    card('A strong opening', 'Your first product launch sells out. Receive {a}.', 'cash', { amount: 150 }),
    card('Unexpected upkeep', 'A burst pipe interrupts business. Pay {a} for repairs.', 'pay', { amount: 80 }),
    card('Quarterly momentum', 'A reliable quarter earns a performance bonus. Receive {a}.', 'cash', { amount: 200 }, 'uncommon'),
    card('Licensing deal', 'Another business licenses your original design. Receive {a}.', 'cash', { amount: 100 }),
    card('Delayed shipment', 'You cover expedited delivery for a missed shipment. Pay {a}.', 'pay', { amount: 60 }),
    card('Fresh start', 'A new venture takes you to Launch. Collect $200.', 'advance', { destination: 0 }, 'uncommon'),
    card('Transit partnership', 'Visit the next transit station. Collect Launch income if you pass it; resolve the station normally.', 'nearest', { target: 'transport' }),
    card('District renewal', 'Maintain your portfolio: pay $20 per house and $80 per tower.', 'repairs', {}, 'uncommon'),
    card('Customer loyalty', 'Your regular customers bring new business. Receive {a}.', 'cash', { amount: 90 }),
    card('Market investigation', 'Your business faces a review. Go directly to Prison. Do not pass Launch; do not collect $200.', 'penalty', {}, 'uncommon'),
    card('Independent spirit', 'Your side project pays off. Receive {a}.', 'cash', { amount: 100 }),
    card('Inventory surplus', 'Sell excess inventory at a neighborhood fair. Receive {a}.', 'cash', { amount: 70 }),
    card('Brand refresh', 'Commission a new identity for your business. Pay {a}.', 'pay', { amount: 90 }),
    card('Community dividend', 'A shared campaign succeeds. Every active player receives {a}.', 'allcash', { amount: 40 }),
    card('Open doors', 'Visit Free Market. Collect Launch income if you pass it, and the jackpot if you land there.', 'advance', { destination: 20 }),
    card('Street fair profits', 'Your stall does brisk trade at the street fair. Receive {a}.', 'cash', { amount: 60 }),
    card('Flash sale', 'A one-day sale clears your shelves. Receive {a}.', 'cash', { amount: 80 }),
    card('Pop-up success', 'Your pop-up shop becomes the talk of the district. Receive {a}.', 'cash', { amount: 120 }),
    card('Referral bonus', 'A partner pays you for sending new customers. Receive {a}.', 'cash', { amount: 110 }),
    card('Trade show triumph', 'Buyers queue at your trade show booth. Receive {a}.', 'cash', { amount: 130 }, 'uncommon'),
    card('Seasonal rush', 'The holiday season is your busiest ever. Receive {a}.', 'cash', { amount: 180 }, 'uncommon'),
    card('Parking fine', 'Your delivery van blocks a lane. Pay {a}.', 'pay', { amount: 40 }),
    card('Supply shortage', 'Rush orders cost extra. Pay {a}.', 'pay', { amount: 70 }),
    card('Marketing misstep', 'A flop of a campaign has to be pulled. Pay {a}.', 'pay', { amount: 100 }),
    card('Equipment breakdown', 'Your main machine fails mid-season. Pay {a}.', 'pay', { amount: 120 }, 'uncommon'),
    card('Lawsuit settlement', 'You settle a dispute out of court. Pay {a}.', 'pay', { amount: 150 }, 'uncommon'),
    card('Lucky customer', 'A big spender walks into your shop.', 'rollcash', { amount: 30 }),
    card('Holiday rush', 'Crowds pour in for the holidays.', 'rollcash', { amount: 40 }),
    card('Audit surprise', 'An unexpected audit finds paperwork errors.', 'rollpay', { amount: 20 }),
    card('Storm damage', 'A storm floods your storeroom.', 'rollpay', { amount: 30 }),
    card('Big contract', 'A city contract lands on your desk.', 'rollcash', { amount: 50 }, 'uncommon'),
    card('Double or nothing', 'You back a friend with a bold idea.', 'gamble', { amount: 250, amount2: 100 }),
    card('Risky launch', 'Your new product line is a coin flip.', 'gamble', { amount: 300, amount2: 150, loseMax: 3, winMin: 4 }, 'uncommon'),
    card('Small bet', 'A modest stake on a hot tip.', 'gamble', { amount: 150, amount2: 50 }),
    card('High stakes', 'You put big money on a risky merger.', 'gamble', { amount: 400, amount2: 200, loseMax: 3, winMin: 5 }, 'uncommon'),
    card('Neighbourhood grant', 'The council funds a street makeover. Every active player receives {a}.', 'allcash', { amount: 60 }, 'uncommon'),
    card('City-wide sale', 'A price war cuts into every margin. Every active player pays {a}.', 'allpay', { amount: 40 }),
    card('Citywide slump', 'Sales sag across the city. Every active player pays {a}.', 'allpay', { amount: 70 }, 'uncommon'),
    card('Detour to City Bank', 'Your accountant sends you to the bank. Visit City Bank; collect Launch income if you pass it.', 'advance', { destination: 33 }),
    card('Skyway shortcut', 'A private jet takes you to Skyway Terminal. Collect Launch income if you pass it.', 'advance', { destination: 22 }),
    card('Northline express', 'The express line takes you to Northline Rail. Collect Launch income if you pass it.', 'advance', { destination: 8 }),
    card('Straight to the wheel', 'You are invited to the Wheel of Fortune. Move there and spin. Collect Launch income if you pass it.', 'advance', { destination: 30 }, 'uncommon'),
    card('Utility boom', 'Demand for city services soars. Receive $50, plus $40 for each utility you own.', 'utilitycash'),
    card('Builders bonus', 'The city rewards what you have built. Receive $20 for each building level you own (a tower counts as 5).', 'buildingcash', { per: 20 }, 'uncommon'),
    card('Underdog grant', 'The city backs the smallest business. If you have the least net worth, receive {a}; otherwise receive {b}.', 'catchup', { amount: 250, amount2: 40 }, 'uncommon'),
    card('City levy', 'The richest player in the city pays {a} into the Free Market jackpot.', 'levy', { amount: 150 }, 'uncommon'),
    card('Compliance sweep', 'Inspectors find irregularities in your books. Go directly to Prison. Do not pass Launch; do not collect $200.', 'penalty'),
    card('Get out of Prison free', 'Keep this card. It is used automatically the next time you would go to Prison.', 'jailfree', {}, 'rare'),
    card('Jackpot contract', 'The deal of the decade comes through. Receive {a}.', 'cash', { amount: 500 }, 'rare'),
    card('Market disaster', 'A supplier collapses and takes your cash with it. Pay {a}.', 'pay', { amount: 400 }, 'rare'),
    card('Rent Shield', 'Friends in high places grant you immunity. You pay no rent on your next 2 landings on other players’ properties (stations and utilities count too).', 'shield', { charges: 2 }, 'rare'),
    card('Rent Doubler', 'Demand for your properties spikes. Your next 2 rent collections from other players are doubled, up to $400 each. A rent already above $400 is never reduced.', 'doubler', { charges: 2 }, 'rare')
  ];
  const ECONOMIC_CARDS = [
    card('Fair trading review', 'Pay {a} in oversight fees.', 'pay', { amount: 50 }),
    card('Small business fund', 'The enterprise fund backs your business. Receive {a}.', 'cash', { amount: 100 }),
    card('Cooling economy', 'Every active player pays {a} to stabilize the market.', 'allpay', { amount: 50 }),
    card('Expansion grant', 'Your business plan earns a city grant. Receive {a}.', 'cash', { amount: 120 }),
    card('Clean energy rebate', 'Receive $50, plus $40 for each utility you own.', 'utilitycash', {}, 'uncommon'),
    card('New compliance rules', 'A regulatory hearing pauses your operation. Go directly to Prison.', 'penalty', {}, 'uncommon'),
    card('Bank settlement', 'Visit City Bank to collect $50 interest. Collect Launch income if you pass it.', 'advance', { destination: 33 }),
    card('Infrastructure levy', 'Contribute {a} to the city’s public works budget.', 'pay', { amount: 70 }),
    card('Export opportunity', 'A new regional agreement opens a customer market. Receive {a}.', 'cash', { amount: 160 }, 'uncommon'),
    card('Hiring incentive', 'A city jobs programme rewards your hiring. Receive {a}.', 'cash', { amount: 90 }),
    card('Insurance adjustment', 'Your insurer refunds an overpayment. Receive {a}.', 'cash', { amount: 60 }),
    card('Building inspection', 'Pay $15 per house and $60 per tower for safety inspections.', 'repairs', { house: 15, tower: 60 }, 'uncommon'),
    card('Regional recovery', 'Every active player receives a {a} recovery dividend.', 'allcash', { amount: 75 }, 'uncommon'),
    card('Business filing', 'Renew your business registration. Pay {a}.', 'pay', { amount: 40 }),
    card('Portfolio dividend', 'Receive $25 for every active, unmortgaged property you own.', 'portfoliocash', { per: 25 }, 'uncommon'),
    card('Tax rebate', 'A filing error works in your favour. Receive {a}.', 'cash', { amount: 70 }),
    card('City subsidy', 'A subsidy lands in your account. Receive {a}.', 'cash', { amount: 110 }),
    card('Innovation prize', 'Your prototype wins a city award. Receive {a}.', 'cash', { amount: 140 }),
    card('Dividend payout', 'Your shares pay a handsome dividend. Receive {a}.', 'cash', { amount: 170 }, 'uncommon'),
    card('Stock surge', 'A holding surges overnight. Receive {a}.', 'cash', { amount: 200 }, 'uncommon'),
    card('Grant renewal', 'An old grant is renewed. Receive {a}.', 'cash', { amount: 80 }),
    card('Late fee', 'A bill slipped through the cracks. Pay {a}.', 'pay', { amount: 30 }),
    card('Compliance cost', 'New standards need new paperwork. Pay {a}.', 'pay', { amount: 60 }),
    card('Software licence', 'Your systems need an upgrade. Pay {a}.', 'pay', { amount: 90 }),
    card('Import duties', 'A shipment is held at customs. Pay {a}.', 'pay', { amount: 110 }, 'uncommon'),
    card('Cyber incident', 'A breach forces a costly clean-up. Pay {a}.', 'pay', { amount: 140 }, 'uncommon'),
    card('Consulting windfall', 'A client pays you for advice.', 'rollcash', { amount: 35 }),
    card('Seasonal contract', 'A supplier signs a seasonal deal.', 'rollcash', { amount: 45 }),
    card('Currency swing', 'Exchange rates turn against you.', 'rollpay', { amount: 25 }),
    card('Equipment recall', 'A faulty batch must be replaced.', 'rollpay', { amount: 35 }),
    card('Export boom', 'Overseas orders pour in.', 'rollcash', { amount: 55 }, 'uncommon'),
    card('Commodity bet', 'You take a position on raw materials.', 'gamble', { amount: 220, amount2: 90 }),
    card('Startup stake', 'You buy into a risky young company.', 'gamble', { amount: 350, amount2: 150, loseMax: 3, winMin: 4 }, 'uncommon'),
    card('Small flutter', 'A small wager on the city index.', 'gamble', { amount: 130, amount2: 40 }),
    card('Futures gamble', 'You trade futures on a hunch.', 'gamble', { amount: 450, amount2: 220, loseMax: 3, winMin: 5 }, 'uncommon'),
    card('Growth bonus', 'The whole city grows. Every active player receives {a}.', 'allcash', { amount: 50 }),
    card('Market correction', 'Prices reset across the city. Every active player pays {a}.', 'allpay', { amount: 60 }, 'uncommon'),
    card('Stimulus package', 'The council injects cash into every business. Every active player receives {a}.', 'allcash', { amount: 90 }, 'uncommon'),
    card('Fast track to Launch', 'A permit fast-tracks you to Launch. Collect $200.', 'advance', { destination: 0 }),
    card('Nearest utility', 'A service call takes you to the next utility. Collect Launch income if you pass it; resolve the space normally.', 'nearest', { target: 'utility' }),
    card('Visit the wheel', 'A friend dares you to spin. Move to the Wheel of Fortune. Collect Launch income if you pass it.', 'advance', { destination: 30 }, 'uncommon'),
    card('Free Market trip', 'A buyers fair draws you to Free Market. Collect Launch income if you pass it, and the jackpot if you land there.', 'advance', { destination: 20 }),
    card('Housing grant', 'The city pays for buildings. Receive $25 for each building level you own (a tower counts as 5).', 'buildingcash', { per: 25 }),
    card('Rental income', 'Tenants pay up. Receive $30 for every active, unmortgaged property you own.', 'portfoliocash', { per: 30 }, 'uncommon'),
    card('Fair-share fund', 'The city backs the smallest business. If you have the least net worth, receive {a}; otherwise receive {b}.', 'catchup', { amount: 250, amount2: 40 }, 'uncommon'),
    card('Tax the wealthy', 'The richest player in the city pays {a} into the Free Market jackpot.', 'levy', { amount: 150 }, 'uncommon'),
    card('Inspectors raid', 'A surprise raid finds problems. Go directly to Prison. Do not pass Launch; do not collect $200.', 'penalty'),
    card('Get out of Prison free', 'Keep this card. It is used automatically the next time you would go to Prison.', 'jailfree', {}, 'rare'),
    card('Windfall', 'A forgotten investment pays out hugely. Receive {a}.', 'cash', { amount: 500 }, 'rare'),
    card('Market crash', 'Your portfolio loses value overnight. Pay {a}.', 'pay', { amount: 350 }, 'rare'),
    card('Rent Reversal', 'A loophole flips the lease. On your next 3 landings on other players’ properties, the owner pays YOU the rent instead.', 'reversal', { charges: 3 }, 'rare'),
    card('Roll Again', 'A lucky break. Roll the dice again straight away.', 'rollagain', {}, 'rare')
  ];
  const DECKS = { market: MARKET_CARDS, economic: ECONOMIC_CARDS };
  // Timed power-ups: each holds a number of uses. Shield, Doubler and Reversal come from cards or the wheel; Launch Boost and Tailwind from the wheel.
  const PERK_NAMES = { launch: 'Launch Boost', tailwind: 'Tailwind', reversal: 'Rent Reversal', shield: 'Rent Shield', doubler: 'Rent Doubler' };
  const PERK_CHARGES = { launch: 2, tailwind: 2, shield: 2, doubler: 2, reversal: 3 };
  const POWER_UPS = ['launch', 'tailwind', 'shield', 'doubler', 'reversal'];
  const emptyPerks = () => ({ launch: 0, tailwind: 0, shield: 0, doubler: 0, reversal: 0 });
  const LAUNCH_BOOST = 150;           // paid on top of the normal Launch money
  const FIRE_SALE_CASH = 200;         // below this much cash, a mortgage pays 25% more
  const FIRE_SALE_BONUS = .25;
  const DOUBLER_CAP = 400;           // a doubled rent never goes above $400 (a rent already above it is left alone)
  const RARITY_WEIGHTS = { common: .70, uncommon: .25, rare: .05 };
  const RECENT_LIMIT = 12;            // a card cannot repeat within this many draws of its deck
  const SCALED_EFFECTS = new Set(['cash', 'pay', 'allcash', 'allpay', 'rollcash', 'rollpay', 'gamble', 'catchup', 'levy']);
  // Stations: rent with one or both owned. Utilities: dice total × this, with one or both owned. Both are then × the game stage.
  const SERVICE_RENT = { transport: [50, 150], utility: [6, 15] };
  const JACKPOT_BASE = 100;           // the Free Market pot never drops below this
  const POT_SHARE = 0.5;              // share of each tax, fine and card payment that goes into the pot; the rest leaves the economy
  const CITY_EVERY = 5;               // a City Event every 5 rounds, announced one round ahead
  const CITY_EVENTS = {
    boom: { name: 'Property Boom', text: 'Every rent in the game is 50% higher for the next 2 rounds.', short: 'rents +50%' },
    recession: { name: 'Recession', text: 'Building costs are 30% lower and every rent is 25% lower for the next 2 rounds.', short: 'rents −25%, building −30%' },
    audit: { name: 'Tax Audit', text: 'The richest player pays $100 to the poorest player.', short: 'richest pays poorest $100' }
  };
  const AUDIT_AMOUNT = 100;
  // Wheel of Fortune: 8 equal-sized slices, spun by the server with these weights. Common slices are the most likely, rare the least.
  // The weights keep the average spin within about $15 of zero at every game stage (see the wheel test), so nobody snowballs.
  // Cash amounts scale with the game stage; the free house and the power-up do not.
  const WHEEL = [
    { id: 'jackpot', kind: 'cash', amount: 400, label: 'Jackpot', tier: 'rare', weight: 3 },
    { id: 'bad', kind: 'pay', amount: 150, label: 'Bad spin', tier: 'common', weight: 34 },
    { id: 'good', kind: 'cash', amount: 200, label: 'Good spin', tier: 'common', weight: 14 },
    { id: 'house', kind: 'build', label: 'Free house', tier: 'uncommon', weight: 8 },
    { id: 'small', kind: 'cash', amount: 100, label: 'Small win', tier: 'common', weight: 20 },
    { id: 'taxman', kind: 'pay', amount: 250, label: 'Taxman', tier: 'rare', weight: 7 },
    { id: 'power', kind: 'power', label: 'Power-up', tier: 'uncommon', weight: 8 },
    { id: 'free', kind: 'free', label: 'Free spin', tier: 'uncommon', weight: 13 }
  ];
  const WHEEL_MAX_FREE = 3;           // at most 3 free spins in a row; the next result is then forced non-free
  const DEFAULT_SETTINGS = { sound: true, animationSpeed: 1, movementSpeed: 1, autoSave: true, hints: true, boardZoom: false };
  const stats = () => ({ propertiesPurchased: 0, rentEarned: 0, rentPaid: 0, buildingsBuilt: 0, taxesPaid: 0, startBonuses: 0, auctionWins: 0, cardsDrawn: 0, turnsPlayed: 0, bonusIncome: 0 });
  const money = amount => '$' + Math.round(amount).toLocaleString('en-US');
  const levelName = level => level === 5 ? 'Commercial tower' : level === 0 ? 'Undeveloped' : level + (level === 1 ? ' house' : ' houses');
  const clone = value => JSON.parse(JSON.stringify(value));
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
        version: 1, players: players.map((player, id) => ({ id, name: player.name.trim(), token: player.token, color: TOKEN_COLORS[player.token], type: 'human', cash: START_CASH, position: 0, bankrupt: false, penalty: null, jailFree: 0, perks: emptyPerks(), stats: stats() })),
        properties: Object.fromEntries(BOARD.filter(space => space.price).map(space => [space.id, { owner: null, buildings: 0, mortgaged: false }])),
        currentPlayer: 0, turn: 1, phase: 'ready', dice: [1, 1], hasRolled: false, doublesCount: 0, extraRoll: false,
        offer: null, auction: null, trade: null, tradesThisTurn: 0, tradeHistory: [], event: null, pending: null, payments: [], continuation: null,
        round: 1, jackpot: JACKPOT_BASE, city: { upcoming: null, active: null, last: null }, lastWheel: null, lastDie: null, droppedDie: null, wheelFree: 0,
        decks: Object.fromEntries(Object.keys(DECKS).map(name => [name, { recent: [] }])),
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
    // The player owns every property of the color (mortgaged ones still count as owned).
    ownsFullSet(player, group) { return this.groupOwnedCount(player, group) === this.groupSpaces(group).length; }
    groupOwnedCount(player, group, activeOnly = false) { return this.groupSpaces(group).filter(space => this.asset(space.id).owner === player.id && !(activeOnly && this.asset(space.id).mortgaged)).length; }
    // Every player pays the printed district price per building and the listed price for land.
    buildingCost(player, space) { return this.state.city?.active?.kind === 'recession' ? Math.round(space.buildingCost * .7) : space.buildingCost; }
    // Game stage: card and wheel cash grows as the game goes on (x1, x2 after round 15, x3 after round 30).
    stage() { const round = this.state.round || 1; return round > 30 ? 3 : round > 15 ? 2 : 1; }
    purchasePrice(player, space) { return space.price; }
    finances(player) {
      const assets = this.owned(player);
      const propertyValue = assets.reduce((sum, space) => sum + space.price, 0);
      const buildingValue = assets.reduce((sum, space) => sum + this.asset(space.id).buildings * space.buildingCost, 0);
      const mortgageDebt = assets.reduce((sum, space) => sum + (this.asset(space.id).mortgaged ? this.unmortgageCost(space.id) : 0), 0);
      const buildings = assets.reduce((sum, space) => sum + this.asset(space.id).buildings, 0);
      const netWorth = player.cash + propertyValue + buildingValue;
      return { propertyValue, buildingValue, mortgageDebt, buildings, netWorth, properties: assets.length, score: netWorth + player.stats.bonusIncome };
    }
    calculateRent(id, diceTotal = this.state.dice[0] + this.state.dice[1], ownerOverride = null, levelOverride = null) {
      // The City Event multiplier comes first; Doubler, its cap, and Reversal or Shield are applied afterwards (collectRent).
      const rent = this.baseRent(id, diceTotal, ownerOverride, levelOverride), kind = this.state.city?.active?.kind;
      if (!rent) return 0;
      return kind === 'boom' ? Math.ceil(rent * 1.5) : kind === 'recession' ? Math.max(1, Math.round(rent * .75)) : rent;
    }
    baseRent(id, diceTotal, ownerOverride, levelOverride) {
      const space = BOARD[id], asset = this.asset(id);
      if (!space?.price || !asset) return 0;
      const owner = ownerOverride || this.player(asset.owner);
      if (!owner || (!ownerOverride && (asset.mortgaged || owner.bankrupt))) return 0;
      const count = this.owned(owner).filter(item => item.group === space.group && !this.asset(item.id).mortgaged).length || 1;
      // Stations and utilities can never be built on, so their rent grows with the game stage instead.
      if (space.type === 'transport') return SERVICE_RENT.transport[Math.min(count, 2) - 1] * this.stage();
      if (space.type === 'utility') return diceTotal * SERVICE_RENT.utility[Math.min(count, 2) - 1] * this.stage();
      const level = levelOverride ?? asset.buildings;
      // Owning every property of the color doubles each built rent there, from 1 house up to the tower.
      if (level > 0) return (level === 5 ? space.apartmentRent : space.houseRents[level - 1]) * (this.ownsFullSet(owner, space.group) ? 2 : 1);
      // Owning at least 2 properties of the color (or the full set) doubles rent on undeveloped land; the two do not stack.
      return this.groupOwnedCount(owner, space.group) >= 2 ? space.baseRent * 2 : space.baseRent;
    }
    // Cash raised by selling every building and mortgaging every property, mortgaging the biggest first so the Fire Sale bonus counts
    // only while the player is still below $200.
    liquidatable(player) {
      let cash = player.cash;
      for (const space of this.owned(player)) cash += this.asset(space.id).buildings * Math.floor(this.buildingCost(player, space) / 2);
      for (const space of this.owned(player).filter(item => !this.asset(item.id).mortgaged).sort((a, b) => b.mortgageValue - a.mortgageValue)) cash += this.mortgageProceeds({ cash }, space);
      return cash;
    }
    // Fire Sale: with less than $200 in cash, a mortgage pays 25% more. The amount received is kept on the asset so unmortgaging costs 110% of it.
    mortgageProceeds(player, space) { return player.cash < FIRE_SALE_CASH ? space.mortgageValue + Math.floor(space.mortgageValue * FIRE_SALE_BONUS) : space.mortgageValue; }
    unmortgageCost(id) { return Math.ceil((this.asset(id).mortgageReceived ?? BOARD[id].mortgageValue) * 110 / 100); }
    // `tone` tells the UI whether the news is good or bad for the player it is about (`player`):
    // gain, loss, power (a power-up), prison, deal (a purchase, build or trade) or city. Plain entries have none.
    log(message, kind = 'normal', tone, player) {
      const entry = { message, kind, turn: this.state.turn, id: (this.state.log.at(-1)?.id || 0) + 1 };
      if (tone) entry.tone = tone;
      if (Number.isInteger(player)) entry.player = player;
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
      this.log(player.name + ' received ' + money(amount) + ': ' + reason + '.', 'money', 'gain', player.id);
      this.sound('income');
    }
    async rollDice() {
      this.require(this.canRoll(), 'Resolve the current action before rolling.');
      const s = this.state, player = this.active;
      s.phase = 'rolling'; s.extraRoll = false; s.hasRolled = true;
      // Tailwind: the server rolls three dice and keeps the best two. Only the kept two are stored and shown; doubles use them.
      let dropped = null; s.droppedDie = null;
      if (player.perks.tailwind > 0) {
        const rolled = [this.rollDie(), this.rollDie(), this.rollDie()].sort((a, b) => b - a);
        s.dice = [rolled[0], rolled[1]]; dropped = s.droppedDie = rolled[2];
      } else s.dice = [this.rollDie(), this.rollDie()];
      this.sound('dice'); this.emit();
      await this.wait(650 / s.settings.animationSpeed);
      if (dropped !== null) { this.log('Tailwind: ' + player.name + ' rolled three dice and drops the lowest (' + dropped + ').', 'important'); this.usePerk(player, 'tailwind'); }
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
          // Launch Boost pays $150 on top of the normal $200 (never instead of it).
          const boost = player.perks.launch > 0 ? LAUNCH_BOOST : 0, total = START_BONUS + boost;
          player.cash += total; player.stats.startBonuses++; player.stats.bonusIncome += total;
          this.log(player.name + ' passed Launch and received ' + money(START_BONUS) + (boost ? ' plus ' + money(boost) + ' from Launch Boost' : '') + '.', 'money', 'gain', player.id); this.sound('income');
          if (boost) this.usePerk(player, 'launch');
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
          if (rent > 0) { this.collectRent(player, owner, rent, space); return; }
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
        case 'tax': {
          // Pay $200 (more in later game stages), or 10% of your cash if that is less.
          const cap = 200 * this.stage(), amount = Math.min(cap, Math.round(player.cash * .10));
          this.log('Business Tax: the lesser of ' + money(cap) + ' and 10% of ' + money(player.cash) + ' is ' + money(amount) + '.');
          this.beginPayments([{ payer: player.id, creditor: null, amount, reason: space.name, category: 'tax' }]); return;
        }
        case 'wealth': {
          const assets = this.owned(player), levels = assets.reduce((sum, item) => sum + this.asset(item.id).buildings, 0);
          const k = this.stage(), amount = (assets.length * 15 + levels * 25) * k;
          this.log('Wealth Tax: ' + money(15 * k) + ' for each of ' + assets.length + ' properties and ' + money(25 * k) + ' for each of ' + levels + ' building levels is ' + money(amount) + '.');
          this.beginPayments([{ payer: player.id, creditor: null, amount, reason: space.name, category: 'tax' }]); return;
        }
        case 'free': {
          const pot = s.jackpot ?? JACKPOT_BASE; s.jackpot = JACKPOT_BASE;
          this.credit(player, pot, 'Free Market jackpot'); break;
        }
        case 'bank': this.credit(player, 50, 'City Bank interest'); break;
        case 'wheel': s.wheelFree = 0; s.phase = 'wheel'; this.log(player.name + ' steps onto the Wheel of Fortune.', 'important'); this.emit(); return;
        case 'auction': {
          const available = BOARD.filter(item => item.price && this.asset(item.id).owner === null);
          if (available.length) {
            s.offer = available[Math.floor(this.random() * available.length)].id; s.phase = 'offer';
            this.log('The market offers ' + BOARD[s.offer].name + ' for purchase.'); this.emit(); return;
          }
          this.credit(player, 40, 'all city assets are allocated; auction dividend'); break;
        }
        case 'prison': this.sendPlayerToPenalty(player); break;
        case 'start': this.log('A new circuit of the city begins.'); break;
      }
      this.finishResolution();
    }
    // Rent owed when `visitor` lands on `owner`'s property. Power-card effects apply only when rent is really due, in this order:
    // Rent Reversal (the owner pays the visitor), else Rent Shield (no rent), then Rent Doubler for whoever receives rent.
    usePerk(player, key) {
      player.perks[key]--;
      this.log(player.name + '’s ' + PERK_NAMES[key] + (player.perks[key] ? ': ' + player.perks[key] + ' use' + (player.perks[key] === 1 ? '' : 's') + ' left.' : ' has run out.'), 'important', player.perks[key] ? 'power' : undefined, player.id);
    }
    grantPerk(player, key, charges = PERK_CHARGES[key]) {
      player.perks[key] += charges;
      this.log(player.name + ' gains ' + PERK_NAMES[key] + ' for ' + charges + ' uses (' + player.perks[key] + ' in total).', 'important', 'power', player.id);
    }
    // Rolls a card's single die on the server and records it, so every screen plays the same throw before showing the result.
    cardDie(player, card, describe) {
      const s = this.state, value = this.rollDie(), outcome = describe(value);
      s.lastDie = { id: (s.lastDie?.id || 0) + 1, player: player.id, value, title: card.title, ...outcome };
      this.log('Card die for “' + card.title + '”: ' + player.name + ' rolled a ' + value + (outcome.detail.startsWith('Rolled') ? '' : ', so ' + outcome.detail + ' = ' + outcome.result.slice(1)) + '.', 'important');
      return value;
    }
    collectRent(visitor, owner, rent, space) {
      const use = (player, key) => this.usePerk(player, key);
      let payer = visitor, payee = owner, amount = rent;
      if (visitor.perks.reversal > 0) {
        use(visitor, 'reversal'); payer = owner; payee = visitor;
        this.log('Rent Reversal: ' + owner.name + ' pays ' + visitor.name + ' the rent for ' + space.name + ' instead.', 'important', 'power', visitor.id);
      } else if (visitor.perks.shield > 0) {
        this.log('Rent Shield: ' + visitor.name + ' pays no rent on ' + space.name + '.', 'important', 'power', visitor.id); use(visitor, 'shield');
        this.finishResolution(); return;
      }
      if (payee.perks.doubler > 0) {
        amount = Math.min(2 * rent, Math.max(rent, DOUBLER_CAP));
        this.log('Rent Doubler: ' + payee.name + ' collects ' + money(amount) + (amount > rent ? ' instead of ' + money(rent) : ' (already above the cap, so unchanged)') + '.', 'important', 'power', payee.id); use(payee, 'doubler');
      }
      this.beginPayments([{ payer: payer.id, creditor: payee.id, amount, reason: space.name + ' rent', category: 'rent' }]);
    }
    purchaseProperty() {
      const s = this.state, player = this.active, id = s.offer, space = BOARD[id];
      this.require(s.phase === 'offer' && space?.price && this.asset(id).owner === null, 'This property is no longer available.');
      const price = this.purchasePrice(player, space);
      this.require(player.cash >= price, 'You do not have enough cash.');
      player.cash -= price; this.asset(id).owner = player.id; this.asset(id).ready = false; player.stats.propertiesPurchased++;
      this.log(player.name + ' purchased ' + space.name + ' for ' + money(price) + '.', 'money', 'deal', player.id);
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
          this.log(winner.name + ' won ' + BOARD[auction.property].name + ' for ' + money(auction.bid) + '.', 'money', 'deal', winner.id); this.sound('purchase');
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
    // Weighted draw by rarity (common 70%, uncommon 25%, rare 5%), never repeating a card drawn in the last 12 draws of this deck.
    drawCard(deckName) {
      const s = this.state, cards = DECKS[deckName], deck = s.decks[deckName] ||= { recent: [] };
      const recent = deck.recent || [];
      const open = cards.map((_, i) => i).filter(i => !recent.includes(i));
      const tiers = Object.keys(RARITY_WEIGHTS).filter(tier => open.some(i => cards[i].rarity === tier));
      let roll = this.random() * tiers.reduce((sum, tier) => sum + RARITY_WEIGHTS[tier], 0), tier = tiers.at(-1);
      for (const candidate of tiers) { roll -= RARITY_WEIGHTS[candidate]; if (roll < 0) { tier = candidate; break; } }
      const pool = open.filter(i => cards[i].rarity === tier), index = pool[Math.min(pool.length - 1, Math.floor(this.random() * pool.length))];
      deck.recent = [...recent, index].slice(-RECENT_LIMIT);
      s.event = { deck: deckName, index }; s.phase = 'event'; this.active.stats.cardsDrawn++;
      this.log(this.active.name + ' drew “' + cards[index].title + '”.'); this.sound('event'); this.emit();
    }
    // The two display amounts of a card ({a} and {b}), scaled by the game stage for cash effects.
    cardAmounts(card) { const k = SCALED_EFFECTS.has(card.effect) ? this.stage() : 1; return [(card.amount || 0) * k, (card.amount2 || 0) * k]; }
    describeCard(card) {
      const [a, b] = this.cardAmounts(card), say = (text) => text.split('{a}').join(money(a)).split('{b}').join(money(b));
      let text = say(card.text);
      if (card.effect === 'rollcash') text += ' Roll one die: receive ' + money(a) + ' × the number rolled.';
      if (card.effect === 'rollpay') text += ' Roll one die: pay ' + money(a) + ' × the number rolled.';
      if (card.effect === 'gamble') {
        const lose = card.loseMax || 2, win = card.winMin || 5, range = (from, to) => from === to ? String(from) : from + '–' + to;
        text += ' Roll one die: ' + range(1, lose) + ' pay ' + money(b) + (win - lose > 1 ? ', ' + range(lose + 1, win - 1) + ' nothing' : '') + ', ' + range(win, 6) + ' win ' + money(a) + '.';
      }
      return text;
    }
    async applyCard() {
      const s = this.state;
      this.require(s.phase === 'event' && s.event, 'There is no event to resolve.');
      const card = DECKS[s.event.deck][s.event.index], player = this.active, [a, b] = this.cardAmounts(card);
      s.event = null;
      const payment = (payer, amount) => ({ payer: payer.id, creditor: null, amount, reason: card.title, category: 'fee' });
      const netWorths = this.living.map(item => ({ item, worth: this.finances(item).netWorth }));
      switch (card.effect) {
        case 'cash': this.credit(player, a, card.title); break;
        case 'pay': this.beginPayments([payment(player, a)]); return;
        case 'rollcash': { const die = this.cardDie(player, card, value => ({ tone: 'gain', result: '+' + money(value * a), detail: value + ' × ' + money(a) })); this.credit(player, die * a, card.title); break; }
        case 'rollpay': { const die = this.cardDie(player, card, value => ({ tone: 'loss', result: '−' + money(value * a), detail: value + ' × ' + money(a) })); this.beginPayments([payment(player, die * a)]); return; }
        case 'gamble': {
          const lose = card.loseMax || 2, win = card.winMin || 5;
          const die = this.cardDie(player, card, value => value <= lose ? { tone: 'loss', result: '−' + money(b), detail: 'Rolled ' + value + ': you lose' }
            : value >= win ? { tone: 'gain', result: '+' + money(a), detail: 'Rolled ' + value + ': you win' } : { tone: 'neutral', result: 'No change', detail: 'Rolled ' + value + ': nothing happens' });
          if (die <= lose) { this.beginPayments([payment(player, b)]); return; }
          if (die >= win) this.credit(player, a, card.title); else this.log('Nothing is won or lost.');
          break;
        }
        case 'allcash': this.living.forEach(item => this.credit(item, a, card.title)); break;
        case 'allpay': this.beginPayments(this.living.map(item => payment(item, a))); return;
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
        case 'shield': case 'doubler': case 'reversal': this.grantPerk(player, card.effect, card.charges); break;
        case 'rollagain': s.extraRoll = true; this.log(player.name + ' rolls again straight away.', 'important', 'power', player.id); break;
        case 'jailfree': player.jailFree = (player.jailFree || 0) + 1; this.log(player.name + ' keeps a Get out of Prison free card.', 'important', 'power', player.id); break;
        case 'utilitycash': this.credit(player, 50 + this.owned(player).filter(space => space.type === 'utility').length * 40, card.title); break;
        case 'portfoliocash': this.credit(player, this.owned(player).filter(space => !this.asset(space.id).mortgaged).length * (card.per || 25), card.title); break;
        case 'buildingcash': this.credit(player, this.owned(player).reduce((sum, space) => sum + this.asset(space.id).buildings, 0) * (card.per || 20), card.title); break;
        case 'catchup': {
          const poorest = Math.min(...netWorths.map(entry => entry.worth));
          this.credit(player, netWorths.find(entry => entry.item.id === player.id).worth <= poorest ? a : b, card.title); break;
        }
        case 'levy': {
          const richest = netWorths.reduce((best, entry) => entry.worth > best.worth ? entry : best).item;
          this.log(richest.name + ' is the richest player and pays the levy into the Free Market jackpot.', 'important');
          this.beginPayments([payment(richest, a)]); return;
        }
      }
      this.finishResolution();
    }
    // Wheel of Fortune slices with this stage's cash amounts and each slice's chance of coming up.
    wheelSegments() {
      const k = this.stage(), total = WHEEL.reduce((sum, slice) => sum + slice.weight, 0);
      return WHEEL.map(slice => {
        const amount = slice.amount ? slice.amount * k : 0, amountText = slice.kind === 'cash' ? '+' + money(amount) : slice.kind === 'pay' ? '−' + money(amount) : '';
        return { id: slice.id, kind: slice.kind, label: slice.label, tier: slice.tier, amount, amountText, text: amountText ? slice.label + ' ' + amountText : slice.label, chance: slice.weight / total };
      });
    }
    // Properties the player could build a level on if building were free: unmortgaged and level with their others of the colour.
    freeBuildTargets(player) {
      return this.owned(player).filter(space => space.type === 'property' && !this.asset(space.id).mortgaged && this.asset(space.id).buildings < 5
        && !this.buildPeers(player, space).some(item => this.asset(item.id).buildings < this.asset(space.id).buildings));
    }
    spinWheel() {
      const s = this.state, player = this.active;
      this.require(s.phase === 'wheel', 'There is no wheel to spin.');
      // Weighted pick. After 3 free spins in a row the free-spin slice is taken off the wheel for this spin.
      const slices = this.wheelSegments(), open = slices.map((slice, i) => ({ slice, i, weight: WHEEL[i].weight })).filter(entry => entry.slice.kind !== 'free' || (s.wheelFree || 0) < WHEEL_MAX_FREE);
      let roll = this.random() * open.reduce((sum, entry) => sum + entry.weight, 0), pick = open.at(-1);
      for (const entry of open) { roll -= entry.weight; if (roll < 0) { pick = entry; break; } }
      const { slice, i: index } = pick;
      const last = s.lastWheel = { id: (s.lastWheel?.id || 0) + 1, player: player.id, index, label: slice.text, outcome: '' };
      this.log(player.name + ' spun the Wheel of Fortune and it stopped on “' + slice.text + '”.', 'important'); this.sound('event');
      if (slice.kind !== 'free') s.wheelFree = 0;
      switch (slice.kind) {
        case 'cash': last.outcome = 'Won ' + money(slice.amount); this.credit(player, slice.amount, 'Wheel of Fortune'); break;
        case 'pay': last.outcome = 'Lost ' + money(slice.amount); this.beginPayments([{ payer: player.id, creditor: null, amount: slice.amount, reason: 'Wheel of Fortune', category: 'fee' }]); return;
        case 'free': s.wheelFree = (s.wheelFree || 0) + 1; last.outcome = 'Free spin! Spin again.'; this.log(player.name + ' gets a free spin.', 'important', 'gain', player.id); this.emit(); return;
        case 'power': { const key = POWER_UPS[Math.min(POWER_UPS.length - 1, Math.floor(this.random() * POWER_UPS.length))]; last.outcome = 'Power-up: ' + PERK_NAMES[key]; this.grantPerk(player, key); break; }
        case 'build': {
          if (!this.freeBuildTargets(player).length) { const consolation = this.stage() * 100; last.outcome = 'Nothing to build; won ' + money(consolation); this.credit(player, consolation, 'Wheel of Fortune (nothing to build)'); break; }
          last.outcome = 'Free house! Choose where to build.'; s.phase = 'freebuild'; this.emit(); return;
        }
      }
      this.finishResolution();
    }
    // The Free house prize: one free building level on a property from freeBuildTargets (the 2-of-a-colour and even-building rules apply; landing there is not needed).
    freeBuild(id) {
      const s = this.state, player = this.active;
      this.require(s.phase === 'freebuild', 'There is no free house to place.');
      const space = this.freeBuildTargets(player).find(item => item.id === id);
      this.require(space, 'Choose a property that can take a free building level.');
      this.asset(id).buildings++; player.stats.buildingsBuilt++;
      this.log(player.name + ' built a free level on ' + space.name + ': ' + levelName(this.asset(id).buildings) + '.', 'money', 'gain', player.id); this.sound('build');
      this.finishResolution();
    }
    // Status lines for the City Event banner.
    cityLines() {
      const city = this.state.city || {}, round = this.state.round || 1, lines = [];
      if (city.active) lines.push(CITY_EVENTS[city.active.kind].name + ' (' + CITY_EVENTS[city.active.kind].short + '), ' + (city.active.until - round + 1) + ' round' + (city.active.until - round + 1 === 1 ? '' : 's') + ' left.');
      if (city.upcoming) lines.push('Next round: ' + CITY_EVENTS[city.upcoming.kind].name + ' (' + CITY_EVENTS[city.upcoming.kind].short + ').');
      return lines;
    }
    // Called when every active player has taken a turn and a new round begins.
    advanceRound() {
      const s = this.state, city = s.city ||= { upcoming: null, active: null, last: null };
      s.round = (s.round || 1) + 1;
      if (city.active && s.round > city.active.until) { this.log('The ' + CITY_EVENTS[city.active.kind].name + ' has ended.', 'important'); city.active = null; }
      if (city.upcoming && city.upcoming.round === s.round) {
        const { kind } = city.upcoming; city.upcoming = null;
        this.log('City Event: ' + CITY_EVENTS[kind].name + '! ' + CITY_EVENTS[kind].text, 'important', 'city');
        if (kind === 'audit') this.applyAudit(); else city.active = { kind, until: s.round + 1 };
      }
      if (s.round % CITY_EVERY === CITY_EVERY - 1) {
        // Chosen at random from the three events, never the same one twice in a row.
        const kinds = Object.keys(CITY_EVENTS).filter(key => key !== city.last), kind = kinds[Math.min(kinds.length - 1, Math.floor(this.random() * kinds.length))];
        city.upcoming = { kind, round: s.round + 1 }; city.last = kind;
        this.log('Coming next round: ' + CITY_EVENTS[kind].name + '. ' + CITY_EVENTS[kind].text, 'important', 'city');
      }
    }
    // The richest player (by net worth) pays the poorest $100, or what they have if less. Ties go to the lower seat number.
    applyAudit() {
      const worth = this.living.map(item => ({ item, worth: this.finances(item).netWorth }));
      const richest = worth.reduce((best, entry) => entry.worth > best.worth ? entry : best), poorest = worth.reduce((best, entry) => entry.worth < best.worth ? entry : best);
      if (richest.item.id === poorest.item.id) { this.log('The audit finds nothing to redistribute.'); return; }
      const amount = Math.min(AUDIT_AMOUNT, richest.item.cash);
      richest.item.cash -= amount; poorest.item.cash += amount;
      this.log(richest.item.name + ' pays ' + money(amount) + ' to ' + poorest.item.name + ' after the audit.', 'money', 'loss', richest.item.id);
    }
    sendPlayerToPenalty(player) {
      this.state.extraRoll = false;
      if ((player.jailFree || 0) > 0) {
        player.jailFree--;
        this.log(player.name + ' uses a Get out of Prison free card and avoids Prison.', 'important', 'power', player.id); this.sound('event');
        return;
      }
      player.position = 10; player.penalty = { kind: 'prison', attempts: 0 };
      this.log(player.name + ' was sent to Prison. Rent collection continues.', 'important', 'prison', player.id);
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
        // Part of every tax, fine and card payment to the bank goes into the Free Market jackpot; the rest is removed from play.
        if (!creditor && (payment.category === 'fee' || payment.category === 'tax')) s.jackpot = (s.jackpot ?? JACKPOT_BASE) + Math.floor(payment.amount * POT_SHARE);
        this.log(payer.name + ' paid ' + money(payment.amount) + (creditor ? ' to ' + creditor.name : ' to the bank') + ': ' + payment.reason + '.', 'money', 'loss', payer.id);
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
        else { asset.owner = null; asset.buildings = 0; asset.mortgaged = false; delete asset.mortgageReceived; delete asset.ready; }
      });
      if (debt.category === 'rent' && creditor) { creditor.stats.rentEarned += payer.cash; payer.stats.rentPaid += payer.cash; }
      payer.cash = 0; payer.bankrupt = true; payer.penalty = null;
      this.log(payer.name + ' is bankrupt. Assets ' + (creditor ? 'transfer to ' + creditor.name + '.' : 'return to the bank.'), 'important', 'loss', payer.id);
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
      this.log(player.name + ' developed ' + space.name + ': ' + levelName(asset.buildings) + ' (' + money(cost) + ').', 'money', 'deal', player.id);
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
      const amount = this.mortgageProceeds(player, space);
      asset.mortgaged = true; asset.mortgageReceived = amount; player.cash += amount;
      this.log(player.name + ' mortgaged ' + space.name + ' for ' + money(amount) + (amount > space.mortgageValue ? ' (Fire Sale: +25% because cash was under $200)' : '') + '.', 'money'); this.emit();
    }
    unmortgageProperty(id) {
      const { space, asset, player } = this.actionOwner(id);
      const cost = this.unmortgageCost(id);
      this.require(asset.mortgaged && this.state.phase !== 'debt', 'Unmortgaging is unavailable while paying a debt or on an active property.');
      this.require(player.cash >= cost, 'Not enough cash to unmortgage.');
      asset.mortgaged = false; delete asset.mortgageReceived; player.cash -= cost;
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
      // Buildings and mortgages travel with a traded property.
      trade.give.properties.forEach(id => { this.asset(id).owner = to.id; this.asset(id).ready = false; });
      trade.get.properties.forEach(id => { this.asset(id).owner = from.id; this.asset(id).ready = false; });
      this.log(to.name + ' accepted. ' + from.name + ' traded ' + this.tradeSummary(trade.give) + ' for ' + this.tradeSummary(trade.get) + '.', 'money', 'deal', from.id);
      s.phase = trade.returnPhase; s.trade = null; this.sound('purchase'); this.emit();
    }
    // `note` is a bot's reason for declining, shown to the table with the decline; `remark` is its few-word quote for the popup.
    rejectTrade(reason = 'declined', note = '', remark = '') {
      const s = this.state, trade = s.trade;
      this.require(s.phase === 'trade' && trade, 'There is no trade offer to answer.');
      const why = typeof note === 'string' ? note.slice(0, 200) : '';
      this.log(this.player(trade.to).name + ' ' + reason + ' the trade offer from ' + this.player(trade.from).name + (why ? ': ' + why : '.'), why ? 'important' : 'normal', why ? 'deal' : undefined, trade.from);
      if (typeof remark === 'string' && remark.trim()) s.log.at(-1).remark = remark.trim().slice(0, 40);
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
      const previous = index;
      do { index = (index + 1) % s.players.length; } while (s.players[index].bankrupt);
      s.currentPlayer = index; s.turn++; s.phase = 'ready'; s.hasRolled = false; s.extraRoll = false; s.doublesCount = 0; s.tradesThisTurn = 0;
      if (index <= previous) this.advanceRound();
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
      this.owned(player).forEach(space => { Object.assign(this.asset(space.id), { owner: null, buildings: 0, mortgaged: false }); delete this.asset(space.id).ready; delete this.asset(space.id).mortgageReceived; });
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
      this.log(this.living[0].name + ' wins MARKET WARS!', 'important', 'gain', this.living[0].id); this.sound('victory'); return true;
    }
    serialize() {
      this.require(!this.busy, 'Wait until the dice and movement finish before saving.');
      this.state.savedAt = Date.now();
      return JSON.stringify(this.state);
    }
    static restore(serialized, options = {}) {
      const s = JSON.parse(serialized);
      if (Array.isArray(s?.players)) s.players = normalizeTokens(s.players);
      if (!s || s.version !== 1 || !Array.isArray(s.players) || validatePlayers(s.players) || !s.properties || !['ready', 'end', 'offer', 'auction', 'trade', 'wheel', 'freebuild', 'event', 'debt', 'victory'].includes(s.phase)) throw new Error('This saved game is not compatible. Start a new game.');
      const number = value => Number.isFinite(value) && value >= 0;
      if (s.players.some((p, i) => p.id !== i || !Number.isInteger(p.position) || p.position < 0 || p.position >= BOARD.length || !number(p.cash) || !p.stats || Object.keys(stats()).some(key => !number(p.stats[key])) || typeof p.bankrupt !== 'boolean' || (p.penalty && (!['prison', 'pricewar'].includes(p.penalty.kind) || !Number.isInteger(p.penalty.attempts) || p.penalty.attempts < 0 || p.penalty.attempts > 3)))) throw new Error('The saved player data is damaged.');
      if (BOARD.filter(space => space.price).some(space => {
        const asset = s.properties[space.id];
        return !asset || (asset.owner !== null && !s.players[asset.owner]) || !Number.isInteger(asset.buildings) || asset.buildings < 0 || asset.buildings > 5 || typeof asset.mortgaged !== 'boolean' || (asset.mortgaged && asset.buildings > 0);
      })) throw new Error('The saved property data is damaged.');
      if (!s.players[s.currentPlayer] || !Number.isInteger(s.turn) || s.turn < 1 || !Array.isArray(s.dice) || s.dice.length !== 2 || s.dice.some(value => !Number.isInteger(value) || value < 1 || value > 6) || !Array.isArray(s.log) || !Array.isArray(s.history) || !s.settings || !s.decks || !Array.isArray(s.payments)) throw new Error('The saved turn data is damaged.');
      // Decks hold only the recent draws now; older saves had a shuffled order, which is dropped.
      for (const name of Object.keys(DECKS)) {
        const recent = s.decks[name]?.recent;
        s.decks[name] = { recent: Array.isArray(recent) ? recent.filter(i => Number.isInteger(i) && i >= 0 && i < DECKS[name].length).slice(-RECENT_LIMIT) : [] };
      }
      s.round = Number.isInteger(s.round) && s.round >= 1 ? s.round : Math.floor((s.turn - 1) / s.players.length) + 1;
      s.jackpot = number(s.jackpot) ? s.jackpot : JACKPOT_BASE;
      s.city = s.city && typeof s.city === 'object' ? { upcoming: s.city.upcoming || null, active: s.city.active || null, last: s.city.last || null } : { upcoming: null, active: null, last: null };
      s.wheelFree = Number.isInteger(s.wheelFree) && s.wheelFree > 0 ? s.wheelFree : 0;
      s.lastWheel = s.lastWheel || null;
      s.lastDie = s.lastDie || null; s.droppedDie = Number.isInteger(s.droppedDie) ? s.droppedDie : null;
      s.players.forEach(p => {
        p.jailFree = Number.isInteger(p.jailFree) && p.jailFree > 0 ? p.jailFree : 0;
        const count = key => Number.isInteger(p.perks?.[key]) && p.perks[key] > 0 ? p.perks[key] : 0;
        p.perks = Object.fromEntries(Object.keys(emptyPerks()).map(key => [key, count(key)]));
      });
      if ((s.phase === 'offer' && (!BOARD[s.offer]?.price || s.properties[s.offer].owner !== null)) || (s.phase === 'event' && !DECKS[s.event?.deck]?.[s.event?.index]) || ((s.phase === 'wheel' || s.phase === 'freebuild') && BOARD[s.players[s.currentPlayer].position]?.type !== 'wheel') || (s.phase === 'auction' && (!s.auction || !BOARD[s.auction.property]?.price || !s.players[s.auction.bidder] || !number(s.auction.bid) || !Array.isArray(s.auction.order) || !Array.isArray(s.auction.passed))) || (s.phase === 'debt' && (!s.pending || !s.players[s.pending.payer] || !number(s.pending.amount) || s.payments.length === 0)) || (s.phase === 'victory' && !s.players[s.winner]) || (s.phase === 'trade' && (!s.trade || !s.players[s.trade.from] || !s.players[s.trade.to] || !['ready', 'end'].includes(s.trade.returnPhase)))) throw new Error('The saved action is damaged.');
      // Games saved before the single rule set may hold a Price War detention; it becomes Prison.
      s.players.forEach(p => { delete p.role; p.color = TOKEN_COLORS[p.token] || p.color; if (p.penalty?.kind === 'pricewar') { p.penalty.kind = 'prison'; p.position = 10; } });
      const game = new Game(s.players, s.settings, options);
      game.state = s;
      game.state.settings = { ...DEFAULT_SETTINGS, ...s.settings };
      return game;
    }
  }

  return { Game, BOARD, GROUPS, DECKS, TOKENS, COLORS, DEFAULT_SETTINGS, SAVE_KEY, SETTINGS_KEY, money, levelName, validatePlayers, normalizeTokens, TOKEN_COLORS, CITY_EVENTS, JACKPOT_BASE, RARITY_WEIGHTS, SERVICE_RENT, POT_SHARE, PERK_NAMES, PERK_CHARGES, POWER_UPS, WHEEL, WHEEL_MAX_FREE, FIRE_SALE_CASH, LAUNCH_BOOST, AUDIT_AMOUNT, clone };
})();
globalThis.MarketWars = MarketWars;


if (typeof module !== "undefined") module.exports = MarketWars;
