/* Regression tests for the classic game rules, shared by client and server. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = { console, setTimeout, clearTimeout };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'lib', 'game-engine.cjs'), 'utf8'), context);
const { Game, BOARD, DECKS, validatePlayers } = context.MarketWars;
const players = [
  { name: 'Ritesh', token: 'black' },
  { name: 'Manish', token: 'blue' },
  { name: 'Asha', token: 'magenta' },
  { name: 'Dev', token: 'lime' }
];
const testCases = [];
const test = (name, run) => testCases.push({ name, run });
const create = (count = 2, random = () => .4) => new Game(players.slice(0, count), {}, { random, wait: async () => {} });
const land = (game, position) => { game.active.position = position; game.state.phase = 'moving'; game.resolveSpace(); };
const own = (game, id, owner = 0) => { game.asset(id).owner = owner; };
const stand = (game, id) => { game.active.position = id; game.state.hasRolled = true; };
// Build the way a turn does: land on the property (a new turn each time), then build once.
const build = (game, id) => { Object.assign(game.state, { phase: 'end', hasRolled: true, extraRoll: false, turn: game.state.turn + 1 }); game.active.position = id; return game.buildStructure(id); };
const drain = async game => { for (let i = 0; i < 200 && game.busy; i++) await Promise.resolve(); assert.ok(!game.busy, 'movement completed'); };
function randomSeed(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

test('2, 3 and 4 players start with valid state and $1,500 each', () => {
  for (const count of [2, 3, 4]) {
    const game = create(count);
    assert.equal(game.state.players.length, count);
    assert.ok(game.state.players.every(player => player.cash === 1500 && player.position === 0 && player.type === 'human'));
    assert.equal(game.active.id, 0);
  }
  assert.equal(BOARD.length, 40);
  assert.equal(DECKS.market.length, 15); assert.equal(DECKS.economic.length, 15);
});
test('setup rejects repeated names, repeated tokens and blank names; no roles are needed', () => {
  assert.ok(validatePlayers([{ ...players[0] }, { ...players[1], name: ' ritesh ' }]));
  assert.ok(validatePlayers([{ ...players[0] }, { ...players[1], token: 'black' }]));
  assert.ok(validatePlayers([{ ...players[0] }, { ...players[1], name: '  ' }]));
  assert.equal(validatePlayers(players.slice(0, 2)), '');
  assert.ok(create(2).state.players.every(player => !('role' in player)));
});
test('each player marker is one of four colours, and older emoji tokens map onto free colours', () => {
  const game = create(4);
  assert.deepEqual(game.state.players.map(player => player.color), ['#17171c', '#1e40e6', '#e3008c', '#7ed321']);
  const legacy = new Game([{ name: 'Old', token: 'briefcase' }, { name: 'New', token: 'black' }, { name: 'Odd', token: 'rocket' }], {}, { wait: async () => {} });
  assert.deepEqual(legacy.state.players.map(player => player.token).join(), 'blue,black,magenta');
  const saved = JSON.parse(create().serialize()); saved.players[0].token = 'laptop'; saved.players[1].token = 'crown';
  const restored = Game.restore(JSON.stringify(saved));
  assert.equal(restored.state.players.map(p => p.token + p.color).join(), 'black#17171c,blue#1e40e6');
});
test('dice stay within 1–6, illegal rolls are rejected, turns switch correctly', async () => {
  for (const value of [0, .1, .4, .7, .999999]) {
    const game = create(2, () => value);
    await game.rollDice();
    assert.ok(game.state.dice.every(die => die >= 1 && die <= 6));
    if (game.state.phase === 'offer') game.purchaseProperty();
    if (game.state.phase === 'event') { await game.applyCard(); if (game.state.phase === 'offer') game.purchaseProperty(); }
    if (game.state.phase === 'auction') { while (game.state.auction) game.auctionPass(); }
    assert.equal(game.state.phase, 'end');
    if (game.state.extraRoll) { assert.throws(() => game.nextTurn(), /Roll again/); game.state.extraRoll = false; }
    game.nextTurn(); assert.equal(game.active.id, 1); assert.equal(game.state.turn, 2);
    game.state.phase = 'offer'; await assert.rejects(game.rollDice(), /./);
  }
});
test('forward movement wraps and awards Launch exactly once, backwards does not', async () => {
  const game = create(); game.active.position = 38;
  await game.movePlayer(3, { resolve: false });
  assert.equal(game.active.position, 1); assert.equal(game.active.cash, 1700); assert.equal(game.active.stats.startBonuses, 1);
  await game.movePlayer(-2, { resolve: false }); assert.equal(game.active.position, 39); assert.equal(game.active.cash, 1700);
  game.active.position = 39; await game.movePlayer(1); assert.equal(game.active.cash, 1900);
});
test('buying changes cash and ownership, and invalid purchases cannot repeat', () => {
  const game = create(); land(game, 1); assert.equal(game.state.phase, 'offer'); game.purchaseProperty();
  assert.equal(game.asset(1).owner, 0); assert.equal(game.active.cash, 1400); assert.equal(game.active.stats.propertiesPurchased, 1);
  assert.throws(() => game.purchaseProperty());
  land(game, 39); game.active.cash = 1; assert.throws(() => game.purchaseProperty(), /enough cash/); assert.equal(game.asset(39).owner, null);
});
test('rent transfers to an owner and tracks paid and earned statistics', () => {
  const game = create(); own(game, 1, 1); land(game, 1);
  assert.equal(game.state.players[0].cash, 1492); assert.equal(game.state.players[1].cash, 1508);
  assert.equal(game.state.players[0].stats.rentPaid, 8); assert.equal(game.state.players[1].stats.rentEarned, 8);
});
test('the supplied visitor sound triggers on another owner’s space, even when mortgaged, and obeys mute', () => {
  const played = [], game = new Game(players.slice(0, 2), {}, { wait: async () => {}, onSound: kind => played.push(kind) });
  own(game, 1, 1); land(game, 1);
  assert.equal(played.filter(kind => kind === 'visitor').length, 1);
  game.asset(1).mortgaged = true; land(game, 1);
  assert.equal(played.filter(kind => kind === 'visitor').length, 2);
  game.state.settings.sound = false; land(game, 1);
  assert.equal(played.filter(kind => kind === 'visitor').length, 2);
  game.state.settings.sound = true; game.state.currentPlayer = 1; land(game, 1);
  assert.equal(played.filter(kind => kind === 'visitor').length, 2);
});
test('building needs at least 2 unmortgaged properties of a color and costs the district price per level', () => {
  const game = create(); own(game, 1); assert.equal(game.calculateRent(1), 8);
  assert.throws(() => build(game, 1), /at least 2 unmortgaged Tidehaven/);
  own(game, 2); assert.equal(game.calculateRent(1), 16, 'owning 2 of a color doubles undeveloped rent');
  build(game, 1); assert.equal(game.active.cash, 1450); assert.equal(game.calculateRent(1), 32);
  const canal = create(); own(canal, 4); assert.throws(() => build(canal, 4), /at least 2/);
  own(canal, 6, 1); assert.throws(() => build(canal, 4), /at least 2/, 'a rival property does not count');
  assert.equal(canal.calculateRent(4), 12, 'one of a color earns base rent');
  own(canal, 7); assert.equal(canal.calculateRent(4), 24, 'two of three already doubles undeveloped rent');
  build(canal, 4); assert.equal(canal.active.cash, 1440); assert.equal(canal.calculateRent(4), 48);
  build(canal, 7); build(canal, 4); assert.equal(canal.asset(4).buildings, 2, 'even building counts only your own properties');
});
test('building and selling must stay even across a color set', () => {
  const game = create(); own(game, 1); own(game, 2);
  build(game, 1); assert.throws(() => build(game, 1), /evenly/);
  build(game, 2); build(game, 1); assert.equal(game.asset(1).buildings, 2);
  assert.throws(() => game.sellBuilding(2), /Sell evenly/);
  game.sellBuilding(1); assert.equal(game.asset(1).buildings, 1); assert.equal(game.active.cash, 1500 - 150 + 25);
});
test('building happens only on the property you landed on, one level per landing', () => {
  const game = create(); own(game, 1); own(game, 2);
  Object.assign(game.state, { phase: 'end', hasRolled: true, extraRoll: false }); game.active.position = 20;
  assert.throws(() => game.buildStructure(1), /Land on Beacon Wharf to build/, 'not while standing elsewhere');
  game.active.position = 1; game.state.phase = 'ready'; game.state.hasRolled = false;
  assert.throws(() => game.buildStructure(1), /Land on/, 'not before rolling');
  game.state.phase = 'end'; game.state.hasRolled = true; game.state.extraRoll = true;
  assert.throws(() => game.buildStructure(1), /Land on/, 'not on a doubles waypoint');
  game.state.extraRoll = false; game.buildStructure(1); assert.equal(game.asset(1).buildings, 1);
  assert.throws(() => game.buildStructure(1), /built here this turn/, 'one building per landing');
  assert.throws(() => game.buildStructure(2), /Land on Sailmaker Lane/, 'other properties need their own landing');
  build(game, 2); assert.equal(game.asset(2).buildings, 1);
});
test('newly acquired land must be landed on again before its first build; 2 of a color still required', () => {
  const game = create(); own(game, 2); land(game, 1); game.purchaseProperty();
  assert.equal(game.asset(1).ready, false); assert.throws(() => build(game, 1), /Land on Beacon Wharf again/, 'not on the landing where it was bought');
  build(game, 2); assert.equal(game.asset(2).buildings, 1);
  assert.throws(() => build(game, 2), /evenly/, 'every property of the colour needs a building before any gets a second');
  game.state.phase = 'moving'; game.active.position = 1; game.resolveSpace(); assert.equal(game.asset(1).ready, true);
  game.buildStructure(1); assert.equal(game.asset(1).buildings, 1, 'landing again unlocks building there, on that same landing');
  build(game, 2); build(game, 1); assert.equal(game.asset(1).buildings, 2); assert.equal(game.asset(2).buildings, 2);
  const lone = create(); land(lone, 4); lone.purchaseProperty(); lone.state.phase = 'moving'; lone.active.position = 4; lone.resolveSpace();
  assert.equal(lone.asset(4).ready, true); assert.throws(() => build(lone, 4), /at least 2/, 'landing again does not lift the color rule');
  const traded = create(); own(traded, 1); own(traded, 2, 1); traded.proposeTrade({ to: 1, give: { cash: 200, properties: [] }, get: { cash: 0, properties: [2] } }); traded.acceptTrade();
  assert.throws(() => build(traded, 2), /again/, 'traded land must also be landed on first');
});
test('all five development levels, sale, cost and tower rent work', () => {
  const game = create(); own(game, 1); own(game, 2);
  for (let i = 0; i < 5; i++) { build(game, 1); build(game, 2); }
  assert.equal(game.asset(1).buildings, 5); assert.equal(game.calculateRent(1), 400); assert.throws(() => build(game, 1), /tower/);
  assert.equal(game.active.cash, 1000);
  game.sellBuilding(1); assert.equal(game.asset(1).buildings, 4); assert.equal(game.active.cash, 1025); assert.equal(game.calculateRent(1), 288);
});
test('mortgaged groups prohibit building; buildings in the color block mortgages', () => {
  const game = create(); own(game, 1); own(game, 2); build(game, 1);
  assert.throws(() => game.mortgageProperty(2), /district/);
  game.sellBuilding(1); game.mortgageProperty(2); assert.throws(() => build(game, 1), /unmortgaged/);
  game.unmortgageProperty(2); build(game, 1); assert.equal(game.asset(1).buildings, 1);
});
test('mortgage disables rent and development; 10% fee restores rent', () => {
  const game = create(); own(game, 1); game.mortgageProperty(1);
  assert.equal(game.active.cash, 1550); assert.equal(game.calculateRent(1), 0); assert.throws(() => build(game, 1), /Unmortgage/);
  game.unmortgageProperty(1); assert.equal(game.active.cash, 1495); assert.equal(game.calculateRent(1), 8);
  assert.throws(() => game.mortgageProperty(4), /owner/); assert.throws(() => game.sellBuilding(1), /no buildings/);
});
test('transport and utility rents count only active stations, buildings are prohibited', () => {
  const game = create(); own(game, 8); own(game, 23); own(game, 15); own(game, 29);
  assert.equal(game.calculateRent(8), 50); assert.equal(game.calculateRent(15, 7), 70);
  game.mortgageProperty(23); game.mortgageProperty(29);
  assert.equal(game.calculateRent(8), 25); assert.equal(game.calculateRent(15, 7), 28);
  assert.throws(() => build(game, 8), /cannot be developed/);
});
test('auction cycles bidders, awards highest bid, and handles no bids', () => {
  const game = create(4); land(game, 1); game.purchaseProperty(); game.asset(1).buildings = 2; game.startAuction(1);
  assert.deepEqual(game.state.auction.order, [1, 2, 3]);
  game.auctionBid(20); assert.equal(game.state.auction.bidder, 2);
  game.auctionBid(30); assert.equal(game.state.auction.bidder, 3);
  game.auctionPass(); assert.equal(game.state.auction.bidder, 1); game.auctionPass();
  assert.equal(game.asset(1).owner, 2); assert.equal(game.asset(1).buildings, 2);
  assert.equal(game.player(2).cash, 1450); assert.equal(game.player(0).cash, 1450); assert.equal(game.player(2).stats.auctionWins, 1);
  land(game, 2); game.purchaseProperty(); const cash = game.active.cash;
  game.startAuction(2); while (game.state.auction) game.auctionPass(); assert.equal(game.asset(2).owner, 0); assert.equal(game.active.cash, cash);
});
test('auction rejects over-budget bids and invalid increments', () => {
  const game = create(); land(game, 1); game.purchaseProperty(); game.startAuction(1);
  assert.throws(() => game.auctionBid(9), /at least/); assert.throws(() => game.auctionBid(10.5), /whole/); assert.throws(() => game.auctionBid(1501), /cover/);
  assert.equal(game.state.auction.bidder, 1); game.auctionBid(10); assert.equal(game.asset(1).owner, 1); assert.equal(game.player(0).cash, 1410);
});
test('landing offers only buy or skip; skipping leaves the property with the bank and starts no auction', () => {
  const game = create(3); land(game, 1); assert.throws(() => game.startAuction(1), /owner/);
  game.declineProperty(); assert.equal(game.asset(1).owner, null); assert.equal(game.state.auction, null); assert.equal(game.state.phase, 'end');
  land(game, BOARD.find(space => space.type === 'auction').id); assert.equal(game.state.phase, 'offer'); game.declineProperty(); assert.equal(game.state.auction, null);
});
test('only an owner may start an auction during their turn', () => {
  const game = create(); land(game, 1); game.purchaseProperty(); assert.equal(game.state.auction, null);
  game.mortgageProperty(1); assert.throws(() => game.startAuction(1), /Unmortgage/); game.unmortgageProperty(1);
  game.nextTurn(); assert.throws(() => game.startAuction(1), /owner/);
});
test('an unsold auction before rolling restores the seller turn without consuming a roll', () => {
  const game = create(); own(game, 1); game.startAuction(1); game.auctionPass();
  assert.equal(game.state.phase, 'ready'); assert.equal(game.canRoll(), true); assert.equal(game.asset(1).owner, 0);
});
test('saved bank auctions from earlier games still resolve', () => {
  let game = create(); game.state.phase = 'auction';
  game.state.auction = { property: 1, bid: 20, leader: 0, order: [0, 1], passed: [], bidder: 1 };
  game = Game.restore(game.serialize()); game.auctionPass();
  assert.equal(game.asset(1).owner, 0); assert.equal(game.player(0).cash, 1480); assert.equal(game.state.phase, 'end');
});
test('every event resolves, card decks recycle, and effects cannot apply twice', async () => {
  for (const [name, cards] of Object.entries(DECKS)) {
    for (let index = 0; index < cards.length; index++) {
      const game = create(4); own(game, 4, 1); game.asset(4).buildings = 2;
      game.state.event = { deck: name, index }; game.state.phase = 'event';
      await game.applyCard(); await drain(game);
      assert.ok(['end', 'offer', 'debt', 'auction', 'event'].includes(game.state.phase));
      assert.ok(game.state.players.every(player => player.cash >= 0));
      if (game.state.phase !== 'event') await assert.rejects(game.applyCard());
    }
    const game = create();
    const seen = new Set();
    for (let i = 0; i < 15; i++) { game.drawCard(name); seen.add(game.state.event.index); }
    assert.equal(seen.size, 15); game.drawCard(name); assert.equal(game.state.decks[name].cursor, 1);
  }
});
test('taxes are flat, Free Market pays nothing and City Bank pays interest, for every player', () => {
  const game = create(); land(game, 5); assert.equal(game.active.cash, 1300); assert.equal(game.active.stats.taxesPaid, 200);
  land(game, 20); assert.equal(game.active.cash, 1300); land(game, 33); assert.equal(game.active.cash, 1350);
  land(game, 25); assert.equal(game.active.cash, 1250); assert.equal(game.active.stats.taxesPaid, 300);
  game.state.currentPlayer = 1; land(game, 5); assert.equal(game.active.cash, 1300); land(game, 20); assert.equal(game.active.cash, 1300);
});
test('Go to Prison sends everyone to the one Prison, and rent continues inside', () => {
  const game = create(); own(game, 1); land(game, 30);
  assert.equal(game.active.position, 10); assert.equal(game.active.penalty.kind, 'prison'); assert.equal(game.calculateRent(1), 8);
  game.state.currentPlayer = 1; land(game, 30); assert.equal(game.active.position, 10); assert.equal(game.active.penalty.kind, 'prison');
  const visit = create(); land(visit, 10); assert.equal(visit.active.penalty, null);
  assert.equal(BOARD[36].type, 'market'); land(visit, 36); assert.equal(visit.state.phase, 'event');
});
test('saves from the two-role version restore with roles dropped and Price War mapped to Prison', () => {
  const s = JSON.parse(create().serialize());
  s.players[0].role = 'monopolist'; s.players[1].role = 'competitor'; s.players[1].position = 30; s.players[1].penalty = { kind: 'pricewar', attempts: 1 };
  const game = Game.restore(JSON.stringify(s));
  assert.ok(game.state.players.every(player => !('role' in player)));
  assert.equal(game.player(1).penalty.kind, 'prison'); assert.equal(game.player(1).position, 10);
});
test('paying penalty gives a normal roll; doubles release without an extra roll', async () => {
  const game = create(2, () => .2); game.sendPlayerToPenalty(game.active); game.state.phase = 'ready'; game.payPenalty();
  assert.equal(game.active.cash, 1450); assert.equal(game.active.penalty, null); assert.equal(game.state.phase, 'ready');
  game.sendPlayerToPenalty(game.active); game.state.phase = 'ready'; await game.rollDice();
  assert.equal(game.active.penalty, null); assert.equal(game.active.position, 14); assert.equal(game.state.extraRoll, false);
});
test('three failed detention rolls require payment; cash recovery resumes the last movement', async () => {
  let roll = 0; const game = create(2, () => (roll++ % 2 ? .2 : 0));
  game.sendPlayerToPenalty(game.active); game.active.penalty.attempts = 2; game.active.cash = 0; own(game, 1);
  game.state.phase = 'ready'; await game.rollDice();
  assert.equal(game.state.phase, 'debt'); assert.equal(game.state.pending.amount, 50); assert.equal(game.active.position, 10);
  game.mortgageProperty(1); game.settleDebt(); await drain(game);
  assert.equal(game.active.penalty, null); assert.equal(game.active.position, 13); assert.equal(game.state.phase, 'offer');
});
test('every player pays the listed price for bank land', () => {
  const game = create(); land(game, 4); game.purchaseProperty(); assert.equal(game.player(0).cash, 1500 - 140);
  game.state.currentPlayer = 1; land(game, 6); game.purchaseProperty(); assert.equal(game.player(1).cash, 1500 - 140);
  for (const space of BOARD.filter(item => item.price)) for (const player of game.state.players) assert.equal(game.purchasePrice(player, space), space.price);
  const poor = create(); poor.player(0).cash = 139; land(poor, 4); assert.throws(() => poor.purchaseProperty(), /enough cash/);
});
test('trades swap properties and cash once the other player accepts', () => {
  const game = create(3); own(game, 1); own(game, 2, 1); own(game, 4, 2);
  const offer = { to: 1, give: { cash: 120, properties: [] }, get: { cash: 0, properties: [2] } };
  game.proposeTrade(offer); assert.equal(game.state.phase, 'trade'); assert.equal(game.state.trade.to, 1);
  assert.throws(() => game.buildStructure(1)); assert.throws(() => game.proposeTrade(offer), /before rolling/);
  game.acceptTrade(); assert.equal(game.asset(2).owner, 0); assert.equal(game.player(0).cash, 1380); assert.equal(game.player(1).cash, 1620);
  assert.equal(game.state.phase, 'ready'); assert.equal(game.state.trade, null);
  build(game, 1); assert.equal(game.asset(1).buildings, 1, 'the traded property completes the set');
  const swap = create(); own(swap, 1); own(swap, 4, 1); swap.asset(4).mortgaged = true;
  swap.proposeTrade({ to: 1, give: { cash: 0, properties: [1] }, get: { cash: 30, properties: [4] } }); swap.acceptTrade();
  assert.equal(swap.asset(1).owner, 1); assert.equal(swap.asset(4).owner, 0); assert.ok(swap.asset(4).mortgaged, 'mortgages travel with the property');
  assert.equal(swap.player(0).cash, 1530);
});
test('properties with houses can be traded; the houses move with them and the new owner must land there to build', () => {
  const game = create(); own(game, 1); own(game, 2); own(game, 4, 1); own(game, 6, 1); game.asset(1).buildings = 2; game.asset(6).buildings = 1;
  game.proposeTrade({ to: 1, give: { cash: 0, properties: [1] }, get: { cash: 100, properties: [6] } }); game.acceptTrade();
  assert.equal(game.asset(1).owner, 1); assert.equal(game.asset(1).buildings, 2, 'houses travel with the property');
  assert.equal(game.asset(6).owner, 0); assert.equal(game.asset(6).buildings, 1);
  assert.equal(game.asset(1).ready, false); assert.equal(game.asset(6).ready, false);
});
test('rejected and invalid trades change nothing', () => {
  const game = create(3); own(game, 1); own(game, 2); own(game, 4, 1); game.asset(1).buildings = 1;
  const bad = (offer, pattern) => assert.throws(() => game.proposeTrade(offer), pattern);
  bad({ to: 0, give: { cash: 0, properties: [] }, get: { cash: 0, properties: [4] } }, /another active player/);
  bad({ to: 1, give: { cash: 0, properties: [4] }, get: { cash: 0, properties: [] } }, /own every property/);
  bad({ to: 1, give: { cash: 2000, properties: [] }, get: { cash: 0, properties: [4] } }, /does not have/);
  bad({ to: 1, give: { cash: 50, properties: [] }, get: { cash: 0, properties: [] } }, /at least one property/);
  bad({ to: 1, give: { cash: -5, properties: [] }, get: { cash: 0, properties: [4] } }, /incomplete/);
  game.state.phase = 'offer'; bad({ to: 1, give: { cash: 10, properties: [] }, get: { cash: 0, properties: [4] } }, /before rolling/); game.state.phase = 'ready';
  game.proposeTrade({ to: 1, give: { cash: 10, properties: [] }, get: { cash: 0, properties: [4] } }); game.rejectTrade();
  assert.equal(game.asset(4).owner, 1); assert.equal(game.player(0).cash, 1500); assert.equal(game.state.phase, 'ready');
  game.proposeTrade({ to: 1, give: { cash: 10, properties: [] }, get: { cash: 0, properties: [4] } }); game.rejectTrade();
  game.proposeTrade({ to: 1, give: { cash: 20, properties: [] }, get: { cash: 0, properties: [4] } }); game.rejectTrade();
  bad({ to: 1, give: { cash: 10, properties: [] }, get: { cash: 0, properties: [4] } }, /up to 3 trades/);
  game.state.phase = 'end'; game.nextTurn(); assert.equal(game.state.tradesThisTurn, 0);
  const saved = create(); own(saved, 4, 1); saved.proposeTrade({ to: 1, give: { cash: 10, properties: [] }, get: { cash: 0, properties: [4] } });
  const restored = Game.restore(saved.serialize()); restored.acceptTrade(); assert.equal(restored.asset(4).owner, 0);
  const left = create(3); own(left, 4, 1); left.proposeTrade({ to: 1, give: { cash: 10, properties: [] }, get: { cash: 0, properties: [4] } });
  left.forfeit(2); assert.equal(left.state.trade, null); assert.equal(left.state.phase, 'ready');
});
test('a player who leaves forfeits assets and the turn passes on', () => {
  const game = create(3); own(game, 1); game.asset(1).buildings = 2;
  game.forfeit(0);
  assert.equal(game.player(0).bankrupt, true); assert.equal(game.asset(1).owner, null); assert.equal(game.asset(1).buildings, 0);
  assert.equal(game.state.currentPlayer, 1); assert.equal(game.state.phase, 'ready');
  game.forfeit(2); assert.equal(game.state.phase, 'victory'); assert.equal(game.state.winner, 1);
});
test('a doubles landing is only a waypoint and the extra roll is mandatory', async () => {
  const rolls = [.4, .4, 0, .2]; const game = create(); game.random = () => rolls.shift();
  await game.rollDice(); await drain(game);
  assert.equal(game.active.position, 6); assert.equal(game.state.phase, 'end'); assert.equal(game.state.offer, null);
  assert.equal(game.state.extraRoll, true); assert.equal(game.asset(6).owner, null);
  assert.throws(() => game.nextTurn(), /Roll again/);
  await game.rollDice(); await drain(game);
  assert.equal(game.active.position, 9); assert.equal(game.state.phase, 'offer'); assert.equal(game.state.offer, 9);
});
test('a timed-out turn drops the open offer and passes to the next player', async () => {
  const rolls = [.4, .4, 0, .2]; const game = create(); game.random = () => rolls.shift();
  await game.rollDice(); await drain(game); await game.rollDice(); await drain(game);
  game.timeoutTurn();
  assert.equal(game.state.currentPlayer, 1); assert.equal(game.state.phase, 'ready'); assert.equal(game.asset(9).owner, null);
  const idle = create(); idle.timeoutTurn(); assert.equal(idle.state.currentPlayer, 1);
});
test('three consecutive doubles send a player directly to Prison', async () => {
  const game = create(2, () => 0);
  for (let i = 0; i < 2; i++) { await game.rollDice(); if (game.state.phase === 'offer') game.purchaseProperty(); if (game.state.phase === 'event') await game.applyCard(); }
  await game.rollDice(); assert.equal(game.active.penalty.kind, 'prison'); assert.equal(game.active.position, 10); assert.equal(game.state.extraRoll, false);
});
test('debt prohibits ending, building, borrowing or premature bankruptcy; mortgage settles', () => {
  const game = create(); own(game, 1); game.active.cash = 10;
  game.beginPayments([{ payer: 0, creditor: 1, amount: 50, reason: 'test rent', category: 'rent' }]);
  assert.equal(game.state.phase, 'debt'); assert.throws(() => game.nextTurn()); assert.throws(() => game.buildStructure(1)); assert.throws(() => game.declareBankruptcy(), /cover/);
  game.mortgageProperty(1); game.settleDebt(); assert.equal(game.active.cash, 10); assert.equal(game.player(1).cash, 1550); assert.equal(game.state.phase, 'end');
});
test('off-turn event debts use the debtor’s assets and return control to the active player', () => {
  const game = create(3); own(game, 4, 1); game.player(1).cash = 0;
  game.beginPayments(game.living.map(p => ({ payer: p.id, creditor: null, amount: 50, reason: 'market slowdown', category: 'fee' })));
  assert.equal(game.managerPlayer.id, 1); assert.equal(game.active.id, 0);
  assert.throws(() => game.mortgageProperty(1)); game.mortgageProperty(4); game.settleDebt();
  assert.equal(game.player(1).cash, 20); assert.equal(game.player(2).cash, 1450); assert.equal(game.active.id, 0); assert.equal(game.state.phase, 'end');
});
test('bankruptcy to a player transfers cash, properties, mortgages, and buildings', () => {
  const game = create(3); own(game, 4, 1); game.asset(4).buildings = 2; own(game, 6, 1); game.asset(6).mortgaged = true; game.player(1).cash = 12;
  game.beginPayments([{ payer: 1, creditor: 0, amount: 1000, reason: 'rent', category: 'rent' }]); game.declareBankruptcy();
  assert.ok(game.player(1).bankrupt); assert.equal(game.player(0).cash, 1512); assert.equal(game.asset(4).owner, 0); assert.equal(game.asset(4).buildings, 2); assert.equal(game.asset(6).owner, 0); assert.ok(game.asset(6).mortgaged);
  game.nextTurn(); assert.equal(game.active.id, 2);
});
test('bankruptcy to bank resets assets; a bankrupt active player is skipped automatically', () => {
  const game = create(3); own(game, 1); own(game, 2); game.asset(1).buildings = 2; game.active.cash = 0;
  game.beginPayments([{ payer: 0, creditor: null, amount: 1000, reason: 'tax', category: 'tax' }]); game.declareBankruptcy();
  assert.equal(game.asset(1).owner, null); assert.equal(game.asset(1).buildings, 0); assert.equal(game.asset(2).owner, null); assert.equal(game.active.id, 1); assert.equal(game.state.phase, 'ready');
});
test('victory is detected and no further turns can be taken', () => {
  const game = create(); game.active.cash = 0;
  game.beginPayments([{ payer: 0, creditor: 1, amount: 100, reason: 'rent', category: 'rent' }]); game.declareBankruptcy();
  assert.equal(game.state.phase, 'victory'); assert.equal(game.state.winner, 1); assert.throws(() => game.nextTurn()); assert.throws(() => game.buildStructure(1));
});
test('safe phase saves restore exact ownership, cash, decks, settings and pending actions', () => {
  for (const phase of ['ready', 'end', 'offer', 'auction', 'event', 'debt', 'victory']) {
    const game = create(); own(game, 4, 1); game.asset(4).buildings = 2; game.state.settings.sound = false;
    if (phase === 'end') game.finishResolution();
    if (phase === 'offer') land(game, 1);
    if (phase === 'auction') { land(game, 1); game.purchaseProperty(); game.startAuction(1); }
    if (phase === 'event') game.drawCard('economic');
    if (phase === 'debt') { game.active.cash = 0; game.beginPayments([{ payer: 0, creditor: null, amount: 100, reason: 'fee', category: 'fee' }]); }
    if (phase === 'victory') { game.player(0).bankrupt = true; game.checkWinner(); }
    const serialized = game.serialize(), restored = Game.restore(serialized);
    assert.equal(JSON.stringify(restored.state), serialized);
  }
  const game = create(); game.state.phase = 'moving'; assert.throws(() => game.serialize(), /finish/);
  assert.throws(() => Game.restore('{}')); const s = JSON.parse(create().serialize()); s.properties[1].buildings = -1; assert.throws(() => Game.restore(JSON.stringify(s)), /damaged/);
});
test('a saved auction, event and debt resume once, without duplicate transactions', async () => {
  let game = create(3); land(game, 1); game.purchaseProperty(); game.startAuction(1); game.auctionBid(20);
  game = Game.restore(game.serialize(), { wait: async () => {} }); game.auctionPass(); assert.equal(game.asset(1).owner, 1); assert.equal(game.player(0).cash, 1420); assert.equal(game.player(1).cash, 1480);
  game = create(); game.state.event = { deck: 'market', index: 0 }; game.state.phase = 'event';
  game = Game.restore(game.serialize(), { wait: async () => {} }); await game.applyCard(); assert.equal(game.player(0).cash, 1650);
  game = create(); own(game, 1); game.active.cash = 10; game.beginPayments([{ payer: 0, creditor: 1, amount: 50, reason: 'rent', category: 'rent' }]);
  game = Game.restore(game.serialize()); game.mortgageProperty(1); game.settleDebt(); assert.equal(game.player(1).cash, 1550); assert.equal(game.player(0).cash, 10);
});

async function simulate(count, seed) {
  let game = create(count, randomSeed(seed));
  const events = new Set(); let actions = 0, trades = 0;
  while (game.state.phase !== 'victory' && actions++ < 25000) {
    const s = game.state;
    switch (s.phase) {
      case 'ready': await game.rollDice(); break;
      case 'offer':
        if (game.active.cash >= BOARD[s.offer].price + 150) game.purchaseProperty(); else game.declineProperty(); break;
      case 'auction': {
        const a = s.auction, bidder = game.player(a.bidder), value = BOARD[a.property].price;
        if (a.bid + 10 <= Math.min(value, bidder.cash - 100)) game.auctionBid(10); else game.auctionPass(); break;
      }
      case 'event': events.add(s.event.deck + ':' + s.event.index); await game.applyCard(); break;
      case 'trade': {
        const t = s.trade, price = t.get.properties.reduce((sum, id) => sum + BOARD[id].price, 0);
        if (t.give.cash >= price * 2) { game.acceptTrade(); trades++; } else game.rejectTrade(); break;
      }
      case 'debt': {
        const debtor = game.managerPlayer;
        if (game.liquidatable(debtor) < s.pending.amount) game.declareBankruptcy();
        else {
          const developed = game.owned(debtor).find(space => !game.sellReason(debtor, space.id));
          const collateral = game.owned(debtor).find(space => !game.mortgageReason(debtor, space.id));
          if (debtor.cash >= s.pending.amount) game.settleDebt();
          else if (developed) game.sellBuilding(developed.id);
          else if (collateral) game.mortgageProperty(collateral.id);
          else assert.fail('solvent debtor has no liquidation action');
        }
        break;
      }
      case 'end': {
        if (!s.extraRoll && !s.tradesThisTurn) {
          const want = BOARD.find(space => space.type === 'property' && game.asset(space.id).owner !== null && game.asset(space.id).owner !== game.active.id
            && game.groupSpaces(space.group).every(item => item.id === space.id || game.asset(item.id).owner === game.active.id));
          const offer = want && { to: game.asset(want.id).owner, give: { cash: want.price * 2, properties: [] }, get: { cash: 0, properties: [want.id] } };
          if (offer && game.active.cash >= offer.give.cash + 150 && !game.tradeReason(game.active.id, offer)) { game.proposeTrade(offer); break; }
        }
        const available = game.owned(game.active).filter(space => !game.buildReason(game.active, space.id));
        const cheapest = available.sort((a, b) => game.asset(a.id).buildings - game.asset(b.id).buildings)[0];
        if (cheapest && game.active.cash > game.buildingCost(game.active, cheapest) + 200) game.buildStructure(cheapest.id);
        else if (game.state.extraRoll) await game.rollDice();
        else game.nextTurn();
        break;
      }
      case 'moving': case 'rolling': await drain(game); break;
      default: assert.fail('Unexpected phase: ' + s.phase);
    }
    assert.ok(s.players.every(p => p.cash >= 0 && p.position >= 0 && p.position < 40), 'valid player state after every action');
    assert.ok(Object.values(s.properties).every(a => a.buildings >= 0 && a.buildings <= 5 && !(a.buildings && a.mortgaged)), 'valid assets after every action');
    if (actions % 41 === 0 && !game.busy) game = Game.restore(game.serialize(), { random: game.random, wait: async () => {} });
  }
  assert.equal(game.state.phase, 'victory', 'complete game reaches one surviving player');
  // Every card is covered above; purchase-first games can finish in fewer turns.
  assert.equal(game.living.length, 1); assert.ok(events.size > 0);
  console.log('  ' + count + '-player simulation: ' + game.state.turn + ' turns, ' + actions + ' actions, ' + trades + ' trades, ' + events.size + ' distinct cards, winner ' + game.player(game.state.winner).name);
}
test('complete 2-player and 4-player games reach victory, with periodic save/reload', async () => {
  await simulate(2, 4827); await simulate(4, 99871);
});

(async () => {
  let passed = 0;
  for (const { name, run } of testCases) {
    try { await run(); console.log('PASS ' + name); passed++; }
    catch (error) { console.error('FAIL ' + name); console.error(error); process.exitCode = 1; }
  }
  console.log('\n' + passed + '/' + testCases.length + ' rule checks passed.');
})();
