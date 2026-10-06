import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyGameAction, requireRevision, startGame } from '../lib/game-actions';
import { command, profile, revision, roomCode } from '../lib/validation';
import MarketWars from '../lib/game-engine.cjs';
import type { GameState, Room } from '../lib/types';

const members = [
  { name: 'Host', user_id: 'host', seat: 0, role: 'monopolist' as const, token: 'briefcase' as const },
  { name: 'Guest', user_id: 'guest', seat: 1, role: 'competitor' as const, token: 'rocket' as const },
];
const lobby = (): Room => ({ code: 'AB12CD', host_id: 'host', members: structuredClone(members), member_ids: ['host', 'guest'], status: 'lobby', revision: 1, state: null, transition: null, created_at: '', updated_at: '' });
const playing = (): Room => { const room = lobby(); room.state = startGame(room, 'host'); room.status = 'playing'; return room; };
const fixture = () => new MarketWars.Game(members, {}, { random: () => .3, wait: async () => {} });
const saved = (game: ReturnType<typeof fixture>) => JSON.parse(game.serialize()) as GameState;

test('Host authorization, membership, and unchanged starting rules', () => {
  assert.throws(() => startGame(lobby(), 'guest'), /Only the Host/);
  assert.throws(() => startGame(lobby(), 'outsider'), /not a player/);
  const room = lobby(); room.members[1].role = 'monopolist';
  assert.throws(() => startGame(room, 'host'), /at least one Monopolist/);
  const state = startGame(lobby(), 'host');
  assert.deepEqual(state.players.map(p => p.cash), [1500, 1500]);
  assert.equal(state.phase, 'ready');
});

test('Commands cannot roll another player, supply dice, or replace state', async () => {
  const room = playing();
  await assert.rejects(applyGameAction(room, 'guest', { action: 'roll' }), /Only the acting player/);
  await assert.rejects(applyGameAction(room, 'outsider', { action: 'roll' }), /not a player/);
  const parsed = command({ action: 'roll', dice: [6, 6], state: { cash: 999999 } });
  assert.equal('dice' in parsed, false);
  assert.equal('state' in parsed, false);
  const result = await applyGameAction(room, 'host', parsed);
  assert.equal(result.state.players[1].cash, 1500);
  assert.ok(result.state.dice.every(d => d >= 1 && d <= 6));
  assert.equal(room.state?.phase, 'ready', 'reducer must not mutate the stored input');
  assert.ok(!['rolling','moving'].includes(result.state.phase));
});

test('Offers, purchases, rents, and turns reuse the model', async () => {
  const room = playing(), game = fixture();
  game.state.players[0].position = 1; game.state.phase = 'moving'; game.resolveSpace();
  room.state = saved(game);
  await assert.rejects(applyGameAction(room, 'guest', { action: 'buy' }), /acting player/);
  const purchase = await applyGameAction(room, 'host', { action: 'buy' });
  assert.equal(purchase.state.properties['1'].owner, 0);
  assert.equal(purchase.state.players[0].cash, 1400);
  room.state = purchase.state;
  const ended = await applyGameAction(room, 'host', { action: 'end' });
  assert.equal(ended.state.currentPlayer, 1);
  assert.equal(ended.state.turn, 2);
});

test('Only the current auction bidder can bid or pass', async () => {
  const room = playing(), game = fixture();
  game.state.phase = 'moving'; game.startAuction(1); game.auctionPass();
  room.state = saved(game);
  assert.equal(room.state.auction?.bidder, 1);
  await assert.rejects(applyGameAction(room, 'host', { action: 'bid', increment: 10 }), /acting player/);
  await assert.rejects(applyGameAction(room, 'host', { action: 'roll' }), /auction/);
  const bid = await applyGameAction(room, 'guest', { action: 'bid', increment: 10 });
  assert.equal(bid.state.properties['1'].owner, 1);
  assert.equal(bid.state.players[1].cash, 1490);
});

test('Only the off-turn debtor can liquidate, settle, or declare bankruptcy', async () => {
  const room = playing(), game = fixture();
  game.state.properties[1].owner = 1; game.state.players[1].cash = 20;
  game.beginPayments([{ payer: 1, creditor: null, amount: 70, reason: 'event', category: 'fee' }]);
  room.state = saved(game);
  await assert.rejects(applyGameAction(room, 'host', { action: 'mortgage', id: 1 }), /acting player/);
  await assert.rejects(applyGameAction(room, 'host', { action: 'end' }), /pending payment/);
  room.state = (await applyGameAction(room, 'guest', { action: 'mortgage', id: 1 })).state;
  assert.equal(room.state.players[1].cash, 70);
  room.state = (await applyGameAction(room, 'guest', { action: 'settle' })).state;
  assert.equal(room.state.pending, null);
  assert.equal(room.state.currentPlayer, 0);
  assert.equal(room.state.players[1].cash, 0);
});

test('Bankruptcy and winner survive serialization', async () => {
  const room = playing(), game = fixture();
  game.state.players[1].cash = 0;
  game.beginPayments([{ payer: 1, creditor: 0, amount: 70, reason: 'rent', category: 'rent' }]);
  room.state = saved(game);
  const result = await applyGameAction(room, 'guest', { action: 'bankrupt' });
  assert.equal(result.state.phase, 'victory'); assert.equal(result.state.winner, 0);
  assert.equal(MarketWars.Game.restore(JSON.stringify(result.state)).state.winner, 0);
});

test('Mandatory third detention release drains asynchronous movement before commit', async () => {
  const room = playing(), game = fixture();
  game.state.players[0].position = 10;
  game.state.players[0].penalty = { kind: 'prison', attempts: 3 };
  game.state.players[0].cash = 0; game.state.properties[1].owner = 0;
  game.beginPayments([{ payer: 0, creditor: null, amount: 50, reason: 'release', category: 'fee' }], { kind: 'releaseMove', steps: 5 });
  room.state = saved(game);
  room.state = (await applyGameAction(room, 'host', { action: 'mortgage', id: 1 })).state;
  const result = await applyGameAction(room, 'host', { action: 'settle' });
  assert.equal(result.state.players[0].position, 15);
  assert.equal(result.state.players[0].penalty, null);
  assert.deepEqual(result.transition.path, [11,12,13,14,15]);
  assert.equal(result.state.phase, 'offer');
});

test('Revision and input validation reject stale or malformed requests', () => {
  assert.throws(() => requireRevision(lobby(), 0), /room changed/);
  assert.equal(roomCode(' ab12cd '), 'AB12CD');
  assert.throws(() => roomCode('../ABC'), /room code/);
  assert.throws(() => revision(-1), /revision/);
  assert.throws(() => command({ action: 'build', id: 100 }), /property/);
  assert.throws(() => command({ action: 'bid', increment: 10.5 }), /whole amount/);
  assert.throws(() => command({ action: 'replace-state' }), /Unknown/);
  assert.throws(() => profile({ name: 'A', role: 'admin', token: 'rocket' }), /role/);
});
