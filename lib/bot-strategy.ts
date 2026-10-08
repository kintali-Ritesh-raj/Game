import MarketWars from './game-engine.cjs';
import { actingSeat } from './bot-timing';
import type { Command, GameState, TradeOffer } from './types';

type Engine = InstanceType<typeof MarketWars.Game>;
type Seat = GameState['players'][number];
// Offer limits, in rounds (one round = every active player takes a turn). Human players get far fewer
// offers: only ones that would finish the bot's colour set, at most one per bot every 8 rounds, and a
// declined property is not offered again for 20 rounds. Bots trade with each other more freely.
const BOT_PAIR_ROUNDS = 0, BOT_REPEAT_ROUNDS = 3;
const HUMAN_PAIR_ROUNDS = 8, HUMAN_REPEAT_ROUNDS = 20;

// Would `seat` own the whole color group of `id` if it held `extra` too?
function completesWith(game:Engine, seat:number, id:number, extra:number[] = []) {
  const space = MarketWars.BOARD[id];
  return game.groupSpaces(space.group).every(item => item.id === id || extra.includes(item.id) || game.asset(item.id).owner === seat);
}
// What a property is worth to its next holder: the price, doubled when it finishes their set.
function worthTo(game:Engine, seat:number, id:number, extra:number[]) {
  const space = MarketWars.BOARD[id], base = game.asset(id).mortgaged ? space.price * .45 : space.price;
  return completesWith(game, seat, id, extra) ? base * 2 : base;
}
/** Accept when what the bot receives is worth at least what it gives up, counting a set it would hand over. */
export function acceptsTrade(game:Engine, trade:TradeOffer & { from:number }) {
  const bot = game.player(trade.to), proposer = trade.from;
  if (bot.cash - trade.get.cash < 100) return false;
  const gain = trade.give.cash + trade.give.properties.reduce((sum, id) => sum + worthTo(game, bot.id, id, trade.give.properties), 0);
  const loss = trade.get.cash + trade.get.properties.reduce((sum, id) => sum + worthTo(game, proposer, id, trade.get.properties), 0);
  return gain >= loss;
}
/** Offer cash for a rival's property in a color where the bot holds at least as many. */
function tradeOffer(game:Engine, state:GameState, bot:Seat):TradeOffer | null {
  if ((state.tradesThisTurn || 0) > 0) return null;
  const round = Math.max(1, game.state.players.filter(player => !player.bankrupt).length);
  const human = (id:number) => game.player(id).type !== 'bot';
  const history = (state.tradeHistory || []).filter(item => item.from === bot.id);
  const recent = (to:number, id:number) => history.some(item => item.to === to && (
    state.turn - item.turn < (human(to) ? HUMAN_PAIR_ROUNDS : BOT_PAIR_ROUNDS) * round ||
    (item.properties.includes(id) && state.turn - item.turn < (human(to) ? HUMAN_REPEAT_ROUNDS : BOT_REPEAT_ROUNDS) * round)));
  const offers = MarketWars.BOARD.filter(space => space.type === 'property').flatMap(space => {
    const owner = game.asset(space.id).owner;
    if (owner === null || owner === bot.id || game.player(owner).bankrupt || recent(owner, space.id)) return [];
    const mine = game.groupSpaces(space.group).filter(item => game.asset(item.id).owner === bot.id).length;
    const theirs = game.groupSpaces(space.group).filter(item => game.asset(item.id).owner === owner).length;
    if (!mine || mine < theirs) return [];
    const completes = completesWith(game, bot.id, space.id);
    if (human(owner) && !completes) return [];
    const cash = Math.ceil(space.price * (completes ? 2 : 1.5) / 10) * 10 + 10;
    if (bot.cash < cash + 150) return [];
    const offer = { to: owner, give: { cash, properties: [] }, get: { cash: 0, properties: [space.id] } };
    return game.tradeReason(bot.id, offer) ? [] : [{ offer, completes, price: space.price }];
  });
  offers.sort((a, b) => Number(b.completes) - Number(a.completes) || b.price - a.price);
  return offers[0]?.offer || null;
}

/**
 * The forced move when a human's turn timer runs out. A detained player pays the $50 fine;
 * if that fine cannot be paid in cash, their lowest-rent property is mortgaged first.
 */
export function timeoutCommand(state: GameState): Command | { action: 'timeout' } {
  const game = MarketWars.Game.restore(JSON.stringify(state));
  const player = game.player(actingSeat(state));
  if (state.auction) return {action:'pass'};
  if (state.trade) return {action:'reject-trade'};
  if (state.pending) {
    if (!/penalty release/.test(state.pending.reason)) return chooseBotAction(state)!;
    if (player.cash >= state.pending.amount) return {action:'settle'};
    if (game.liquidatable(player) < state.pending.amount) return {action:'bankrupt'};
    const rent = (id:number) => game.calculateRent(id, 7);
    const collateral = game.owned(player).filter(space => !game.mortgageReason(player, space.id)).sort((a, b) => rent(a.id) - rent(b.id) || a.price - b.price)[0];
    if (collateral) return {action:'mortgage', id:collateral.id};
    const developed = game.owned(player).filter(space => !game.sellReason(player, space.id)).sort((a, b) => rent(a.id) - rent(b.id))[0];
    return developed ? {action:'sell', id:developed.id} : {action:'bankrupt'};
  }
  if (state.phase === 'event') return {action:'apply-event'};
  if (state.phase === 'ready' && player.penalty) return {action:'release'};
  return {action:'timeout'};
}

/** Chooses legal moves from public information; never reads future event cards. */
export function chooseBotAction(state: GameState): Command | null {
  const game = MarketWars.Game.restore(JSON.stringify(state));
  const player = game.player(actingSeat(state));
  const owned = game.owned(player);
  const reserve = 200;
  switch (state.phase) {
    case 'trade': return {action: acceptsTrade(game, state.trade!) ? 'accept-trade' : 'reject-trade'};
    case 'ready':
      if (player.penalty && player.cash >= 350) return {action:'release'};
      return {action:'roll'};
    case 'offer': {
      const property = MarketWars.BOARD[state.offer!];
      const completes = game.groupSpaces(property.group).every(space => space.id === property.id || game.asset(space.id).owner === player.id);
      return {action: player.cash >= game.purchasePrice(player, property) + (completes ? 75 : 150) ? 'buy' : 'skip'};
    }
    case 'auction': {
      const auction = state.auction!, property = MarketWars.BOARD[auction.property];
      const value = (completesWith(game, player.id, property.id) ? property.price * 1.5 : property.price) + game.asset(property.id).buildings * property.buildingCost * .5;
      return auction.bid + 10 <= Math.min(value, player.cash - reserve) ? {action:'bid',increment:10} : {action:'pass'};
    }
    case 'event': return {action:'apply-event'};
    case 'debt': {
      if (player.cash >= state.pending!.amount) return {action:'settle'};
      if (game.liquidatable(player) < state.pending!.amount) return {action:'bankrupt'};
      const collateral = owned.filter(space => !game.mortgageReason(player,space.id)).sort((a,b) => b.mortgageValue-a.mortgageValue)[0];
      if (collateral) return {action:'mortgage',id:collateral.id};
      const developed = owned.filter(space => !game.sellReason(player,space.id)).sort((a,b) => game.asset(b.id).buildings-game.asset(a.id).buildings)[0];
      if (developed) return {action:'sell',id:developed.id};
      throw new Error('The bot could not find a valid way to settle its debt.');
    }
    case 'end': {
      if (state.extraRoll) return {action:'roll'};
      const trade = tradeOffer(game, state, player);
      if (trade) return {action:'trade', trade};
      const mortgage = owned.find(space => game.asset(space.id).mortgaged && player.cash >= Math.ceil(space.mortgageValue * 1.1) + reserve);
      if (mortgage) return {action:'unmortgage',id:mortgage.id};
      const property = owned.filter(space => !game.buildReason(player,space.id) && player.cash >= game.buildingCost(player,space) + reserve)
        .sort((a,b) => game.asset(a.id).buildings-game.asset(b.id).buildings || game.buildingCost(player,a)-game.buildingCost(player,b))[0];
      return property ? {action:'build',id:property.id} : {action:'end'};
    }
    default: return null;
  }
}
