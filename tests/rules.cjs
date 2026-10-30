/* Regression tests for the classic game rules, shared by client and server. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = { console, setTimeout, clearTimeout };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'lib', 'game-engine.cjs'), 'utf8'), context);
const { Game, BOARD, BOARDS, GROUPS, DECKS, WHEEL, validatePlayers, RARITY_WEIGHTS } = context.MarketWars;
const players = [
  { name: 'Ritesh', token: 'black' },
  { name: 'Manish', token: 'blue' },
  { name: 'Asha', token: 'magenta' },
  { name: 'Dev', token: 'lime' }
];
const testCases = [];
const test = (name, run) => testCases.push({ name, run });
// Rule mechanics are tested on the base economy (earnings ×1); the live multipliers are checked in their own test.
const create = (count = 2, random = () => .4) => new Game(players.slice(0, count), {}, { random, wait: async () => {}, earnings: 1 });
const game0 = () => create();
const playCard = async (game, deck, title) => { game.state.event = { deck, index: DECKS[deck].findIndex(card => card.title === title) }; game.state.phase = 'event'; await game.applyCard(); await drain(game); };
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
  assert.equal(DECKS.market.length, 87, 'the market deck'); assert.equal(DECKS.economic.length, 87, 'the economic deck');
  assert.equal(game0().state.jackpot, 100); assert.equal(game0().state.round, 1); assert.ok(game0().state.players.every(player => player.jailFree === 0));
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
  const played = [], game = new Game(players.slice(0, 2), {}, { wait: async () => {}, onSound: kind => played.push(kind), earnings: 1 });
  own(game, 1, 1); land(game, 1);
  assert.equal(played.filter(kind => kind === 'visitor').length, 1);
  game.asset(1).mortgaged = true; land(game, 1);
  assert.equal(played.filter(kind => kind === 'visitor').length, 2);
  game.state.settings.sound = false; land(game, 1);
  assert.equal(played.filter(kind => kind === 'visitor').length, 2);
  game.state.settings.sound = true; game.state.currentPlayer = 1; land(game, 1);
  assert.equal(played.filter(kind => kind === 'visitor').length, 2);
});
test('one property of a color is enough to build on, at the district price per level', () => {
  const game = create(); own(game, 1); assert.equal(game.calculateRent(1), 8);
  build(game, 1); assert.equal(game.asset(1).buildings, 1, 'no second property of the color is needed');
  assert.equal(game.active.cash, 1450); assert.equal(game.calculateRent(1), 64);
  const pair = create(); own(pair, 1); own(pair, 2); assert.equal(pair.calculateRent(1), 16, 'owning 2 of a color still doubles undeveloped rent');
  const canal = create(); own(canal, 4); own(canal, 6, 1);
  assert.equal(canal.calculateRent(4), 12, 'one of a color earns base rent');
  build(canal, 4); assert.equal(canal.asset(4).buildings, 1, 'a rival owning the rest of the color does not block building');
  assert.equal(canal.active.cash, 1440);
  own(canal, 7); build(canal, 7); build(canal, 4); assert.equal(canal.asset(4).buildings, 2, 'even building counts only your own properties');
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
  assert.throws(() => game.buildStructure(1), /Land on Patna Ghat to build/, 'not while standing elsewhere');
  game.active.position = 1; game.state.phase = 'ready'; game.state.hasRolled = false;
  assert.throws(() => game.buildStructure(1), /Land on/, 'not before rolling');
  game.state.phase = 'end'; game.state.hasRolled = true; game.state.extraRoll = true;
  assert.throws(() => game.buildStructure(1), /Land on/, 'not on a doubles waypoint');
  game.state.extraRoll = false; game.buildStructure(1); assert.equal(game.asset(1).buildings, 1);
  assert.throws(() => game.buildStructure(1), /built here this turn/, 'one building per landing');
  assert.throws(() => game.buildStructure(2), /Land on Bodh Gaya/, 'other properties need their own landing');
  build(game, 2); assert.equal(game.asset(2).buildings, 1);
});
test('newly acquired land must be landed on again before its first build', () => {
  const game = create(); own(game, 2); land(game, 1); game.purchaseProperty();
  assert.equal(game.asset(1).ready, false); assert.throws(() => build(game, 1), /Land on Patna Ghat again/, 'not on the landing where it was bought');
  build(game, 2); assert.equal(game.asset(2).buildings, 1);
  assert.throws(() => build(game, 2), /evenly/, 'every property of the colour needs a building before any gets a second');
  game.state.phase = 'moving'; game.active.position = 1; game.resolveSpace(); assert.equal(game.asset(1).ready, true);
  game.buildStructure(1); assert.equal(game.asset(1).buildings, 1, 'landing again unlocks building there, on that same landing');
  build(game, 2); build(game, 1); assert.equal(game.asset(1).buildings, 2); assert.equal(game.asset(2).buildings, 2);
  const lone = create(); land(lone, 4); lone.purchaseProperty(); lone.state.phase = 'moving'; lone.active.position = 4; lone.resolveSpace();
  assert.equal(lone.asset(4).ready, true); build(lone, 4); assert.equal(lone.asset(4).buildings, 1, 'landing again unlocks building, even with only one property of the color');
  assert.throws(() => lone.buildStructure(4), /built here this turn/, 'still one level per landing');
  const traded = create(); own(traded, 1); own(traded, 2, 1); traded.proposeTrade({ to: 1, give: { cash: 200, properties: [] }, get: { cash: 0, properties: [2] } }); traded.acceptTrade();
  assert.throws(() => build(traded, 2), /again/, 'traded land must also be landed on first');
});
test('all five development levels, sale, cost and tower rent work', () => {
  const game = create(); own(game, 1); own(game, 2);
  for (let i = 0; i < 5; i++) { build(game, 1); build(game, 2); }
  assert.equal(game.asset(1).buildings, 5); assert.equal(game.calculateRent(1), 3200, 'tower rent $1,600, doubled for owning the full harbor set'); assert.throws(() => build(game, 1), /tower/);
  assert.equal(game.active.cash, 1000);
  game.sellBuilding(1); assert.equal(game.asset(1).buildings, 4); assert.equal(game.active.cash, 1025); assert.equal(game.calculateRent(1), 2080, '4 houses $1,040, doubled for the full set');
});
test('owning every property of a color doubles all of its rents, houses and tower included', () => {
  const game = create(); own(game, 4); own(game, 7);
  game.asset(4).buildings = 1; assert.equal(game.calculateRent(4), 96, 'two of three: built rent is not doubled');
  game.asset(4).buildings = 0; assert.equal(game.calculateRent(4), 24, 'two of three doubles undeveloped rent');
  own(game, 6); assert.equal(game.calculateRent(4), 24, 'the full set does not stack on the undeveloped double');
  [1, 2, 3, 4].forEach(level => { game.asset(4).buildings = level; assert.equal(game.calculateRent(4), [96, 288, 840, 1560][level - 1] * 2, level + ' houses double with the full set'); });
  game.asset(4).buildings = 5; assert.equal(game.calculateRent(4), 4800, 'tower rent doubles too');
  game.asset(6).mortgaged = true; assert.equal(game.calculateRent(4), 4800, 'a mortgaged property still counts toward the full set');
  game.asset(6).mortgaged = false; own(game, 6, 1); assert.equal(game.calculateRent(4), 2400, 'a rival owning one property breaks the set');
  own(game, 6); game.state.city.active = { kind: 'boom', until: 99 }; assert.equal(game.calculateRent(4), 7200, 'City Events apply on top of the full-set double');
});
test('a mortgaged property cannot be built on; buildings in the color block mortgages', () => {
  const game = create(); own(game, 1); own(game, 2); build(game, 1);
  assert.throws(() => game.mortgageProperty(2), /district/);
  game.sellBuilding(1); game.mortgageProperty(2); build(game, 1); assert.equal(game.asset(1).buildings, 1, 'a mortgaged property of the color does not block building on the others');
  assert.throws(() => build(game, 2), /Unmortgage/, 'the mortgaged one cannot be built on');
});
test('mortgage disables rent and development; 10% fee restores rent', () => {
  const game = create(); own(game, 1); game.mortgageProperty(1);
  assert.equal(game.active.cash, 1550); assert.equal(game.calculateRent(1), 0); assert.throws(() => build(game, 1), /Unmortgage/);
  game.unmortgageProperty(1); assert.equal(game.active.cash, 1495); assert.equal(game.calculateRent(1), 8);
  assert.throws(() => game.mortgageProperty(4), /owner/); assert.throws(() => game.sellBuilding(1), /no buildings/);
});
test('transport and utility rents count only active stations, buildings are prohibited', () => {
  const game = create(); own(game, 8); own(game, 23); own(game, 15); own(game, 29);
  assert.equal(game.calculateRent(8), 150); assert.equal(game.calculateRent(15, 7), 105);
  game.mortgageProperty(23); game.mortgageProperty(29);
  assert.equal(game.calculateRent(8), 50); assert.equal(game.calculateRent(15, 7), 42);
  // Service rents grow with the game stage: ×2 after round 15, ×3 after 30, ×4 after 80, ×5 after 130.
  game.state.round = 16; assert.equal(game.calculateRent(8), 100); assert.equal(game.calculateRent(15, 7), 84);
  game.state.round = 31; assert.equal(game.calculateRent(8), 150);
  game.state.round = 80; assert.equal(game.calculateRent(8), 150, 'round 80 is still stage 3');
  game.state.round = 81; assert.equal(game.stage(), 4); assert.equal(game.calculateRent(8), 200);
  game.state.round = 130; assert.equal(game.stage(), 4); game.state.round = 131; assert.equal(game.stage(), 5); assert.equal(game.calculateRent(8), 250);
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
test('every event resolves, and effects cannot apply twice', async () => {
  for (const [name, cards] of Object.entries(DECKS)) {
    for (let index = 0; index < cards.length; index++) {
      const game = create(4); own(game, 4, 1); game.asset(4).buildings = 2;
      game.state.event = { deck: name, index }; game.state.phase = 'event';
      await game.applyCard(cards[index].effect === 'hijack' ? 4 : cards[index].effect === 'swap' ? 1 : undefined); await drain(game);
      assert.ok(['end', 'offer', 'debt', 'auction', 'event', 'wheel'].includes(game.state.phase), cards[index].title + ' ended in ' + game.state.phase);
      assert.ok(game.state.players.every(player => player.cash >= 0));
      if (game.state.phase !== 'event') await assert.rejects(game.applyCard());
    }
  }
});
test('52 cards per deck are drawn by rarity (70/25/5) and never repeat within 12 draws', () => {
  for (const [name, cards] of Object.entries(DECKS)) {
    const open = cards.filter(card => !card.buffedOnly).length; assert.ok(open >= 69, name + ' has ' + open + ' cards outside Super Buffed');
    for (const tier of Object.keys(RARITY_WEIGHTS)) assert.ok(cards.some(card => card.rarity === tier), name + ' has ' + tier + ' cards');
    assert.ok(cards.every(card => card.title && card.text && card.effect));
    const game = create(2, randomSeed(7)), draws = [], tiers = { common: 0, uncommon: 0, rare: 0 };
    for (let i = 0; i < 3000; i++) { game.drawCard(name); draws.push(game.state.event.index); tiers[cards[draws.at(-1)].rarity]++; }
    draws.forEach((index, i) => assert.ok(!draws.slice(Math.max(0, i - 12), i).includes(index), 'repeat within 12 draws'));
    assert.equal(new Set(draws).size, open, 'every card turns up eventually');
    assert.ok(tiers.common / 3000 > .6 && tiers.common / 3000 < .8, 'common share ' + tiers.common / 3000);
    assert.ok(tiers.rare / 3000 > .02 && tiers.rare / 3000 < .09, 'rare share ' + tiers.rare / 3000);
  }
});
test('rolled, gamble, catch-up and levy cards use the server dice and the game stage', async () => {
  const apply = async (game, deck, title) => {
    game.state.event = { deck, index: DECKS[deck].findIndex(card => card.title === title) }; game.state.phase = 'event';
    await game.applyCard(); await drain(game);
  };
  let game = create(); game.random = () => .99; await apply(game, 'market', 'IPL fever'); assert.equal(game.active.cash, 1500 + 6 * 30);
  assert.ok(game.state.log.some(entry => /Card die for “IPL fever”: Ritesh rolled a 6, so 6 × \$30 = \$180/.test(entry.message)), 'the log says the die belongs to the card');
  assert.deepEqual({ ...game.state.lastDie }, { id: 1, player: 0, value: 6, title: 'IPL fever', tone: 'gain', result: '+$180', detail: '6 × $30' }, 'the card die is recorded so every screen throws the same die');
  const gain = game.state.log.find(entry => /received \$180/.test(entry.message)); assert.equal(gain.tone, 'gain'); assert.equal(gain.player, 0);
  game = create(); game.random = () => 0; await apply(game, 'market', 'Cyclone damage'); assert.equal(game.active.cash, 1470); assert.equal(game.state.jackpot, 115, 'half of a card payment feeds the pot');
  for (const [roll, expected] of [[0, 1400], [.4, 1500], [.99, 1750]]) { game = create(); game.random = () => roll; await apply(game, 'market', 'Cricket bet'); assert.equal(game.active.cash, expected, 'gamble at ' + roll); }
  game = create(); game.state.round = 16; game.random = () => .99; await apply(game, 'market', 'IPL fever'); assert.equal(game.active.cash, 1500 + 6 * 60, 'stage 2 doubles cash cards');
  game = create(); game.state.round = 31; await apply(game, 'economic', 'MSME loan'); assert.equal(game.active.cash, 1800, 'stage 3 triples cash cards');
  game = create(); game.state.round = 81; await apply(game, 'economic', 'MSME loan'); assert.equal(game.active.cash, 1900, 'stage 4 quadruples cash cards');
  game = create(); game.state.round = 131; await apply(game, 'economic', 'MSME loan'); assert.equal(game.active.cash, 2000, 'stage 5 multiplies cash cards by 5');
  game = create(); game.state.round = 16; assert.match(game.describeCard(DECKS.market[1]), /\$160/);
  game = create(); assert.match(game.describeCard(DECKS.market.find(card => card.title === 'Cricket bet')), /1–2 pay \$100, 3–4 nothing, 5–6 win \$250/);
  assert.match(game.describeCard(DECKS.market.find(card => card.title === 'Shark pitch')), /1–3 pay \$150, 4–6 win \$300/);
  assert.match(game.describeCard(DECKS.market.find(card => card.title === 'Sensex gamble')), /1–3 pay \$200, 4 nothing, 5–6 win \$400/);
  game = create(3); game.player(2).cash = 100; game.state.currentPlayer = 2; await apply(game, 'market', 'Jan Dhan support'); assert.equal(game.player(2).cash, 350, 'the poorest player gets the big grant');
  game = create(3); game.player(2).cash = 100; await apply(game, 'market', 'Jan Dhan support'); assert.equal(game.player(0).cash, 1540, 'everyone else gets the small one');
  game = create(3); game.player(1).cash = 3000; await apply(game, 'market', 'Super-rich tax');
  assert.equal(game.player(1).cash, 2850); assert.equal(game.player(0).cash, 1500); assert.equal(game.state.jackpot, 175, 'the levy feeds the jackpot');
  game = create(); own(game, 1); own(game, 2); game.asset(1).buildings = 2; game.asset(2).buildings = 5; await apply(game, 'market', 'Smart City award'); assert.equal(game.active.cash, 1500 + 7 * 20);
});
test('Toll Plaza is $20 per property (min $50, max $300); Income Tax Raid is 10% of cash, 20% for the richest', () => {
  const game = create(); land(game, 5);
  assert.equal(game.active.cash, 1450, 'no property: the $50 minimum'); assert.equal(game.active.stats.taxesPaid, 50);
  [1, 2, 4, 6].forEach(id => own(game, id)); land(game, 5); assert.equal(game.active.cash, 1450 - 80, '4 properties × $20');
  for (let id = 1; id < 40; id++) if (game.board[id].price) own(game, id); land(game, 5); assert.equal(game.active.cash, 1370 - 300, 'capped at $300');
  game.active.cash = 0; land(game, 5); assert.equal(game.active.cash, 0); assert.equal(game.state.phase, 'debt', 'the $50 minimum toll is owed even with no cash');
  const raid = create(); raid.player(1).cash = 3000; land(raid, 25); assert.equal(raid.active.cash, 1350, '10% of $1,500');
  const rich = create(); rich.player(1).cash = 1000; land(rich, 25); assert.equal(rich.active.cash, 1200, 'the richest pays 20%');
  const poor = create(); poor.active.cash = 60; poor.player(1).cash = 3000; land(poor, 25); assert.equal(poor.state.pending?.amount ?? 60 - poor.active.cash, 25, 'at least $25');
  land(raid, 33); assert.equal(raid.active.cash, 1350 + 50, 'Reserve Bank still pays interest');
  const late = create(); late.state.round = 16; land(late, 5); assert.equal(late.active.cash, 1400, 'the toll doubles at stage 2');
});
test('Taj Mahal pays out the jackpot, which taxes, fines and card payments feed', async () => {
  const game = create(); assert.equal(game.state.jackpot, 100);
  land(game, 5); assert.equal(game.state.jackpot, 125, 'half of the $50 toll goes into the pot, the rest leaves the economy');
  game.state.currentPlayer = 1; land(game, 20); assert.equal(game.player(1).cash, 1625); assert.equal(game.state.jackpot, 100, 'the pot resets to $100');
  game.state.currentPlayer = 0; game.sendPlayerToPenalty(game.active); game.state.phase = 'ready'; game.payPenalty(); assert.equal(game.state.jackpot, 125, 'prison fines feed the pot');
  game.state.event = { deck: 'market', index: 1 }; game.state.phase = 'event'; await game.applyCard(); assert.equal(game.state.jackpot, 165, 'so do card payments');
  const rent = create(); own(rent, 1, 1); land(rent, 1); assert.equal(rent.state.jackpot, 100, 'rent between players does not');
});
test('landing on Prison locks you up; a stored Get out of Prison free card is used automatically', async () => {
  const game = create(); land(game, 10);
  assert.equal(game.active.position, 10); assert.equal(game.active.penalty.kind, 'prison'); assert.equal(game.state.phase, 'end');
  const pass = create(); pass.active.jailFree = 1; land(pass, 10);
  assert.equal(pass.active.penalty, null); assert.equal(pass.active.jailFree, 0); assert.equal(pass.active.position, 10);
  const card = create(); card.active.jailFree = 2; card.active.position = 14; card.state.event = { deck: 'market', index: 9 }; card.state.phase = 'event';
  await card.applyCard(); assert.equal(card.active.penalty, null); assert.equal(card.active.jailFree, 1); assert.equal(card.active.position, 14, 'a jail card does not move a pass holder');
  const gain = create(); gain.state.event = { deck: 'market', index: DECKS.market.findIndex(c => c.effect === 'jailfree') }; gain.state.phase = 'event';
  await gain.applyCard(); assert.equal(gain.active.jailFree, 1);
  const doubles = create(2, () => 0); doubles.active.jailFree = 1;
  for (let i = 0; i < 2; i++) { await doubles.rollDice(); if (doubles.state.phase === 'offer') doubles.purchaseProperty(); if (doubles.state.phase === 'event') await doubles.applyCard(); }
  await doubles.rollDice(); assert.equal(doubles.active.penalty, null); assert.equal(doubles.active.jailFree, 0, 'three doubles use the pass too');
});
test('Konark Wheel: weighted slices pay, charge, take from the richest, grant power-ups, give free spins and a chosen free house', () => {
  // r picks a slice by weight: jackpot 3, bad 34, good 14, house 8, small 20, Robin Hood 7, power 8, free 12 (of 106).
  const spin = (r, setup, round) => { const g = create(); if (round) g.state.round = round; setup?.(g); g.random = () => r; land(g, 30); assert.equal(g.state.phase, 'wheel'); g.spinWheel(); return g; };
  assert.equal(BOARD[30].type, 'wheel'); assert.equal(BOARD[30].name, 'Konark Wheel');
  let g = spin(.01); assert.equal(g.active.cash, 2000); assert.equal(g.state.lastWheel.index, 0); assert.equal(g.state.phase, 'end'); assert.match(g.state.lastWheel.outcome, /Won \$500/);
  g = spin(.2); assert.equal(g.active.cash, 1300); assert.equal(g.state.jackpot, 200, 'losses feed the jackpot');
  g = spin(.42); assert.equal(g.active.cash, 1650);
  g = spin(.65); assert.equal(g.active.cash, 1580);
  g = spin(.78); assert.equal(g.active.cash, 1650); assert.equal(g.player(1).cash, 1350, 'Robin Hood: the richest rival pays'); assert.match(g.state.lastWheel.outcome, /Robin Hood/);
  g = spin(.84); { const { POWER_UPS, PERK_CHARGES, PERK_NAMES } = context.MarketWars, key = POWER_UPS[Math.floor(.84 * POWER_UPS.length)]; assert.equal(g.state.phase, 'end'); assert.equal(g.active.perks[key], PERK_CHARGES[key]); assert.ok(g.state.lastWheel.outcome.includes('Power-up: ' + PERK_NAMES[key])); }
  g = spin(.95); assert.equal(g.state.phase, 'wheel', 'a free spin keeps the wheel open'); assert.equal(g.state.wheelFree, 1); assert.match(g.state.lastWheel.outcome, /Free spin/);
  g.random = () => .01; g.spinWheel(); assert.equal(g.active.cash, 2000); assert.equal(g.state.wheelFree, 0, 'a normal result ends the chain');
  g = create(); land(g, 30); g.random = () => .95; for (let i = 0; i < 3; i++) g.spinWheel();
  assert.equal(g.state.wheelFree, 3); assert.equal(g.state.phase, 'wheel'); g.spinWheel();
  assert.notEqual(g.state.lastWheel.label, 'Spin Again', 'after 3 free spins the next result is forced non-free'); assert.equal(g.state.wheelFree, 0);
  // Free house: the player chooses; even building applies, landing there does not.
  g = spin(.53, x => { own(x, 1); own(x, 2); x.asset(1).buildings = 1; });
  assert.equal(g.state.phase, 'freebuild'); assert.deepEqual([...g.freeBuildTargets(g.active).map(space => space.id)], [2]);
  assert.throws(() => g.freeBuild(1), /Choose a property/); assert.throws(() => g.freeBuild(4), /Choose a property/); assert.throws(() => g.spinWheel(), /no wheel/);
  g.freeBuild(2); assert.equal(g.asset(2).buildings, 1); assert.equal(g.active.cash, 1500); assert.equal(g.state.phase, 'end'); assert.throws(() => g.freeBuild(2), /no free house/);
  g = spin(.53); assert.equal(g.active.cash, 1600); assert.match(g.state.lastWheel.outcome, /Nothing to build/);
  g = spin(.01, null, 16); assert.equal(g.active.cash, 2500); g = spin(.01, null, 31); assert.equal(g.active.cash, 3000);
  g = spin(.2, null, 16); assert.equal(g.active.cash, 1100); g = spin(.78, null, 31); assert.equal(g.active.cash, 1950);
  assert.deepEqual([...create().wheelSegments().map(slice => slice.text)], ['Maha Jackpot +$500', 'Tax Notice −$200', 'Diwali Bonus +$150', 'Free House', 'Shagun +$80', 'Robin Hood +$150', 'Power-up', 'Spin Again']);
  assert.throws(() => create().spinWheel(), /no wheel/);
  const poor = create(); poor.active.cash = 50; poor.random = () => .2; land(poor, 30); poor.spinWheel(); assert.equal(poor.state.phase, 'debt', 'a wheel loss can become a debt');
});
test('the wheel averages about zero at every game stage, and rarer slices are less likely', () => {
  const tier = { common: 3, uncommon: 2, rare: 1 }, weights = Object.fromEntries(WHEEL.map(slice => [slice.id, slice.weight]));
  for (const a of WHEEL) for (const b of WHEEL) if (tier[a.tier] > tier[b.tier]) assert.ok(a.weight > b.weight, a.label + ' (' + a.tier + ') must be likelier than ' + b.label + ' (' + b.tier + ')');
  const buildCost = [GROUPS.harbor, GROUPS.canal, GROUPS.garden, GROUPS.studio, GROUPS.metro, GROUPS.tech, GROUPS.ridge, GROUPS.premium].reduce((sum, group) => sum + group.cost, 0) / 8, powerUp = 100;
  const open = WHEEL.filter(slice => slice.kind !== 'free'), total = open.reduce((sum, slice) => sum + slice.weight, 0); // a free spin just spins again
  for (const stage of [1, 2, 3]) {
    const ev = open.reduce((sum, slice) => sum + slice.weight * (slice.kind === 'cash' || slice.kind === 'steal' ? slice.amount * stage : slice.kind === 'pay' ? -slice.amount * stage : slice.kind === 'build' ? buildCost : powerUp), 0) / total;
    assert.ok(Math.abs(ev) <= 15, 'wheel average at stage ' + stage + ' is ' + ev.toFixed(1) + ', outside ±$15');
  }
  // The engine really draws by these weights: 8,000 seeded spins land within 2.5 points of each slice's chance.
  const game = create(2, randomSeed(31)), counts = {}; land(game, 30);
  for (let i = 0; i < 8000; i++) { game.state.phase = 'wheel'; game.state.wheelFree = 0; game.active.cash = 1e6; game.state.pending = null; game.state.payments = []; game.spinWheel(); game.state.phase = 'wheel'; if (game.state.lastWheel) counts[WHEEL[game.state.lastWheel.index].id] = (counts[WHEEL[game.state.lastWheel.index].id] || 0) + 1; }
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  for (const slice of WHEEL) assert.ok(Math.abs((counts[slice.id] || 0) / 8000 - slice.weight / sum) < .025, slice.id + ' share ' + ((counts[slice.id] || 0) / 8000).toFixed(3));
});
test('Fire Sale: under $200 a mortgage pays 25% more, and unmortgaging costs 110% of what was received', () => {
  const game = create(); own(game, 1); own(game, 4); own(game, 2);
  game.mortgageProperty(1); assert.equal(game.active.cash, 1550); assert.equal(game.asset(1).mortgageReceived, 50); assert.equal(game.unmortgageCost(1), 55);
  game.active.cash = 199; game.mortgageProperty(4);
  assert.equal(game.active.cash, 199 + 87); assert.equal(game.asset(4).mortgageReceived, 87); assert.equal(game.unmortgageCost(4), 96, '110% of the $87 received, rounded up');
  game.unmortgageProperty(4); assert.equal(game.active.cash, 190); assert.equal(game.asset(4).mortgageReceived, undefined);
  game.active.cash = 150; game.mortgageProperty(4); game.unmortgageProperty(4); assert.ok(game.active.cash < 150, 'a Fire Sale mortgage and buy-back is never a profit');
  game.active.cash = 200; game.mortgageProperty(2); assert.equal(game.active.cash, 260, 'exactly $200 is not under $200');
  const poor = create(); own(poor, 1); own(poor, 2); poor.active.cash = 100; assert.equal(poor.liquidatable(poor.active), 100 + 75 + 62, 'liquidation value counts the bonus only while cash is under $200');
  const legacy = create(); own(legacy, 1); legacy.asset(1).mortgaged = true; assert.equal(legacy.unmortgageCost(1), 55, 'older mortgages fall back to the standard value');
});
test('Bonus Salary pays Launch money twice for 2 passes; Nitro Dice keeps the best two of three dice for 2 rolls', async () => {
  const game = create(); game.active.perks.launch = 2; game.active.position = 38;
  await game.movePlayer(3, { resolve: false }); assert.equal(game.active.cash, 1500 + 400); assert.equal(game.active.perks.launch, 1);
  game.active.position = 39; await game.movePlayer(1, { resolve: false }); assert.equal(game.active.cash, 1500 + 800, 'landing on Gateway of India counts as a pass'); assert.equal(game.active.perks.launch, 0);
  assert.ok(game.state.log.some(entry => /Bonus Salary has run out/.test(entry.message)));
  game.active.position = 39; await game.movePlayer(1, { resolve: false }); assert.equal(game.active.cash, 1500 + 1000, 'back to the normal $200');
  const roller = create(); roller.active.perks.tailwind = 2; const draws = [.5, .34, 0, .4, .4, 0, .2, .2]; let k = 0; roller.random = () => draws[k++] ?? .3;
  await roller.rollDice(); await drain(roller);
  assert.deepEqual([...roller.state.dice], [4, 3], 'the best two of 4, 3, 1'); assert.equal(roller.state.droppedDie, 1, 'the dropped die is kept so the screen can show all three'); assert.equal(roller.active.perks.tailwind, 1); assert.ok(roller.state.log.some(entry => /drops the lowest \(1\)/.test(entry.message)));
  roller.state.phase = 'ready'; roller.state.hasRolled = false;
  await roller.rollDice(); await drain(roller);
  assert.deepEqual([...roller.state.dice], [3, 3], 'doubles are judged on the kept two'); assert.equal(roller.state.extraRoll, true); assert.equal(roller.active.perks.tailwind, 0);
  assert.ok(roller.state.log.some(entry => /Nitro Dice has run out/.test(entry.message)));
  roller.state.phase = 'ready'; roller.state.extraRoll = false; k = 0; draws.splice(0, draws.length, .2, .5); await roller.rollDice(); await drain(roller);
  assert.deepEqual([...roller.state.dice], [2, 4], 'with no Nitro Dice left, two dice again'); assert.equal(roller.state.droppedDie, null);
});
test('Neta Pass, Rent Boom and Ulta Rent: charges are spent only when rent is really due, and they run out', async () => {
  // Neta Pass: half rent (rounded up to $5) on the next 3 landings
  let game = create(); own(game, 1, 1); own(game, 2, 1); own(game, 4, 0); own(game, 6, 1); own(game, 8, 1);
  await playCard(game, 'market', 'Neta Pass'); assert.equal(game.active.perks.shield, 3);
  land(game, 4); assert.equal(game.active.perks.shield, 3, 'your own property owes no rent and costs no charge');
  game.asset(6).mortgaged = true; land(game, 6); assert.equal(game.active.perks.shield, 3, 'a mortgaged property owes no rent either');
  land(game, 1); assert.equal(game.active.cash, 1490, 'a $16 rent is halved to $10'); assert.equal(game.active.perks.shield, 2); assert.equal(game.state.phase, 'end');
  land(game, 8); assert.equal(game.active.cash, 1465, 'stations count too: $50 halved'); assert.equal(game.active.perks.shield, 1);
  land(game, 1); assert.equal(game.active.cash, 1455); assert.equal(game.active.perks.shield, 0);
  assert.ok(game.state.log.some(entry => /Neta Pass has run out/.test(entry.message)));
  land(game, 1); assert.equal(game.active.cash, 1439, 'after the pass runs out, full rent is paid again');
  // Rent Boom: the owner collects double, capped at $500 and never reducing a rent already above $500
  game = create(); own(game, 1, 0); own(game, 2, 0); own(game, 4, 0); game.asset(4).buildings = 2; own(game, 39, 0); game.asset(39).buildings = 5;
  await playCard(game, 'market', 'Rent Boom'); assert.equal(game.player(0).perks.doubler, 2);
  game.state.currentPlayer = 1; land(game, 1); assert.equal(game.player(1).cash, 1468, 'rent $16 doubled to $32');
  land(game, 4); assert.equal(game.player(1).cash, 1468 - 500, '$288 doubles to $576 but the cap holds it at $500'); assert.equal(game.player(0).perks.doubler, 0);
  land(game, 4); assert.equal(game.player(1).cash, 1468 - 500 - 288, 'no charges left: normal rent');
  game = create(); own(game, 39, 0); game.asset(39).buildings = 5; game.player(0).perks.doubler = 1; game.state.currentPlayer = 1; game.player(1).cash = 20000; land(game, 39);
  assert.equal(game.player(1).cash, 20000 - 8400, 'a rent already above $500 is never reduced'); assert.equal(game.player(0).perks.doubler, 0);
  // Ulta Rent: the owner pays the visitor, 2 landings
  game = create(); own(game, 1, 1); own(game, 2, 1); await playCard(game, 'economic', 'Ulta Rent'); assert.equal(game.active.perks.reversal, 2);
  land(game, 1); assert.equal(game.active.cash, 1516); assert.equal(game.player(1).cash, 1484, 'the owner pays the visitor');
  land(game, 2); assert.equal(game.active.cash, 1516 + 20); assert.equal(game.active.perks.reversal, 0);
  land(game, 1); assert.equal(game.active.cash, 1536 - 16, 'after 2 landings the rent flows normally again');
  game = create(); own(game, 1, 1); game.active.perks.reversal = 1; game.player(1).cash = 3; land(game, 1);
  assert.equal(game.state.phase, 'debt'); assert.equal(game.state.pending.payer, 1, 'the owner can end up owing the visitor');
  // Order: Ulta Rent first, then Neta Pass; Rent Boom applies to whoever receives rent
  game = create(); own(game, 1, 1); Object.assign(game.active.perks, { reversal: 1, shield: 1, doubler: 1 }); land(game, 1);
  assert.equal(game.active.cash, 1516, 'Ulta Rent: the owner pays the visitor, doubled by the visitor’s Rent Boom'); assert.deepEqual(['launch', 'tailwind', 'shield', 'doubler', 'reversal'].map(key => game.active.perks[key]), [0, 0, 1, 0, 0]);
  land(game, 1); assert.equal(game.active.cash, 1511, 'then Neta Pass halves the $8 rent to $5'); assert.equal(game.active.perks.shield, 0);
  game = create(); own(game, 1, 1); game.player(1).perks.doubler = 1; game.active.perks.shield = 1; land(game, 1);
  assert.equal(game.active.cash, 1490, 'a halved rent can still be doubled by the owner’s Rent Boom'); assert.equal(game.player(1).perks.doubler, 0);
});
test('Roll Again: the drawer rolls straight away like an extra roll, and the new landing resolves normally', async () => {
  const game = create(2, () => .4); game.active.position = 14;
  await playCard(game, 'economic', 'Lucky charm');
  assert.equal(game.state.extraRoll, true); assert.equal(game.state.phase, 'end'); assert.equal(game.canRoll(), true);
  assert.throws(() => game.nextTurn(), /Roll again/);
  let n = 0; game.random = () => [0, .2][n++ % 2]; await game.rollDice(); await drain(game);
  assert.equal(game.state.extraRoll, false); assert.equal(game.active.position, 17); assert.equal(game.state.phase, 'event', 'a non-doubles landing resolves, not a waypoint');
});
test('City Events: Boom, Recession and Audit, never the same twice in a row, announced a round ahead, 2 rounds long', () => {
  const advance = (game, rounds) => { for (let i = 0; i < rounds * game.state.players.filter(player => !player.bankrupt).length; i++) { game.state.phase = 'end'; game.state.extraRoll = false; game.nextTurn(); } };
  let game = create(); game.random = () => .1; own(game, 1); advance(game, 3);
  assert.equal(game.state.round, 4); assert.deepEqual({ ...game.state.city.upcoming }, { kind: 'boom', round: 5 }); assert.ok(game.state.log.some(entry => /Coming next round: Property Boom/.test(entry.message)));
  assert.deepEqual([...game.cityLines()].filter(line => !/single-die/i.test(line)), ['Next round: Property Boom (rents +50%).']); assert.equal(game.calculateRent(1), 8);
  advance(game, 1); assert.equal(game.state.round, 5); assert.deepEqual({ ...game.state.city.active }, { kind: 'boom', until: 6 }); assert.equal(game.calculateRent(1), 12, 'rents +50%');
  assert.deepEqual([...game.cityLines()].filter(line => !/single-die/i.test(line)), ['Property Boom (rents +50%), 2 rounds left.']);
  advance(game, 1); assert.equal(game.state.city.active.kind, 'boom', 'still active in round 6'); assert.deepEqual([...game.cityLines()].filter(line => !/single-die/i.test(line)).slice(0, 1), ['Property Boom (rents +50%), 1 round left.']);
  advance(game, 1); assert.equal(game.state.city.active, null, 'over in round 7'); assert.equal(game.calculateRent(1), 8);
  // never the same event twice in a row, even when the dice would pick it
  game = create(2, randomSeed(9)); const kinds = [];
  for (let round = 1; round < 60; round++) { advance(game, 1); const up = game.state.city.upcoming; if (up && !kinds.some(entry => entry.round === up.round)) kinds.push(up); }
  assert.ok(kinds.length >= 10); kinds.forEach((entry, i) => { if (i) assert.notEqual(entry.kind, kinds[i - 1].kind, 'rounds ' + kinds[i - 1].round + ' and ' + entry.round); });
  assert.deepEqual(new Set(kinds.map(entry => entry.kind)).size, 3, 'all three events turn up');
  // Recession: building costs −30% and every rent −25%
  game = create(); game.random = () => .4; own(game, 1); own(game, 2); advance(game, 4);
  assert.equal(game.state.city.active.kind, 'recession'); assert.equal(game.buildingCost(game.active, BOARD[1]), 35, 'building costs −30%'); assert.equal(game.calculateRent(1), 12, 'a $16 rent falls 25% to $12');
  assert.equal(game.finances(game.active).buildingValue, 0); game.asset(1).buildings = 1; assert.equal(game.finances(game.active).buildingValue, 50, 'net worth ignores the discount');
  // The City Event multiplier is applied first, then Doubler, its $400 cap, then Reversal or Shield
  game = create(); game.random = () => .4; own(game, 4, 0); own(game, 6, 0); game.asset(4).buildings = 1; advance(game, 4); game.player(0).perks.doubler = 1;
  assert.equal(game.calculateRent(4), 72, '$96 less 25%'); game.state.currentPlayer = 1; land(game, 4); assert.equal(game.player(1).cash, 1500 - 144, 'doubled after the recession cut (not capped first)');
  // Audit: instant, the richest pays the poorest 30% of their cash; ties go to the lower seat
  game = create(); game.random = () => .9; game.player(0).cash = 2000; game.player(1).cash = 1000; advance(game, 4);
  assert.equal(game.state.city.active, null); assert.equal(game.player(0).cash, 1400); assert.equal(game.player(1).cash, 1600, 'the richest pays the poorest 30% of their cash');
  game = create(3); game.random = () => .9; [game.player(0).cash, game.player(1).cash, game.player(2).cash] = [1500, 1500, 1000]; advance(game, 4);
  assert.deepEqual([game.player(0).cash, game.player(1).cash, game.player(2).cash], [1050, 1500, 1450], 'tied richest: the lower seat pays');
  game = create(3); game.random = () => .9; [game.player(0).cash, game.player(1).cash, game.player(2).cash] = [2000, 1500, 1500]; advance(game, 4);
  assert.deepEqual([game.player(0).cash, game.player(1).cash, game.player(2).cash], [1400, 2100, 1500], 'tied poorest: the lower seat receives');
  game = create(3); game.random = () => .9; advance(game, 4); assert.deepEqual([game.player(0).cash, game.player(1).cash, game.player(2).cash], [1500, 1500, 1500], 'everyone level: nothing to redistribute');
  game = create(); game.random = () => .9; game.player(0).cash = 60; game.player(1).cash = 40; advance(game, 4); assert.equal(game.player(0).cash, 42, '30% of $60'); assert.equal(game.player(1).cash, 58);
  game = create(3); game.random = () => .9; advance(game, 4); assert.equal(game.state.round, 5, 'a round is every player taking a turn');
  game = create(3); game.player(2).bankrupt = true; game.random = () => .1; for (let i = 0; i < 8; i++) { game.state.phase = 'end'; game.nextTurn(); } assert.equal(game.state.round, 5, 'bankrupt players are skipped without changing the count');
});
test('saves from before the card and wheel update still load', () => {
  const s = JSON.parse(create().serialize());
  s.decks = { market: { order: Array.from({ length: 15 }, (_, i) => i), cursor: 3 }, economic: { order: Array.from({ length: 15 }, (_, i) => i), cursor: 0 } };
  delete s.round; delete s.jackpot; delete s.city; delete s.lastWheel; s.players.forEach(player => delete player.jailFree);
  s.turn = 9; s.phase = 'event'; s.event = { deck: 'economic', index: 4 };
  const game = Game.restore(JSON.stringify(s));
  assert.equal(JSON.stringify(game.state.decks.market), '{"recent":[]}'); assert.equal(game.state.round, 5); assert.equal(game.state.wheelFree, 0);
  assert.ok(Object.values(game.state.players[0].perks).every(value => value === 0) && Object.keys(game.state.players[0].perks).length === context.MarketWars.POWER_UPS.length, 'older saves hold no power-up charges'); assert.equal(game.state.jackpot, 100);
  assert.equal(JSON.stringify(game.state.city), '{"upcoming":null,"active":null,"last":null}'); assert.ok(game.state.players.every(player => player.jailFree === 0));
  assert.equal(DECKS.economic[4].title, 'Green energy rebate', 'the original 15 cards keep their positions');
  const wheelSave = JSON.parse(create().serialize()); wheelSave.phase = 'wheel'; assert.equal(Game.restore(JSON.stringify(wheelSave)).state.phase, 'wheel', 'a card can open the wheel anywhere on the board');
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
test('after five failed Prison rolls the player leaves for free and moves the last roll', async () => {
  let roll = 0; const early = create(2, () => (roll++ % 2 ? .2 : 0));
  early.sendPlayerToPenalty(early.active); early.active.penalty.attempts = 3; early.state.phase = 'ready'; await early.rollDice(); await drain(early);
  assert.deepEqual({ ...early.active.penalty }, { kind: 'prison', attempts: 4 }, 'a fourth failed roll still leaves the player inside'); assert.equal(early.active.position, 10);
  roll = 0; const game = create(2, () => (roll++ % 2 ? .2 : 0));
  game.sendPlayerToPenalty(game.active); game.active.penalty.attempts = 4; game.active.cash = 0;
  game.state.phase = 'ready'; await game.rollDice(); await drain(game);
  assert.equal(game.active.penalty, null, 'three wasted turns are enough: no fine'); assert.equal(game.active.cash, 0, 'nothing is paid');
  assert.equal(game.active.position, 13, 'the last roll (1 + 2) is moved'); assert.equal(game.state.phase, 'offer');
  assert.ok(game.state.log.some(entry => /leaves Prison for free/.test(entry.message)));
});
test('an owner in Prison collects no rent', () => {
  const game = create(); own(game, 1, 1); game.player(1).penalty = { kind: 'prison', attempts: 0 }; game.player(1).position = 10;
  land(game, 1); assert.equal(game.active.cash, 1500, 'no rent while the owner is inside'); assert.equal(game.player(1).cash, 1500);
  assert.ok(game.state.log.some(entry => /is in Prison, so no rent is collected/.test(entry.message)));
  game.player(1).penalty = null; game.state.phase = 'moving'; game.resolveSpace(); assert.equal(game.active.cash, 1500 - 8, 'once free, rent is collected again');
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
test('a player in debt can leave (assets go to the creditor) or auction a property to raise the cash', () => {
  let game = create(3); own(game, 1, 1); own(game, 3 + 1, 0); game.player(0).cash = 5; land(game, 1);
  assert.equal(game.state.phase, 'debt'); assert.equal(game.state.pending.payer, 0);
  game.forfeit(0); assert.equal(game.player(0).bankrupt, true); assert.equal(game.asset(4).owner, 1, 'the property goes to the player owed');
  assert.equal(game.player(1).cash, 1505, 'and so does the cash'); assert.equal(game.state.pending, null); assert.notEqual(game.state.currentPlayer, 0, 'the turn passes on');
  game = create(3); own(game, 1, 1); own(game, 4, 0); game.player(0).cash = 5; land(game, 1);
  game.startAuction(4); assert.equal(game.state.phase, 'auction', 'an owner in debt can auction on their turn');
  game.auctionBid(10); while (game.state.auction) game.auctionPass();
  assert.equal(game.player(0).cash, 15, 'the winning bid is paid to the seller');
  assert.equal(game.state.phase, 'debt', 'the payment screen returns after the auction');
});
test('every 3rd round is a single-die round: one die, no doubles, and only a 6 leaves Prison', async () => {
  const at = (round, draws) => { const g = create(); g.state.round = round; let k = 0; g.random = () => draws[k++] ?? .3; return g; };
  assert.deepEqual([1, 2, 3, 4, 6, 9].map(round => create().singleDieRound(round)), [false, false, true, false, true, true]);
  let g = at(3, [.5]); await g.rollDice(); await drain(g);
  assert.deepEqual([...g.state.dice], [4], 'one die'); assert.equal(g.active.position, 4); assert.equal(g.state.extraRoll, false, 'no doubles with one die');
  g = at(3, [.99]); g.active.penalty = { kind: 'prison', attempts: 0 }; g.active.position = 10; await g.rollDice(); await drain(g);
  assert.equal(g.active.penalty, null, 'a 6 walks out'); assert.equal(g.active.position, 16);
  g = at(3, [.7]); g.active.penalty = { kind: 'prison', attempts: 0 }; g.active.position = 10; await g.rollDice(); await drain(g);
  assert.equal(g.active.penalty.attempts, 1, 'a 5 stays inside');
  g = at(3, [.5, .99]); g.active.perks.tailwind = 1; await g.rollDice(); await drain(g);
  assert.deepEqual([...g.state.dice], [6], 'Nitro Dice keeps the better of two'); assert.equal(g.state.droppedDie, 4);
  g = create(); g.state.round = 2; assert.ok(g.cityLines().some(line => /Next round: single-die round/.test(line)), 'announced a round ahead');
  g.state.round = 3; assert.ok(g.cityLines().some(line => /Single-die round/.test(line)));
  const saved = create(); saved.state.dice = [5]; assert.deepEqual([...Game.restore(saved.serialize()).state.dice], [5], 'a one-die save loads');
});
test('Classic Super Buffed: $5,000 start, $3,000 Launch, build to the tower in one visit, flat $5,000 jail, 6 tries', async () => {
  const make = (random = () => .4) => new Game(players.slice(0, 2), {}, { mode: 'buffed', random, wait: async () => {} });
  let game = make(); assert.equal(game.state.mode, 'buffed'); assert.deepEqual(game.state.players.map(p => p.cash), [5000, 5000]); assert.equal(game.board.length, 40);
  game.active.position = 39; await game.movePlayer(1, { resolve: false }); assert.equal(game.active.cash, 8000, 'passing Gateway of India pays $3,000');
  game = make(); own(game, 1); own(game, 2);
  for (let level = 1; level <= 5; level++) { assert.equal(build(game, 1), undefined); game.state.turn--; }
  assert.equal(game.asset(1).buildings, 5, 'one property goes all the way to a tower'); assert.equal(game.asset(2).buildings, 0, 'no even-building rule');
  game = make(); own(game, 1); Object.assign(game.state, { phase: 'end', hasRolled: true, extraRoll: false }); game.active.position = 1;
  game.buildStructure(1); game.buildStructure(1); game.buildStructure(1); assert.equal(game.asset(1).buildings, 3, 'several levels on the same landing');
  game.sellBuilding(1); assert.equal(game.asset(1).buildings, 2);
  game = make(); game.asset(1).owner = 0; game.asset(1).ready = false; Object.assign(game.state, { phase: 'end', hasRolled: true }); game.active.position = 1;
  assert.match(game.buildReason(game.active, 1), /again/, 'a just-bought property still needs another landing first');
  game = make(); game.state.round = 100; assert.equal(game.prisonFine(), 5000, 'the jail fine is a flat $5,000, even late');
  assert.equal(game.prisonTries(), 6);
  game = make(() => 0); game.active.penalty = { kind: 'prison', attempts: 5 }; game.active.position = 10; game.state.phase = 'ready';
  let k = 0; const draws = [0, .2]; game.random = () => draws[k++] ?? .5; await game.rollDice(); await drain(game); await game.chooseCoupon(0); await drain(game);
  assert.equal(game.active.penalty, null, 'after 6 failed rolls you walk out free');
  assert.equal(Game.restore(make().serialize()).state.mode, 'buffed', 'a saved game keeps its mode');
  assert.equal(new Game(players.slice(0, 2), {}, { mode: 'buffed', sides: 5 }).state.mode, undefined, 'only on the square board');
  const plain = create(); assert.equal(plain.state.mode, undefined); assert.equal(plain.prisonTries(), 5);
});
test('Hostile Takeover: Super Buffed only; seize any rival property with its buildings, then land on it again to build', async () => {
  const index = DECKS.market.findIndex(card => card.effect === 'hijack');
  assert.equal(DECKS.market[index].title, 'Hostile Takeover');
  const plain = create(); for (let i = 0; i < 300; i++) { plain.drawCard('market'); assert.notEqual(plain.state.event.index, index, 'never drawn outside Super Buffed'); plain.state.phase = 'end'; }
  const make = () => new Game(players.slice(0, 3), {}, { mode: 'buffed', random: () => .4, wait: async () => {} });
  let game = make(); own(game, 1, 1); own(game, 39, 2); game.asset(39).buildings = 3; own(game, 3 + 3, 0);
  assert.deepEqual([...game.hijackTargets().map(space => space.id)], [39, 1], 'rival properties, highest rent first; never your own');
  game.state.event = { deck: 'market', index }; game.state.phase = 'event';
  await assert.rejects(() => game.applyCard(), /Choose a rival property/); await assert.rejects(() => game.applyCard(6), /Choose a rival property/);
  await game.applyCard(39); assert.equal(game.asset(39).owner, 0); assert.equal(game.asset(39).buildings, 3, 'buildings come too'); assert.equal(game.asset(39).ready, false, 'land on it again before building');
  assert.equal(game.state.phase, 'end'); assert.ok(game.state.log.some(entry => /Hostile Takeover! Ritesh seizes Marine Drive with its buildings from/.test(entry.message)));
  game = make(); game.state.event = { deck: 'market', index }; game.state.phase = 'event'; await game.applyCard(); assert.equal(game.state.phase, 'end', 'nothing to seize: the card passes');
});
test('Grand Swap: Super Buffed only; swap every property (buildings too) with a chosen rival, cash stays', async () => {
  const index = DECKS.economic.findIndex(card => card.effect === 'swap');
  assert.equal(DECKS.economic[index].title, 'Grand Swap'); assert.equal(DECKS.economic[index].rarity, 'rare');
  const make = () => new Game(players.slice(0, 3), {}, { mode: 'buffed', random: () => .4, wait: async () => {} });
  const game = make(); own(game, 1, 0); own(game, 39, 2); own(game, 37, 2); game.asset(39).buildings = 4; game.player(2).cash = 9000;
  game.state.event = { deck: 'economic', index }; game.state.phase = 'event';
  await assert.rejects(() => game.applyCard(0), /Choose a rival/);
  await game.applyCard(2);
  assert.deepEqual([game.asset(1).owner, game.asset(39).owner, game.asset(37).owner], [2, 0, 0], 'every property changes hands');
  assert.equal(game.asset(39).buildings, 4, 'with its buildings'); assert.equal(game.asset(39).ready, false);
  assert.deepEqual([game.player(0).cash, game.player(2).cash], [5000, 9000], 'cash stays put');
});
test('Today’s Buff: the date picks one twist (Wildcard picks two); a game keeps its twist', () => {
  const day = 86400000, start = Date.UTC(2026, 9, 26) - 5.5 * 3600000;
  const week = Array.from({ length: 14 }, (_, i) => context.MarketWars.twistsFor(start + i * day));
  assert.equal(new Set(week.filter(list => list.length === 1).map(list => list[0])).size, 13, '13 single twists in a fortnight');
  const wild = week.find(list => list.length === 2); assert.ok(wild && wild[0] !== wild[1], 'Wildcard is two different twists');
  assert.deepEqual(context.MarketWars.twistsFor(start + 3600000), context.MarketWars.twistsFor(start + 20 * 3600000), 'the same all day');
  const game = new Game(players.slice(0, 2), {}, { mode: 'buffed', twists: ['monsoon'] });
  assert.deepEqual([...Game.restore(game.serialize()).state.twists], ['monsoon']); assert.deepEqual(create().state.twists, undefined, 'no twists outside Super Buffed');
  assert.ok(game.cityLines().some(line => /Today’s Buff: Monsoon/.test(line)));
});
test('the 14 twists each change the game as described', async () => {
  const make = (twists, random = () => .4, count = 2) => new Game(players.slice(0, count), {}, { mode: 'buffed', twists, random, wait: async () => {} });
  const roll = async (game, draws) => { let k = 0; game.random = () => draws[k++] ?? .4; game.state.phase = 'ready'; game.state.hasRolled = false; await game.rollDice(); await drain(game); if (game.state.phase === 'coupon') { await game.chooseCoupon(0); await drain(game); } };
  // Gold Rush
  let g = make(['goldrush']); own(g, 1, 1); land(g, 1); assert.equal(g.state.jackpot, 200, 'rent adds $100 to the pot');
  // Mega Dice: three dice; three of a kind goes to the Taj Mahal; a pair frees a prisoner
  g = make(['megadice']); await roll(g, [.1, .2, .5]); assert.equal(g.state.dice.length, 3); assert.equal(g.active.position, 7, '1 + 2 + 4');
  g = make(['megadice']); await roll(g, [.5, .5, .5]); assert.equal(g.active.position, 20, 'three of a kind jumps to the Taj Mahal');
  g = make(['megadice']); g.active.penalty = { kind: 'prison', attempts: 0 }; g.active.position = 10; await roll(g, [.1, .1, .5]); assert.equal(g.active.penalty, null);
  // Monsoon
  g = make(['monsoon']); own(g, 1, 1); assert.equal(g.calculateRent(1), 4); assert.equal(g.buildingCost(g.active, BOARD[1]), 25);
  // Diwali Dhamaka
  g = make(['dhamaka']); await playCard(g, 'market', 'Startup unicorn'); assert.equal(g.active.cash, 5300, 'card wins doubled');
  // Double Trouble
  g = make(['doubletrouble']); await roll(g, [.5, .5]); assert.equal(g.active.cash, 5500, 'doubles pay $500');
  g = make(['doubletrouble']); g.state.doublesCount = 2; await roll(g, [0, 0]); assert.equal(g.active.penalty, null, 'three doubles: no jail');
  // Tower Rush
  g = make(['towerrush']); own(g, 39); g.asset(39).ready = false; g.state.phase = 'ready';
  assert.equal(g.buildReason(g.active, 39), '', 'build without landing'); g.buildStructure(39); g.buildStructure(39); assert.equal(g.asset(39).buildings, 2);
  // Tax Holiday
  g = make(['taxholiday']); land(g, 5); land(g, 25); assert.equal(g.active.cash, 5000);
  // Robin Hood Day: every 5 rounds 30% of the richest player's cash goes to the poorest
  g = make(['robinhood']); g.player(0).cash = 10000; g.player(1).cash = 1000; g.state.round = 4; g.advanceRound();
  assert.deepEqual([g.player(0).cash, g.player(1).cash], [7000, 4000]);
  // Railway Boom
  g = make(['railway']); own(g, 8, 1); assert.equal(g.calculateRent(8), 150);
  // Jackpot Fever
  g = make(['jackpotfever']); assert.equal(g.state.jackpot, 5000); g.state.currentPlayer = 1; land(g, 20); assert.equal(g.player(1).cash, 10000); assert.equal(g.state.jackpot, 5000);
  // Bollywood Night: a surprise $0–$5,000 on top of the $3,000
  g = make(['bollywood'], () => .5); g.active.position = 39; await g.movePlayer(1, { resolve: false }); assert.equal(g.active.cash, 5000 + 3000 + 2500);
  // Speed Run: one die, plus 6 spaces
  g = make(['speedrun']); await roll(g, [.5]); assert.deepEqual([...g.state.dice], [4]); assert.equal(g.active.position, 10, '4 + 6 spaces');
  // Mafia Mode: the player with the most properties collects double
  g = make(['mafia']); own(g, 1, 1); own(g, 3 + 1, 1); assert.equal(g.calculateRent(1), 16); own(g, 6, 0); own(g, 7, 0); own(g, 9, 0); assert.equal(g.calculateRent(1), 8);
});
test('Coupons (Super Buffed): two pieces each; after rolling the player picks coupon A or B to move; jail is per coupon', async () => {
  const make = () => new Game(players.slice(0, 2), {}, { mode: 'buffed', random: () => .4, wait: async () => {} });
  let game = make(); assert.deepEqual({ ...game.active.alt }, { position: 0, penalty: null }); assert.equal(game.active.coupon, 0);
  assert.equal(create().active.alt, undefined, 'Classic has one piece');
  let k = 0; game.random = () => [.5, .2][k++] ?? .3; await game.rollDice(); await drain(game); // 4 + 2 = 6
  assert.equal(game.state.phase, 'coupon', 'the roll waits for a coupon'); assert.equal(game.active.position, 0);
  await assert.rejects(() => game.chooseCoupon(2), /coupon A or B/);
  await game.chooseCoupon(1); await drain(game);
  assert.equal(game.active.coupon, 1, 'coupon B moved'); assert.equal(game.active.position, 6); assert.equal(game.active.alt.position, 0, 'coupon A stayed on Gateway of India');
  assert.equal(game.couponLabel(game.active), 'B'); assert.equal(game.couponLabel(game.active, false), 'A');
  await assert.rejects(() => game.chooseCoupon(0), /no roll waiting/);
  // A jailed coupon does not block the other one.
  game = make(); game.active.penalty = { kind: 'prison', attempts: 0 }; game.active.position = 10;
  k = 0; game.random = () => [.1, .3][k++] ?? .3; await game.rollDice(); await drain(game); // 1 + 2, no doubles
  await game.chooseCoupon(1); await drain(game);
  assert.equal(game.active.position, 3, 'the free coupon moves 3'); assert.equal(game.active.alt.penalty.kind, 'prison', 'the jailed coupon stays in jail'); assert.equal(game.active.alt.penalty.attempts, 1, 'and waits one turn');
  const saved = Game.restore(game.serialize()); assert.equal(saved.active.alt.position, 10); assert.equal(saved.active.coupon, 1);
  // Picking the jailed coupon pays $5,000 at once; it stays put this turn and is free next turn.
  game = make(); game.active.penalty = { kind: 'prison', attempts: 0 }; game.active.position = 10;
  k = 0; game.random = () => [.1, .3][k++] ?? .3; await game.rollDice(); await drain(game);
  await game.chooseCoupon(0); await drain(game);
  assert.equal(game.player(0).cash, 0, '$5,000 debited'); assert.equal(game.player(0).penalty, null, 'released'); assert.equal(game.player(0).position, 10, 'no move this turn');
  // Left alone, a jailed coupon walks free after 8 turns.
  game = make(); game.active.alt.penalty = { kind: 'prison', attempts: 7 }; game.active.alt.position = 10;
  k = 0; game.random = () => [.1, .3][k++] ?? .3; await game.rollDice(); await drain(game);
  await game.chooseCoupon(0); await drain(game); assert.equal(game.player(0).alt.penalty, null, 'free after 8 turns');
  // Doubles free a jailed coupon for nothing, and it moves the roll at once.
  game = make(); game.active.penalty = { kind: 'prison', attempts: 0 }; game.active.position = 10;
  k = 0; game.random = () => [.5, .5][k++] ?? .3; await game.rollDice(); await drain(game); // 4 + 4
  assert.equal(game.rollFreesCoupon(), true, 'doubles free a jailed coupon');
  await game.chooseCoupon(0); await drain(game);
  assert.equal(game.player(0).penalty, null, 'released by the doubles'); assert.equal(game.player(0).position, 18, 'and moved 8'); assert.equal(game.player(0).cash, 5000, 'no fine');
  // A single-die 6 frees it too; an ordinary roll does not.
  game = make(); game.state.phase = 'coupon'; game.state.dice = [6]; game.state.rolled = { single: true, total: 6, doubles: false, pair: false, triple: false };
  assert.equal(game.rollFreesCoupon(), true, 'a 6 in a single-die round');
  game.state.dice = [5]; game.state.rolled = { single: true, total: 5, doubles: false, pair: false, triple: false };
  assert.equal(game.rollFreesCoupon(), false, 'a 5 does not');
  game.state.dice = [1, 2]; game.state.rolled = { single: false, total: 3, doubles: false, pair: false, triple: false };
  assert.equal(game.rollFreesCoupon(), false, 'an ordinary roll does not');
});
test('the 20 new power-ups each work once per charge', async () => {
  const give = (game, key, n = 1) => { game.active.perks[key] = n; return game; };
  let g = give(create(), 'discount'); g.state.offer = 1; g.state.phase = 'offer'; g.purchaseProperty(); assert.equal(g.active.cash, 1500 - 70, 'Bargain Hunter: 30% off'); assert.equal(g.active.perks.discount, 0);
  g = give(create(), 'builder'); own(g, 1); build(g, 1); assert.equal(g.active.cash, 1475, 'Mason’s Guild: half-price level');
  g = give(create(), 'taxfree'); land(g, 5); assert.equal(g.active.cash, 1500, 'Tax Shelter');
  g = give(create(), 'magnet'); g.active.position = 39; await g.movePlayer(1, { resolve: false }); assert.equal(g.active.cash, 1750); assert.equal(g.player(1).cash, 1450, 'Cash Magnet');
  g = give(create(2, () => .4), 'lucky'); { let k = 0; g.random = () => [.4, .5][k++] ?? .4; } await g.rollDice(); await drain(g); assert.ok(g.state.log.some(entry => /Lucky Seven/.test(entry.message)), 'a 3 + 4 pays');
  g = give(create(), 'reroll'); { let k = 0; g.random = () => [0, 0, .9, .9][k++] ?? .4; } await g.rollDice(); await drain(g); assert.deepEqual([...g.state.dice], [6, 6], 'Second Chance rerolls 1 + 1');
  g = give(create(), 'insurance'); await playCard(g, 'market', 'Monsoon leak'); assert.equal(g.active.cash, 1460, 'Insurance Policy halves $80');
  g = give(create(), 'interest'); land(g, 33); assert.equal(g.active.cash, 1650, 'FD Bonus: triple interest');
  g = give(create(), 'jackpot'); land(g, 20); assert.equal(g.active.cash, 1700, 'Jackpot Hunter: double pot');
  g = give(create(), 'cardsharp'); await playCard(g, 'market', 'Startup unicorn'); assert.equal(g.active.cash, 1800, 'Card Sharp: $150 doubled');
  g = create(); own(g, 1, 1); g.player(1).perks.collector = 1; land(g, 1); assert.equal(g.player(1).cash, 1608, 'Toll Collector: +$100');
  g = give(create(), 'ghost'); own(g, 1, 1); land(g, 1); assert.equal(g.active.cash, 1500, 'Ghost Mode: no rent');
  g = create(); g.player(1).perks.stimulus = 1; g.state.phase = 'end'; g.nextTurn(); assert.equal(g.player(1).cash, 1600, 'Startup Fund');
  g = give(create(), 'compound'); g.active.cash = 2000; g.active.position = 39; await g.movePlayer(1, { resolve: false }); assert.equal(g.active.cash, 2000 + 200 + 220, 'Compound Interest: 10% after Launch money');
  g = give(create(), 'wheelie'); g.random = () => .2; land(g, 30); g.spinWheel(); assert.equal(g.active.cash, 1700, 'Wheel Master turns −$200 into +$200');
  g = give(create(), 'turbo'); { let k = 0; g.random = () => [.1, .3][k++] ?? .4; } await g.rollDice(); await drain(g); assert.equal(g.active.position, 6, 'Turbo Boots: 3 + 3');
  g = give(create(), 'rocket'); { let k = 0; g.random = () => [.1, .3][k++] ?? .4; } await g.rollDice(); await drain(g); assert.equal(g.active.position, 9, 'Rocket Fuel: 3 + 6');
  g = give(create(), 'vip'); land(g, 10); assert.equal(g.active.penalty, null, 'VIP Lounge');
  g = create(); g.player(0).perks.dividend = 1; g.advanceRound(); assert.equal(g.player(0).cash, 1650, 'Dividend Stream');
  g = give(create(), 'doubleup'); { let k = 0; g.random = () => [.5, .5][k++] ?? .4; } await g.rollDice(); await drain(g); assert.ok(g.state.log.some(entry => /Double Up/.test(entry.message)), 'doubles pay $400');
});
test('new card effects: next unowned, swap places, free building, spin now, charity, jackpot raid, bank waiver, lottery', async () => {
  let g = create(); own(g, 1); own(g, 2); g.active.position = 0; await playCard(g, 'market', 'Express highway'); assert.equal(g.active.position, 4); assert.equal(g.state.phase, 'offer');
  g = create(); g.player(1).position = 21; await playCard(g, 'market', 'Body swap'); assert.equal(g.active.position, 21); assert.equal(g.player(1).position, 0);
  g = create(); own(g, 1); await playCard(g, 'market', 'Free construction'); assert.equal(g.state.phase, 'freebuild'); g.freeBuild(1); assert.equal(g.asset(1).buildings, 1);
  g = create(); await playCard(g, 'market', 'Spin from anywhere'); assert.equal(g.state.phase, 'wheel');
  g = create(); g.player(1).cash = 500; await playCard(g, 'market', 'Daan'); assert.deepEqual([g.player(0).cash, g.player(1).cash], [1350, 650]);
  g = create(); g.state.jackpot = 600; await playCard(g, 'market', 'Jackpot raid'); assert.equal(g.active.cash, 1800); assert.equal(g.state.jackpot, 300);
  g = create(); own(g, 1); g.asset(1).mortgaged = true; await playCard(g, 'economic', 'Bank waiver'); assert.equal(g.asset(1).mortgaged, false);
  g = create(); g.random = () => .99; await playCard(g, 'market', 'Mega lottery'); assert.equal(g.active.cash, 2700, 'a 6 wins $1,200');
  g = create(); g.random = () => 0; await playCard(g, 'market', 'Mega lottery'); assert.equal(g.active.cash, 1440, 'anything else costs $60');
  g = create(); await playCard(g, 'economic', 'Chandrayaan launch'); assert.equal(g.active.perks.rocket, 1, 'power-up cards grant their power-up');
});
test('The Great Reset sells every property back to the bank and pays the owners; it strikes by round 75 if nobody drew it', async () => {
  let g = create(3); own(g, 1, 0); own(g, 2, 0); g.asset(1).buildings = 2; own(g, 39, 1); own(g, 37, 2); g.asset(37).mortgaged = true; g.asset(37).mortgageReceived = 175;
  await playCard(g, 'market', 'The Great Reset');
  assert.ok([1, 2, 39, 37].every(id => g.asset(id).owner === null && g.asset(id).buildings === 0 && !g.asset(id).mortgaged), 'everything is back with the bank');
  assert.deepEqual([g.player(0).cash, g.player(1).cash, g.player(2).cash], [1500 + 100 + 2 * 50 + 120, 1500 + 400, 1500 + 380 - 175], 'price + buildings, less the mortgage received');
  assert.equal(g.state.resetDone, true);
  g = create(); own(g, 1, 1); g.state.round = 73; g.advanceRound(); assert.ok(g.state.log.some(entry => /Coming next round: The Great Reset/.test(entry.message)), 'announced a round ahead');
  g.advanceRound(); assert.equal(g.asset(1).owner, null, 'round 75: it strikes on its own'); assert.equal(g.player(1).cash, 1600);
  own(g, 1, 1); g.advanceRound(); assert.equal(g.asset(1).owner, 1, 'only once');
  g = create(); g.state.resetDone = true; own(g, 1, 1); g.state.round = 74; g.advanceRound(); assert.equal(g.asset(1).owner, 1, 'not again after a card already reset the board');
});
test('18 more power-ups each work once per charge', async () => {
  const give = (game, key, n = 1, seat = 0) => { game.player(seat).perks[key] = n; return game; };
  let g = give(create(), 'halftax'); land(g, 5); assert.equal(g.active.cash, 1475, 'Half Tax: $50 toll halved');
  g = give(create(), 'kickback', 1, 1); g.state.offer = 1; g.state.phase = 'offer'; g.purchaseProperty(); assert.equal(g.player(1).cash, 1550, 'Kickback');
  g = give(create(), 'jailbird'); g.active.penalty = { kind: 'prison', attempts: 0 }; g.active.position = 10; { let k = 0; g.random = () => [.1, .3][k++] ?? .4; } await g.rollDice(); await drain(g); assert.equal(g.active.penalty, null, 'Jailbreak');
  g = create(); g.player(1).perks.pension = 1; g.state.phase = 'end'; g.nextTurn(); assert.equal(g.player(1).cash, 1550, 'Pension');
  g = give(create(), 'freeland'); g.state.offer = 39; g.state.phase = 'offer'; g.purchaseProperty(); assert.equal(g.active.cash, 1500, 'Free Land'); assert.equal(g.asset(39).owner, 0);
  g = give(create(), 'repairkit'); own(g, 1); g.asset(1).buildings = 3; await playCard(g, 'market', 'Municipal inspection'); assert.equal(g.active.cash, 1500, 'Repair Kit');
  g = give(create(), 'antiaudit'); g.player(0).cash = 3000; g.applyAudit(); assert.equal(g.player(0).cash, 3000, 'Audit Shield');
  g = give(create(), 'diversion'); own(g, 1, 1); land(g, 1); assert.equal(g.player(1).cash, 1500, 'Rent Diversion: the owner gets nothing'); assert.equal(g.active.cash, 1492);
  g = give(create(), 'bulk'); own(g, 1); build(g, 1); assert.equal(g.asset(1).buildings, 2, 'Bulk Builder');
  g = give(create(), 'hedge'); g.random = () => 0; await playCard(g, 'market', 'Mega lottery'); assert.equal(g.active.cash, 1500, 'Hedge Fund');
  g = create(); g.state.mode = 'buffed'; own(g, 39, 1); give(g, 'chakra', 1, 1); g.state.event = { deck: 'market', index: DECKS.market.findIndex(card => card.effect === 'hijack') }; g.state.phase = 'event'; await g.applyCard(39); assert.equal(g.asset(39).owner, 1, 'Sudarshan Chakra');
  g = give(create(), 'kismet'); g.random = () => .9; land(g, 30); g.spinWheel(); assert.match(g.state.lastWheel.label, /Maha Jackpot/, 'Kismet');
  g = give(create(), 'bookie'); g.random = () => 0; await playCard(g, 'market', 'Mega lottery'); assert.equal(g.active.cash, 2700, 'Bookie rolls a 6');
  g = give(create(), 'redcarpet'); g.state.sides = 5; { const p = new Game(players.slice(0, 2), {}, { sides: 5, random: () => .4, wait: async () => {}, earnings: 1 }); give(p, 'redcarpet'); land(p, 47); assert.equal(p.active.cash, 1540, 'Red Carpet: the guest pays you'); }
  g = give(create(), 'freeride'); own(g, 8, 1); land(g, 8); assert.equal(g.active.cash, 1500, 'Free Ride');
  g = give(create(), 'mirror'); own(g, 1, 1); land(g, 1); assert.equal(g.active.cash, 1500, 'Mirror Rent: paid back'); assert.equal(g.player(1).cash, 1508);
  g = give(create(), 'midas'); g.state.offer = 1; g.state.phase = 'offer'; g.purchaseProperty(); assert.equal(g.asset(1).buildings, 1, 'Midas Touch');
  g = give(create(), 'pilgrim'); land(g, 20); assert.equal(g.active.cash, 1900, 'Pilgrim: pot + $300');
});
test('more new cards: pickpocket, Robin of Sherwood Bazaar, mystery box, lockdown, power surge, amnesty, Taj Mahal mela', async () => {
  let g = create(); g.player(1).perks.rocket = 1; g.random = () => .4; await playCard(g, 'market', 'Pickpocket at the mela'); assert.equal(g.player(0).perks.rocket, 1); assert.equal(g.player(1).perks.rocket, 0);
  g = create(); g.player(1).cash = 3000; await playCard(g, 'market', 'Robin of Sherwood Bazaar'); assert.deepEqual([g.player(0).cash, g.player(1).cash], [1800, 2700]);
  g = create(); await playCard(g, 'market', 'Mystery box'); assert.equal(Object.values(g.active.perks).reduce((a, b) => a + b, 0) > 0, true);
  g = create(); g.player(1).cash = 5000; await playCard(g, 'market', 'Lockdown'); assert.equal(g.player(1).penalty.kind, 'prison');
  g = create(3); await playCard(g, 'economic', 'Power surge'); assert.ok([0, 1, 2].every(id => Object.values(g.player(id).perks).some(value => value > 0)));
  g = create(); g.player(1).penalty = { kind: 'prison', attempts: 1 }; await playCard(g, 'economic', 'Jail amnesty'); assert.equal(g.player(1).penalty, null);
  g = create(); g.state.jackpot = 400; await playCard(g, 'economic', 'Taj Mahal mela'); assert.deepEqual([g.player(0).cash, g.player(1).cash, g.state.jackpot], [1700, 1700, 100]);
});
test('jail cards name the Launch money of the mode: $200 in Classic, $3,000 in Super Buffed', () => {
  const cbi = DECKS.economic.find(card => card.title === 'CBI summons') || DECKS.market.find(card => card.title === 'CBI summons');
  assert.match(create().describeCard(cbi), /do not collect \$200\./);
  const buffed = new Game(players.slice(0, 2), {}, { mode: 'buffed', random: () => .4, wait: async () => {} });
  assert.match(buffed.describeCard(cbi), /do not collect \$3,000\./);
  assert.ok([...DECKS.market, ...DECKS.economic].every(card => !/collect \$200/.test(card.text)), 'no card hard-codes $200 Launch money');
});
test('Super Buffed has no trading; Classic still does', () => {
  const offer = { to: 1, give: { cash: 200, properties: [] }, get: { cash: 0, properties: [2] } };
  const buffed = new Game(players.slice(0, 2), {}, { mode: 'buffed', random: () => .4, wait: async () => {} });
  own(buffed, 2, 1);
  assert.throws(() => buffed.proposeTrade(offer), /Trading is off in Super Buffed/);
  assert.equal(buffed.state.trade ?? null, null); assert.equal(buffed.state.phase, 'ready');
  const classic = create(); own(classic, 2, 1); classic.proposeTrade(offer); assert.equal(classic.state.phase, 'trade');
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
  game.mortgageProperty(1); game.settleDebt(); assert.equal(game.active.cash, 22, 'Fire Sale: $50 + 25% raised at $10 cash'); assert.equal(game.player(1).cash, 1550); assert.equal(game.state.phase, 'end');
});
test('off-turn event debts use the debtor’s assets and return control to the active player', () => {
  const game = create(3); own(game, 4, 1); game.player(1).cash = 0;
  game.beginPayments(game.living.map(p => ({ payer: p.id, creditor: null, amount: 50, reason: 'market slowdown', category: 'fee' })));
  assert.equal(game.managerPlayer.id, 1); assert.equal(game.active.id, 0);
  assert.throws(() => game.mortgageProperty(1)); game.mortgageProperty(4); game.settleDebt();
  assert.equal(game.player(1).cash, 37, 'Fire Sale: $70 + 25% raised at $0 cash, less the $50 owed'); assert.equal(game.player(2).cash, 1450); assert.equal(game.active.id, 0); assert.equal(game.state.phase, 'end');
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
test('log entries say whether news is good or bad and for whom', async () => {
  const game = create(); own(game, 1, 1); land(game, 1); game.state.phase = 'ready';
  game.sendPlayerToPenalty(game.active);
  const tones = game.state.log.filter(entry => entry.tone).map(entry => entry.tone + ':' + entry.player);
  assert.ok(tones.includes('prison:0'), 'going to Prison is marked as Prison news for that player');
  game.grantPerk(game.active, 'shield', 2); assert.equal(game.state.log.at(-1).tone, 'power');
  game.state.players[0].penalty = null; game.state.players[0].position = 0; game.state.phase = 'ready';
  game.beginPayments([{ payer: 0, creditor: 1, amount: 20, reason: 'test', category: 'rent' }]);
  const paid = game.state.log.find(entry => / paid \$20/.test(entry.message)); assert.equal(paid.tone, 'loss'); assert.equal(paid.player, 0);
  const old = Game.restore(JSON.stringify({ ...JSON.parse(game.serialize()), lastDie: undefined, droppedDie: undefined }));
  assert.equal(old.state.lastDie, null); assert.equal(old.state.droppedDie, null);
});
test('Reserve Bank interest rises $50 every 7 rounds and the Prison fine rises $100 every 20 rounds', async () => {
  const at = round => { const game = create(); game.state.round = round; return game; };
  assert.deepEqual([1, 7, 8, 14, 15, 50, 64, 65, 400].map(round => at(round).bankInterest()), [50, 50, 100, 100, 150, 200, 200, 200, 200], 'grows $50 every 7 rounds and stops at $200');
  assert.deepEqual([1, 20, 21, 40, 41, 100].map(round => at(round).prisonFine()), [50, 50, 150, 150, 250, 450]);
  const banker = at(8); land(banker, 33); assert.equal(banker.active.cash, 1600, 'landing on Reserve Bank in round 8 pays $100');
  const inmate = at(21); inmate.active.penalty = { kind: 'prison', attempts: 0 }; inmate.active.position = 10; inmate.state.phase = 'ready';
  inmate.payPenalty(); assert.equal(inmate.active.cash, 1350, 'leaving Prison in round 21 costs $150'); assert.equal(inmate.active.penalty, null);
  const stuck = at(41); stuck.active.penalty = { kind: 'prison', attempts: 4 }; stuck.active.position = 10; stuck.state.phase = 'ready';
  const draws = [0, .2]; let k = 0; stuck.random = () => draws[k++] ?? .5; // rolls 1 + 2: no doubles
  await stuck.rollDice(); await drain(stuck); assert.equal(stuck.active.cash, 1500, 'the third failed roll costs nothing, even in round 41'); assert.equal(stuck.active.penalty, null);
});
test('the Tax Audit takes 30% of the richest player’s cash; Super Buffed keeps the fixed amount growing $100 every 10 rounds', () => {
  let game = create(); game.state.round = 25; game.player(0).cash = 3000; game.player(1).cash = 1000; game.applyAudit();
  assert.deepEqual([game.player(0).cash, game.player(1).cash], [2100, 1900], 'the richest pays the poorest 30% of $3,000');
  game.state.city.upcoming = { kind: 'audit', round: 26 };
  assert.ok(game.cityLines().includes('Next round: Tax Audit (richest pays poorest 30% of their cash).'));
  game = new Game(players.slice(0, 2), {}, { mode: 'buffed' });
  assert.deepEqual([1, 10, 11, 20, 21, 40, 41, 200].map(round => game.auditAmount(round)), [100, 100, 200, 200, 200, 200, 200, 200], 'capped at $200 from round 11');
  game.state.round = 25; game.player(0).cash = 3000; game.player(1).cash = 1000; game.applyAudit();
  assert.deepEqual([game.player(0).cash, game.player(1).cash], [2800, 1200], 'Super Buffed: the richest pays the poorest $200');
  game.state.round = 20; game.state.city.upcoming = { kind: 'audit', round: 21 };
  assert.ok(game.cityLines().includes('Next round: Tax Audit (richest pays poorest $200).'), 'announced in round 20 for round 21, so it shows the round-21 amount');
});
test('the pentagon board adds a whole side and keeps every classic space where it was', () => {
  assert.deepEqual(Object.keys(BOARDS).map(Number), [4, 5], 'only the square and pentagon boards exist');
  assert.deepEqual([4, 5].map(n => BOARDS[n].length), [40, 50]);
  BOARD.forEach(space => assert.equal(BOARDS[5][space.id].name, space.name, space.name + ' keeps its id on the pentagon'));
  for (let side = 0; side < 5; side++) assert.ok(!BOARDS[5][side * 10].price, 'each side starts with a corner');
  assert.equal(BOARDS[5].slice(41, 50).filter(space => space.type === 'transport').length, 1, 'the new side has one station');
  assert.deepEqual(['skyline', 'marina'].map(group => BOARDS[5].filter(space => space.group === group).length), [3, 3]);
  assert.ok(BOARDS[5].slice(40).filter(space => space.type === 'property').every(space => space.price > 400));
  const game = new Game(players.slice(0, 2), {}, { sides: 5, random: () => .4, wait: async () => {}, earnings: 1 });
  assert.equal(game.board.length, 50); assert.equal(game.state.sides, 5); assert.equal(Object.keys(game.state.properties).length, 34);
  assert.equal(new Game(players.slice(0, 2), {}, { sides: 6 }).board.length, 40, 'the removed hexagon (and any unknown size) falls back to the square board');
  assert.equal(Game.restore(game.serialize()).board.length, 50, 'a saved pentagon game restores as a pentagon');
  assert.equal(Game.restore(JSON.stringify({ ...JSON.parse(create().serialize()), sides: undefined })).state.sides, 4, 'older saves are square-board games');
});
test('Dalal Street rolls a die to trade, and Bollywood Premiere pays every other player', () => {
  const make = random => new Game(players.slice(0, 2), {}, { sides: 5, random: () => random, wait: async () => {}, earnings: 1 });
  let game = make(.4); land(game, 40); assert.equal(game.active.cash, 1500, 'a 3: the market is flat'); assert.equal(game.state.lastDie.title, 'Dalal Street');
  game = make(.99); land(game, 40); assert.equal(game.active.cash, 1700, 'a 6 wins $200');
  game = make(0); land(game, 40); assert.equal(game.active.cash, 1400, 'a 1 loses $100');
  game = make(.99); game.state.round = 16; land(game, 40); assert.equal(game.active.cash, 1900, 'stage 2 doubles the win');
  game = make(.4); land(game, 47); assert.equal(game.active.cash, 1460); assert.equal(game.player(1).cash, 1540, 'Bollywood Premiere: $40 to every other player');
  game = make(.4); game.state.round = 16; land(game, 47); assert.equal(game.active.cash, 1420, 'and $80 at stage 2');
});
test('new cards: shagun from every rival, gifts to every rival, and a wrong turn back 3 spaces', async () => {
  let game = create(3); await playCard(game, 'market', 'Shaadi shagun');
  assert.deepEqual([0, 1, 2].map(id => game.player(id).cash), [1580, 1460, 1460], 'every rival pays the drawer');
  game = create(3); await playCard(game, 'market', 'Wedding season');
  assert.deepEqual([0, 1, 2].map(id => game.player(id).cash), [1420, 1540, 1540], 'the drawer pays every rival');
  game = create(); game.active.position = 12; await playCard(game, 'economic', 'Wrong turn');
  assert.equal(game.active.position, 9, 'back 3 spaces'); assert.equal(game.state.phase, 'offer', 'and that space resolves');
  game = create(); game.active.position = 1; await playCard(game, 'economic', 'Wrong turn');
  assert.equal(game.active.position, 38); assert.equal(game.active.cash, 1500, 'going backwards past Gateway of India pays nothing');
});
test('earnings scale per board (×1 / ×1.05), costs unchanged, and each game keeps its multiplier', async () => {
  const make = sides => new Game(players.slice(0, 2), {}, { sides, random: () => .99, wait: async () => {} });
  assert.deepEqual([4, 5].map(sides => make(sides).active.cash), [1500, 1575], 'starting cash');
  for (const [sides, pay] of [[4, 200], [5, 210]]) {
    const game = make(sides); game.active.position = game.board.length - 1; game.state.phase = 'ready';
    game.random = () => 0; await game.rollDice(); await drain(game); // 1 + 1 moves 2 spaces, passing Launch
    assert.ok(game.state.log.some(entry => entry.message.includes('passed Launch and received ' + '$' + pay)), sides + ' sides pay $' + pay + ' at Launch');
  }
  assert.deepEqual([4, 5].map(sides => make(sides).bankInterest()), [50, 55], 'Reserve Bank interest (rounded to $5)');
  const card = make(5); await playCard(card, 'market', 'Startup unicorn'); assert.equal(card.active.cash, 1575 + 160, 'a $150 card pays $160 on the pentagon');
  const bill = make(5); await playCard(bill, 'market', 'Monsoon leak'); assert.equal(bill.active.cash, 1575 - 80, 'costs are not scaled');
  assert.equal(make(5).wheelSegments().find(slice => slice.id === 'jackpot').amount, 525, 'Wheel cash wins scale too');
  assert.equal(make(5).wheelSegments().find(slice => slice.id === 'bad').amount, 200, 'Wheel losses do not');
  assert.equal(Game.restore(make(5).serialize()).state.earnings, 1.05, 'a saved game keeps its multiplier');
  const old = JSON.parse(make(5).serialize()); delete old.earnings; assert.equal(Game.restore(JSON.stringify(old)).state.earnings, 1.1, 'games saved before it was stored keep their old economy');
});
test('station rent climbs with each of up to three stations', () => {
  const game = new Game(players.slice(0, 2), {}, { sides: 5, random: () => .4, wait: async () => {}, earnings: 1 });
  [8, 23, 45].forEach((id, i) => { game.asset(id).owner = 1; assert.equal(game.calculateRent(8), [50, 150, 250][i], (i + 1) + ' stations'); });
});
test('up to six players, each with their own colour', () => {
  const six = ['black', 'blue', 'magenta', 'lime', 'orange', 'cyan'].map((token, i) => ({ name: 'P' + i, token }));
  assert.equal(validatePlayers(six), '', 'six players with six colours are valid');
  assert.match(validatePlayers([...six, { name: 'P6', token: 'black' }]), /between 2 and 6/, 'a seventh is not');
  const game = new Game(six, {}, { random: () => .4, wait: async () => {}, earnings: 1 });
  assert.deepEqual(game.state.players.map(p => p.color), ['#17171c', '#1e40e6', '#e3008c', '#7ed321', '#ff6a00', '#00d5ff']);
});
test('every move-to card takes you to the space its text names', async () => {
  for (const deck of Object.values(DECKS)) for (const card of deck.filter(item => item.effect === 'advance'))
    assert.ok(card.text.includes(BOARD[card.destination].name), card.title + ' moves to ' + BOARD[card.destination].name + ', which its text does not name');
  const game = create(); game.active.position = 3; await playCard(game, 'market', 'Mumbai local');
  assert.equal(game.active.position, 23, 'Skyway shortcut lands on Chhatrapati Shivaji Terminus'); assert.equal(BOARD[23].name, 'Chhatrapati Shivaji Terminus');
});
test('safe phase saves restore exact ownership, cash, decks, settings and pending actions', () => {
  for (const phase of ['ready', 'end', 'offer', 'auction', 'event', 'wheel', 'freebuild', 'debt', 'victory']) {
    const game = create(); own(game, 4, 1); game.asset(4).buildings = 2; game.state.settings.sound = false;
    if (phase === 'end') game.finishResolution();
    if (phase === 'offer') land(game, 1);
    if (phase === 'auction') { land(game, 1); game.purchaseProperty(); game.startAuction(1); }
    if (phase === 'event') game.drawCard('economic');
    if (phase === 'wheel') land(game, 30);
    if (phase === 'freebuild') { own(game, 1); own(game, 2); land(game, 30); game.random = () => .53; game.spinWheel(); }
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
  game = Game.restore(game.serialize()); game.mortgageProperty(1); game.settleDebt(); assert.equal(game.player(1).cash, 1550); assert.equal(game.player(0).cash, 22);
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
      case 'wheel': game.spinWheel(); break;
      case 'freebuild': { const pick = game.freeBuildTargets(game.active).sort((a, b) => game.asset(a.id).buildings - game.asset(b.id).buildings || a.id - b.id)[0]; game.freeBuild(pick.id); break; }
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
