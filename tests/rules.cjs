/* Regression tests for the unchanged game rules, shared by client and server. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = { console, setTimeout, clearTimeout };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'lib', 'game-engine.cjs'), 'utf8'), context);
const { Game, BOARD, DECKS, validatePlayers } = context.MarketWars;
const players = [
  { name: 'Ritesh', role: 'monopolist', token: 'briefcase' },
  { name: 'Manish', role: 'competitor', token: 'rocket' },
  { name: 'Asha', role: 'monopolist', token: 'building' },
  { name: 'Dev', role: 'competitor', token: 'car' }
];
const testCases = [];
const test = (name, run) => testCases.push({ name, run });
const create = (count = 2, random = () => .4) => new Game(players.slice(0, count), {}, { random, wait: async () => {} });
const land = (game, position) => { game.active.position = position; game.state.phase = 'moving'; game.resolveSpace(); };
const own = (game, id, owner = 0) => { game.asset(id).owner = owner; };
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
test('setup rejects repeated names, repeated tokens, blank names and a single role', () => {
  assert.ok(validatePlayers([{ ...players[0] }, { ...players[1], name: ' ritesh ' }]));
  assert.ok(validatePlayers([{ ...players[0] }, { ...players[1], token: 'briefcase' }]));
  assert.ok(validatePlayers([{ ...players[0] }, { ...players[1], name: '  ' }]));
  assert.ok(validatePlayers([{ ...players[0] }, { ...players[1], role: 'monopolist' }]));
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
test('Monopolists need the full unmortgaged group; Competitors build independently at 25% less', () => {
  const game = create(); own(game, 1); assert.throws(() => game.buildStructure(1), /entire district/);
  own(game, 2); assert.equal(game.calculateRent(1), 20); game.buildStructure(1);
  assert.equal(game.active.cash, 1450); assert.equal(game.calculateRent(1), 32);
  game.state.currentPlayer = 1; own(game, 4, 1); game.buildStructure(4);
  assert.equal(game.active.cash, 1455); assert.equal(game.asset(4).buildings, 1); assert.equal(game.calculateRent(4), 36);
});
test('all five development levels, sale, cost and tower rent work', () => {
  const game = create(); own(game, 1); own(game, 2);
  for (let i = 0; i < 5; i++) game.buildStructure(1);
  assert.equal(game.asset(1).buildings, 5); assert.equal(game.calculateRent(1), 400); assert.throws(() => game.buildStructure(1), /tower/);
  game.sellBuilding(1); assert.equal(game.asset(1).buildings, 4); assert.equal(game.active.cash, 1275);
});
test('mortgaged groups prohibit building; selling clears Monopolist mortgage restriction', () => {
  const game = create(); own(game, 1); own(game, 2); game.buildStructure(1);
  assert.throws(() => game.mortgageProperty(2), /district/);
  game.sellBuilding(1); game.mortgageProperty(2); assert.throws(() => game.buildStructure(1), /entire district/);
  game.unmortgageProperty(2); game.buildStructure(1); assert.equal(game.asset(1).buildings, 1);
});
test('mortgage disables rent and development; 10% fee restores rent', () => {
  const game = create(); own(game, 1); game.mortgageProperty(1);
  assert.equal(game.active.cash, 1550); assert.equal(game.calculateRent(1), 0); assert.throws(() => game.buildStructure(1), /Unmortgage/);
  game.unmortgageProperty(1); assert.equal(game.active.cash, 1495); assert.equal(game.calculateRent(1), 8);
  assert.throws(() => game.mortgageProperty(4), /owner/); assert.throws(() => game.sellBuilding(1), /no buildings/);
});
test('transport and utility rents count only active stations, buildings are prohibited', () => {
  const game = create(); own(game, 8); own(game, 23); own(game, 15); own(game, 29);
  assert.equal(game.calculateRent(8), 60); assert.equal(game.calculateRent(15, 7), 70);
  game.mortgageProperty(23); game.mortgageProperty(29);
  assert.equal(game.calculateRent(8), 30); assert.equal(game.calculateRent(15, 7), 28);
  assert.throws(() => game.buildStructure(8), /cannot be developed/);
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
test('buy first, skip without auction, and only an owner may sell during their turn', () => {
  const game = create(); land(game, 1); assert.throws(() => game.startAuction(1), /owner/);
  game.declineProperty(); assert.equal(game.asset(1).owner, null); assert.equal(game.state.auction, null); assert.equal(game.state.phase, 'end');
  land(game, BOARD.find(space => space.type === 'auction').id); assert.equal(game.state.phase, 'offer'); assert.equal(game.state.auction, null);
  game.declineProperty(); land(game, 1); game.purchaseProperty(); assert.equal(game.state.auction, null);
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
test('taxes, wealth calculation, free market and bank bonuses are role-specific', () => {
  const game = create(); land(game, 5); assert.equal(game.active.cash, 1400); assert.equal(game.active.stats.taxesPaid, 100);
  land(game, 20); assert.equal(game.active.cash, 1400); land(game, 33); assert.equal(game.active.cash, 1450);
  game.state.currentPlayer = 1; land(game, 5); assert.equal(game.active.cash, 1420);
  land(game, 20); assert.equal(game.active.cash, 1495); land(game, 25); assert.equal(game.active.cash, 1435); // ceil(1495 × .04)
});
test('role penalties have different destinations and rent permissions', () => {
  const game = create(); own(game, 1); own(game, 4, 1); land(game, 36);
  assert.equal(game.active.position, 10); assert.equal(game.active.penalty.kind, 'prison'); assert.equal(game.calculateRent(1), 0);
  game.state.currentPlayer = 1; land(game, 36); assert.equal(game.active.position, 30); assert.equal(game.active.penalty.kind, 'pricewar'); assert.equal(game.calculateRent(4), 12);
  const visit = create(); land(visit, 10); assert.equal(visit.active.penalty, null); land(visit, 30); assert.equal(visit.active.penalty, null);
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
test('three consecutive doubles send a player directly to role detention', async () => {
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
  const events = new Set(); let actions = 0;
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
      case 'debt': {
        const debtor = game.managerPlayer;
        if (game.liquidatable(debtor) < s.pending.amount) game.declareBankruptcy();
        else {
          const developed = game.owned(debtor).find(space => game.asset(space.id).buildings > 0);
          const collateral = game.owned(debtor).find(space => !game.mortgageReason(debtor, space.id));
          if (debtor.cash >= s.pending.amount) game.settleDebt();
          else if (developed) game.sellBuilding(developed.id);
          else if (collateral) game.mortgageProperty(collateral.id);
          else assert.fail('solvent debtor has no liquidation action');
        }
        break;
      }
      case 'end': {
        const available = game.owned(game.active).filter(space => !game.buildReason(game.active, space.id));
        const cheapest = available.sort((a, b) => game.asset(a.id).buildings - game.asset(b.id).buildings)[0];
        if (cheapest && game.active.cash > game.buildingCost(game.active, cheapest) + 200) game.buildStructure(cheapest.id);
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
  console.log('  ' + count + '-player simulation: ' + game.state.turn + ' turns, ' + actions + ' actions, ' + events.size + ' distinct cards, winner ' + game.player(game.state.winner).name);
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
