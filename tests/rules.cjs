/* Regression tests for the classic game rules, shared by client and server. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = { console, setTimeout, clearTimeout };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'lib', 'game-engine.cjs'), 'utf8'), context);
const { Game, BOARD, DECKS, validatePlayers, RARITY_WEIGHTS } = context.MarketWars;
const players = [
  { name: 'Ritesh', token: 'black' },
  { name: 'Manish', token: 'blue' },
  { name: 'Asha', token: 'magenta' },
  { name: 'Dev', token: 'lime' }
];
const testCases = [];
const test = (name, run) => testCases.push({ name, run });
const create = (count = 2, random = () => .4) => new Game(players.slice(0, count), {}, { random, wait: async () => {} });
const game0 = () => create();
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
  assert.equal(DECKS.market.length, 50); assert.equal(DECKS.economic.length, 50);
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
test('every event resolves, and effects cannot apply twice', async () => {
  for (const [name, cards] of Object.entries(DECKS)) {
    for (let index = 0; index < cards.length; index++) {
      const game = create(4); own(game, 4, 1); game.asset(4).buildings = 2;
      game.state.event = { deck: name, index }; game.state.phase = 'event';
      await game.applyCard(); await drain(game);
      assert.ok(['end', 'offer', 'debt', 'auction', 'event', 'wheel'].includes(game.state.phase), cards[index].title + ' ended in ' + game.state.phase);
      assert.ok(game.state.players.every(player => player.cash >= 0));
      if (game.state.phase !== 'event') await assert.rejects(game.applyCard());
    }
  }
});
test('50 cards per deck are drawn by rarity (70/25/5) and never repeat within 12 draws', () => {
  for (const [name, cards] of Object.entries(DECKS)) {
    assert.equal(cards.length, 50);
    for (const tier of Object.keys(RARITY_WEIGHTS)) assert.ok(cards.some(card => card.rarity === tier), name + ' has ' + tier + ' cards');
    assert.ok(cards.every(card => card.title && card.text && card.effect));
    const game = create(2, randomSeed(7)), draws = [], tiers = { common: 0, uncommon: 0, rare: 0 };
    for (let i = 0; i < 3000; i++) { game.drawCard(name); draws.push(game.state.event.index); tiers[cards[draws.at(-1)].rarity]++; }
    draws.forEach((index, i) => assert.ok(!draws.slice(Math.max(0, i - 12), i).includes(index), 'repeat within 12 draws'));
    assert.equal(new Set(draws).size, 50, 'every card turns up eventually');
    assert.ok(tiers.common / 3000 > .6 && tiers.common / 3000 < .8, 'common share ' + tiers.common / 3000);
    assert.ok(tiers.rare / 3000 > .02 && tiers.rare / 3000 < .09, 'rare share ' + tiers.rare / 3000);
  }
});
test('rolled, gamble, catch-up and levy cards use the server dice and the game stage', async () => {
  const apply = async (game, deck, title) => {
    game.state.event = { deck, index: DECKS[deck].findIndex(card => card.title === title) }; game.state.phase = 'event';
    await game.applyCard(); await drain(game);
  };
  let game = create(); game.random = () => .99; await apply(game, 'market', 'Lucky customer'); assert.equal(game.active.cash, 1500 + 6 * 30);
  game = create(); game.random = () => 0; await apply(game, 'market', 'Storm damage'); assert.equal(game.active.cash, 1470); assert.equal(game.state.jackpot, 115, 'half of a card payment feeds the pot');
  for (const [roll, expected] of [[0, 1400], [.4, 1500], [.99, 1750]]) { game = create(); game.random = () => roll; await apply(game, 'market', 'Double or nothing'); assert.equal(game.active.cash, expected, 'gamble at ' + roll); }
  game = create(); game.state.round = 16; game.random = () => .99; await apply(game, 'market', 'Lucky customer'); assert.equal(game.active.cash, 1500 + 6 * 60, 'stage 2 doubles cash cards');
  game = create(); game.state.round = 31; await apply(game, 'economic', 'Small business fund'); assert.equal(game.active.cash, 1800, 'stage 3 triples cash cards');
  game = create(); game.state.round = 16; assert.match(game.describeCard(DECKS.market[1]), /\$160/);
  game = create(); assert.match(game.describeCard(DECKS.market.find(card => card.title === 'Double or nothing')), /1–2 pay \$100, 3–4 nothing, 5–6 win \$250/);
  assert.match(game.describeCard(DECKS.market.find(card => card.title === 'Risky launch')), /1–3 pay \$150, 4–6 win \$300/);
  assert.match(game.describeCard(DECKS.market.find(card => card.title === 'High stakes')), /1–3 pay \$200, 4 nothing, 5–6 win \$400/);
  game = create(3); game.player(2).cash = 100; game.state.currentPlayer = 2; await apply(game, 'market', 'Underdog grant'); assert.equal(game.player(2).cash, 350, 'the poorest player gets the big grant');
  game = create(3); game.player(2).cash = 100; await apply(game, 'market', 'Underdog grant'); assert.equal(game.player(0).cash, 1540, 'everyone else gets the small one');
  game = create(3); game.player(1).cash = 3000; await apply(game, 'market', 'City levy');
  assert.equal(game.player(1).cash, 2850); assert.equal(game.player(0).cash, 1500); assert.equal(game.state.jackpot, 175, 'the levy feeds the jackpot');
  game = create(); own(game, 1); own(game, 2); game.asset(1).buildings = 2; game.asset(2).buildings = 5; await apply(game, 'market', 'Builders bonus'); assert.equal(game.active.cash, 1500 + 7 * 20);
});
test('Business Tax is the lesser of $200 and 10% of cash; Wealth Tax is $15 per property and $25 per building level', () => {
  const game = create(); land(game, 5);
  assert.equal(game.active.cash, 1350); assert.equal(game.active.stats.taxesPaid, 150);
  game.active.cash = 3000; land(game, 5); assert.equal(game.active.cash, 2800, 'capped at $200');
  game.active.cash = 500; land(game, 5); assert.equal(game.active.cash, 450);
  game.active.cash = 0; land(game, 5); assert.equal(game.active.cash, 0); assert.equal(game.state.phase, 'end');
  const wealth = create(); land(wealth, 25); assert.equal(wealth.active.cash, 1500, 'nothing owned, nothing owed');
  own(wealth, 1); own(wealth, 2); own(wealth, 4); wealth.asset(1).buildings = 2; wealth.asset(2).buildings = 1; land(wealth, 25);
  assert.equal(wealth.active.cash, 1500 - (3 * 15 + 3 * 25));
  land(wealth, 33); assert.equal(wealth.active.cash, 1500 - 120 + 50, 'City Bank still pays interest');
  const late = create(); late.state.round = 16; late.active.cash = 6000; land(late, 5); assert.equal(late.active.cash, 5600, 'the Business Tax cap doubles to $400 at stage 2');
  own(late, 1); late.asset(1).buildings = 1; land(late, 25); assert.equal(late.active.cash, 5600 - 2 * (15 + 25), 'so does Wealth Tax');
});
test('Free Market pays out the jackpot, which taxes, fines and card payments feed', async () => {
  const game = create(); assert.equal(game.state.jackpot, 100);
  land(game, 5); assert.equal(game.state.jackpot, 175, 'half of the $150 tax goes into the pot, the rest leaves the economy');
  game.state.currentPlayer = 1; land(game, 20); assert.equal(game.player(1).cash, 1675); assert.equal(game.state.jackpot, 100, 'the pot resets to $100');
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
test('Wheel of Fortune: the server spin pays, charges, builds free or draws a card, and scales with the stage', () => {
  const spin = (r, setup, round) => { const g = create(); if (round) g.state.round = round; setup?.(g); g.random = () => r; land(g, 30); assert.equal(g.state.phase, 'wheel'); g.spinWheel(); return g; };
  assert.equal(BOARD[30].type, 'wheel'); assert.equal(BOARD[30].name, 'Wheel of Fortune');
  let g = spin(.01); assert.equal(g.active.cash, 1900); assert.equal(g.state.lastWheel.index, 0); assert.equal(g.state.phase, 'end'); assert.match(g.state.lastWheel.outcome, /Won \$400/);
  g = spin(.13); assert.equal(g.active.cash, 1750);
  g = spin(.26); assert.equal(g.active.cash, 1650);
  g = spin(.38); assert.equal(g.active.cash, 1600);
  g = spin(.63); assert.equal(g.active.cash, 1400); assert.equal(g.state.jackpot, 150, 'wheel losses feed the jackpot');
  g = spin(.76); assert.equal(g.active.cash, 1300);
  g = spin(.9); assert.equal(g.state.phase, 'event'); assert.equal(g.state.event.deck, 'market');
  g = spin(.51, x => { own(x, 1); own(x, 2); x.asset(1).buildings = 1; });
  assert.equal(g.asset(2).buildings, 1); assert.equal(g.asset(1).buildings, 1); assert.equal(g.active.cash, 1500); assert.match(g.state.lastWheel.outcome, /Free building on Sailmaker Lane/);
  g = spin(.51); assert.equal(g.active.cash, 1600); assert.match(g.state.lastWheel.outcome, /Nothing to build/);
  g = spin(.01, null, 16); assert.equal(g.active.cash, 2300); g = spin(.01, null, 31); assert.equal(g.active.cash, 2700);
  assert.deepEqual([...create().wheelSegments().map(slice => slice.text)], ['+$400', '+$250', '+$150', '+$100', 'Free building', '−$100', '−$200', 'Market card']);
  assert.throws(() => create().spinWheel(), /no wheel/);
  const poor = create(); poor.active.cash = 50; poor.random = () => .76; land(poor, 30); poor.spinWheel(); assert.equal(poor.state.phase, 'debt', 'a wheel loss can become a debt');
});
test('City Events are announced a round ahead; Boom, Recession and Audit change the whole table', () => {
  const advance = (game, rounds) => { for (let i = 0; i < rounds * game.state.players.filter(player => !player.bankrupt).length; i++) { game.state.phase = 'end'; game.state.extraRoll = false; game.nextTurn(); } };
  let game = create(); game.random = () => .1; advance(game, 3);
  assert.equal(game.state.round, 4); assert.deepEqual({ ...game.state.city.upcoming }, { kind: 'boom', round: 5 }); assert.ok(game.state.log.some(entry => /Coming next round: Property Boom/.test(entry.message)));
  own(game, 1); assert.equal(game.calculateRent(1), 8);
  advance(game, 1); assert.equal(game.state.round, 5); assert.deepEqual({ ...game.state.city.active }, { kind: 'boom', until: 6 }); assert.equal(game.calculateRent(1), 12, 'rents +50%');
  advance(game, 1); assert.equal(game.state.city.active.kind, 'boom', 'still active in round 6');
  advance(game, 1); assert.equal(game.state.city.active, null, 'over in round 7'); assert.equal(game.calculateRent(1), 8);
  game = create(); game.random = () => .4; own(game, 1); own(game, 2); advance(game, 4);
  assert.equal(game.state.city.active.kind, 'recession'); assert.equal(game.buildingCost(game.active, BOARD[1]), 35, 'building costs -30%');
  assert.equal(game.finances(game.active).buildingValue, 0); game.asset(1).buildings = 1; assert.equal(game.finances(game.active).buildingValue, 50, 'net worth ignores the discount');
  game = create(); game.random = () => .9; game.player(0).cash = 2000; game.player(1).cash = 1000; advance(game, 4);
  assert.equal(game.state.city.active, null); assert.equal(game.player(0).cash, 1900); assert.equal(game.player(1).cash, 1100, 'the richest pays the poorest');
  game.state.round = 20; assert.equal(game.cityLines().length, 0);
  game = create(3); game.random = () => .9; advance(game, 4); assert.equal(game.state.round, 5, 'a round is every player taking a turn');
  game = create(3); game.player(2).bankrupt = true; game.random = () => .1; for (let i = 0; i < 8; i++) { game.state.phase = 'end'; game.nextTurn(); } assert.equal(game.state.round, 5, 'bankrupt players are skipped without changing the count');
});
test('saves from before the card and wheel update still load', () => {
  const s = JSON.parse(create().serialize());
  s.decks = { market: { order: Array.from({ length: 15 }, (_, i) => i), cursor: 3 }, economic: { order: Array.from({ length: 15 }, (_, i) => i), cursor: 0 } };
  delete s.round; delete s.jackpot; delete s.city; delete s.lastWheel; s.players.forEach(player => delete player.jailFree);
  s.turn = 9; s.phase = 'event'; s.event = { deck: 'economic', index: 4 };
  const game = Game.restore(JSON.stringify(s));
  assert.equal(JSON.stringify(game.state.decks.market), '{"recent":[]}'); assert.equal(game.state.round, 5); assert.equal(game.state.jackpot, 100);
  assert.deepEqual({ ...game.state.city }, { upcoming: null, active: null }); assert.ok(game.state.players.every(player => player.jailFree === 0));
  assert.equal(DECKS.economic[4].title, 'Clean energy rebate', 'the original 15 cards keep their positions');
  const wheelSave = JSON.parse(create().serialize()); wheelSave.phase = 'wheel'; assert.throws(() => Game.restore(JSON.stringify(wheelSave)), /damaged/, 'a wheel phase needs the player on the wheel');
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
  for (const phase of ['ready', 'end', 'offer', 'auction', 'event', 'wheel', 'debt', 'victory']) {
    const game = create(); own(game, 4, 1); game.asset(4).buildings = 2; game.state.settings.sound = false;
    if (phase === 'end') game.finishResolution();
    if (phase === 'offer') land(game, 1);
    if (phase === 'auction') { land(game, 1); game.purchaseProperty(); game.startAuction(1); }
    if (phase === 'event') game.drawCard('economic');
    if (phase === 'wheel') land(game, 30);
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
      case 'wheel': game.spinWheel(); break;
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
