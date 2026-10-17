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
// ── Answering trade offers ──
// A bot weighs a trade by what it means for the board, not just list prices. Four hard rules come first, then a value
// check with a margin that moves with the game. Declines carry a short reason, and name a property the bot would rather have.
type Trade = TradeOffer & { from:number };
const BASE_MARGIN = .25, MAX_MARGIN = 1.2;
const groupName = (group:string) => MarketWars.GROUPS[group as keyof typeof MarketWars.GROUPS]?.name || group;
const cashText = (amount:number) => '$' + Math.round(amount).toLocaleString('en-US');

/** Who holds `id` once the trade goes through. */
function ownerAfter(game:Engine, trade:Trade, id:number) {
  return trade.give.properties.includes(id) ? trade.to : trade.get.properties.includes(id) ? trade.from : game.asset(id).owner;
}
function held(game:Engine, trade:Trade, seat:number, group:string, after:boolean) {
  return game.groupSpaces(group).filter(space => (after ? ownerAfter(game, trade, space.id) : game.asset(space.id).owner) === seat).length;
}
function ownsAll(game:Engine, trade:Trade, seat:number, group:string, after:boolean) {
  return held(game, trade, seat, group, after) === game.groupSpaces(group).length;
}
/** Land at its price (less the cost of lifting a mortgage) plus buildings at cost. Station and utility rents grow with the stage. */
function assetValue(game:Engine, id:number) {
  const space = MarketWars.BOARD[id], asset = game.asset(id);
  const land = asset.mortgaged ? space.price - game.unmortgageCost(id) : space.price;
  return (land + asset.buildings * (space.buildingCost || 0)) * (space.type === 'property' ? 1 : game.stage());
}
/** What owning a whole color is worth on top of its land: three quarters of the set's total price, since a full set doubles every rent on it. */
const setBonus = (game:Engine, group:string) => game.groupSpaces(group).reduce((sum, space) => sum + space.price, 0) * .75;
/** Cash the bot keeps for the worst single rent it could land on (a typical roll of 7 for utilities), between $150 and $700. */
export function cashReserve(game:Engine, seat:number) {
  const worst = MarketWars.BOARD.filter(space => space.price && game.asset(space.id).owner !== null && game.asset(space.id).owner !== seat)
    .reduce((max, space) => Math.max(max, game.calculateRent(space.id, 7)), 0);
  return Math.min(700, Math.max(150, worst));
}
/** The extra value a bot asks for, from 25% up to 120%, depending on who is asking, its cash, and how often they have asked lately. */
function tradeMargin(game:Engine, trade:Trade) {
  const bot = game.player(trade.to), rival = game.player(trade.from), living = game.living;
  const worth = (seat:number) => game.finances(game.player(seat)).netWorth;
  let margin = BASE_MARGIN;
  const leader = living.reduce((best, player) => worth(player.id) > worth(best.id) ? player : best, living[0]);
  if (leader.id === rival.id) margin += .15;                         // do not feed the player in the lead
  const reserve = cashReserve(game, bot.id);
  // A cash-rich bot has little use for more cash; a cash-poor one values it more.
  if (trade.give.cash > 0 && bot.cash > reserve * 3) margin += .15; else if (bot.cash < reserve) margin -= .1;
  // Every recent offer from the same player makes the bot warier, three times as much when they keep eyeing the same land.
  // That stops anyone probing for the exact price by raising the cash a little each time.
  const history = game.state.tradeHistory || [], last = history.at(-1);
  const props = [...trade.give.properties, ...trade.get.properties];
  const current = last && last.from === trade.from && last.to === trade.to && last.turn === game.state.turn && last.properties.length === props.length && props.every(id => last.properties.includes(id));
  const window = 8 * Math.max(1, living.length);
  for (const item of current ? history.slice(0, -1) : history) {
    if (item.from !== trade.from || item.to !== trade.to || game.state.turn - item.turn >= window) continue;
    margin += item.properties.some(id => trade.get.properties.includes(id)) ? .15 : .05;
  }
  return Math.min(MAX_MARGIN, Math.max(.15, margin));
}
/** A property of the proposer's that would finish (or at least advance) one of the bot's colors, for the decline message. */
function wantedFrom(game:Engine, trade:Trade) {
  const candidates = game.owned(game.player(trade.from)).filter(space => space.type === 'property' && !game.asset(space.id).buildings && !trade.give.properties.includes(space.id));
  const others = (space:typeof candidates[number]) => game.groupSpaces(space.group).filter(item => item.id !== space.id);
  return candidates.find(space => others(space).every(item => game.asset(item.id).owner === trade.to))
    || candidates.find(space => others(space).some(item => game.asset(item.id).owner === trade.to));
}
export function judgeTrade(game:Engine, trade:Trade): { accept:boolean; note:string } {
  const botId = trade.to, rivalId = trade.from, bot = game.player(botId);
  const groups = [...new Set([...trade.give.properties, ...trade.get.properties].map(id => MarketWars.BOARD[id].group))];
  const botCompletes = groups.some(group => ownsAll(game, trade, botId, group, true) && !ownsAll(game, trade, botId, group, false));
  const decline = (reason:string) => {
    const wanted = wantedFrom(game, trade);
    return { accept: false, note: reason + '.' + (wanted ? ' It would consider a trade for ' + wanted.name + '.' : '') };
  };
  // 1-3. Properties the bot would give up.
  for (const id of trade.get.properties) {
    const group = MarketWars.BOARD[id].group;
    if (ownsAll(game, trade, botId, group, false)) return decline('It will not break up its full ' + groupName(group) + ' set');
    if (botCompletes) continue; // a set for a set is the one swap the bot will weigh on value
    if (ownsAll(game, trade, rivalId, group, true)) return decline('It will not hand over the last ' + groupName(group) + ' property');
    if (held(game, trade, botId, group, false) >= 2) return decline('It is collecting ' + groupName(group) + ' and will not sell');
  }
  // 4. Cash it would pay out must leave a safety reserve.
  const reserve = cashReserve(game, botId), cashAfter = bot.cash - trade.get.cash + trade.give.cash;
  if (trade.get.cash > 0 && cashAfter < reserve) return decline('It keeps at least ' + cashText(reserve) + ' in cash for rent');
  // Value: what the bot receives against what it gives up, including what the proposer gains from it.
  let gain = trade.give.cash, loss = trade.get.cash;
  for (const id of trade.give.properties) {
    const space = MarketWars.BOARD[id];
    gain += assetValue(game, id);
    if (ownsAll(game, trade, botId, space.group, true) && !ownsAll(game, trade, botId, space.group, false)) gain += setBonus(game, space.group) / Math.max(1, trade.give.properties.filter(other => MarketWars.BOARD[other].group === space.group).length);
    else if (held(game, trade, botId, space.group, true) >= 2 && held(game, trade, botId, space.group, false) < 2) gain += space.price * .3;
  }
  for (const id of trade.get.properties) {
    const space = MarketWars.BOARD[id];
    loss += assetValue(game, id);
    if (ownsAll(game, trade, rivalId, space.group, true)) loss += setBonus(game, space.group) * 1.5;        // only reachable in a set-for-a-set swap
    else if (held(game, trade, rivalId, space.group, true) >= 2 && held(game, trade, rivalId, space.group, false) < 2) loss += space.price * .35; // they reach 2 of the color
    if (held(game, trade, botId, space.group, false) >= 2) loss += space.price * .5;                        // it was collecting this color
    else if (game.groupSpaces(space.group).length > 1 && game.groupSpaces(space.group).some(item => game.asset(item.id).owner === null)) loss += space.price * .1; // a color still open to collect
  }
  const margin = tradeMargin(game, trade);
  if (gain >= loss * (1 + margin)) return { accept: true, note: '' };
  return decline('The offer is too low for it');
}
/** Accept only what passes the hard rules and the value check. */
export function acceptsTrade(game:Engine, trade:Trade) { return judgeTrade(game, trade).accept; }
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
    const cash = Math.ceil((space.price * (completes ? 2 : 1.5) + game.asset(space.id).buildings * space.buildingCost) / 10) * 10 + 10;
    if (bot.cash < cash + 150) return [];
    const offer = { to: owner, give: { cash, properties: [] }, get: { cash: 0, properties: [space.id] } };
    if (game.tradeReason(bot.id, offer) || (!human(owner) && !acceptsTrade(game, { ...offer, from: bot.id }))) return [];
    return [{ offer, completes, price: space.price }];
  });
  offers.sort((a, b) => Number(b.completes) - Number(a.completes) || b.price - a.price);
  return offers[0]?.offer || null;
}

/** The Free house prize: bots (and timeouts) build on the lowest-built eligible property, lowest property first on ties. */
function freeHouse(game:Engine, player:Seat):Command {
  const target = game.freeBuildTargets(player).sort((a,b) => game.asset(a.id).buildings-game.asset(b.id).buildings || a.id-b.id)[0];
  return target ? {action:'free-build',id:target.id} : {action:'timeout'} as unknown as Command;
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
  if (state.phase === 'wheel') return {action:'spin'};
  if (state.phase === 'freebuild') return freeHouse(game, player);
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
    case 'trade': { const verdict = judgeTrade(game, state.trade!); return verdict.accept ? {action:'accept-trade'} : {action:'reject-trade', note: verdict.note}; }
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
    case 'wheel': return {action:'spin'};
    case 'freebuild': return freeHouse(game, player);
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
      const mortgage = owned.find(space => game.asset(space.id).mortgaged && player.cash >= game.unmortgageCost(space.id) + reserve);
      if (mortgage) return {action:'unmortgage',id:mortgage.id};
      const property = owned.filter(space => !game.buildReason(player,space.id) && player.cash >= game.buildingCost(player,space) + reserve)
        .sort((a,b) => game.asset(a.id).buildings-game.asset(b.id).buildings || game.buildingCost(player,a)-game.buildingCost(player,b))[0];
      return property ? {action:'build',id:property.id} : {action:'end'};
    }
    default: return null;
  }
}
