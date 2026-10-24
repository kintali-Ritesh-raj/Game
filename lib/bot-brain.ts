import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import MarketWars from './game-engine.cjs';
import { actingSeat } from './bot-timing';
import { chooseBotAction, judgeTrade } from './bot-strategy';
import type { Command, GameState } from './types';

// The AI only makes the judgement calls a person would think about: buy or skip, accept a trade, how high to bid,
// build now or keep the cash. Dice, rent, debts and every hard trading rule stay with the rule bot, which is also the
// fallback whenever the API is missing, slow or wrong. The key lives only in the server environment (ANTHROPIC_API_KEY).
const MODEL = 'claude-haiku-5-5';
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ timeout: 4000, maxRetries: 0 }) : null;

type Engine = InstanceType<typeof MarketWars.Game>;
type Verdict = { yes: boolean; value: number; remark: string };

const SYSTEM = `You are a sharp, competitive player in a Monopoly-style board game ("Monopoly: No Mercy").
Rules that matter for your choices:
- Owning every property of a colour doubles all its built rents. Houses can only be built on a property you land on again after buying it, one level per landing, built evenly.
- Rent and rewards grow with the game stage (x2 after round 15, x3 after 30, x4 after 80, x5 after 130), so cash is worth less later on.
- Running out of cash means mortgaging, selling, then bankruptcy. Keep enough cash to survive likely rents.
Play to win: complete colour sets, deny rivals their sets, and never take a deal that mostly helps the other player.
Answer with JSON only. "remark" is at most 6 words, in character, shown to other players.`;

const SCHEMA = {
  type: 'object',
  properties: {
    yes: { type: 'boolean', description: 'true to buy / accept / build' },
    value: { type: 'integer', description: 'auctions: the highest total bid you would pay; otherwise 0' },
    remark: { type: 'string' },
  },
  required: ['yes', 'value', 'remark'],
  additionalProperties: false,
};

async function ask(question: string, facts: object): Promise<Verdict | null> {
  if (!client) return null;
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      thinking: { type: 'disabled' },
      system: SYSTEM,
      messages: [{ role: 'user', content: question + '\n' + JSON.stringify(facts) }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    });
    if (response.stop_reason !== 'end_turn') return null;
    const text = response.content.find(block => block.type === 'text');
    const parsed = text?.type === 'text' ? JSON.parse(text.text) as Verdict : null;
    return parsed && typeof parsed.yes === 'boolean' ? { ...parsed, remark: String(parsed.remark || '').slice(0, 60) } : null;
  } catch (caught) {
    console.warn('AI bot fell back to rules:', caught instanceof Error ? caught.message : caught);
    return null;
  }
}

// What the bot can see, kept short: every call is billed by its size.
function facts(game: Engine, state: GameState, seat: number) {
  const holdings = (id: number) => game.board.filter(space => game.asset(space.id).owner === id)
    .map(space => space.name + (game.asset(space.id).buildings ? ' (' + game.asset(space.id).buildings + ' bld)' : '') + (game.asset(space.id).mortgaged ? ' (mortgaged)' : ''));
  return {
    round: state.round ?? state.turn,
    you: game.player(seat).name,
    players: state.players.filter(player => !player.bankrupt).map(player => ({ name: player.name, cash: player.cash, owns: holdings(player.id) })),
  };
}
function property(game: Engine, id: number) {
  const space = game.board[id], group = game.groupSpaces(space.group);
  return { name: space.name, colour: space.group, price: space.price, rent: game.calculateRent(id, 7),
    colourOwners: group.map(item => item.name + ': ' + (game.asset(item.id).owner === null ? 'bank' : game.player(game.asset(item.id).owner!).name)) };
}

// Short-lived memory per server instance: an auction asks once for its ceiling, and a declined build is not asked
// again on the same turn. Losing it (another instance) only costs one more call.
const memory = new Map<string, number>();
function remember(key: string, value: number) { memory.set(key, value); if (memory.size > 500) memory.delete(memory.keys().next().value!); }

export async function smartBotAction(state: GameState, room: string): Promise<Command | null> {
  const base = chooseBotAction(state);
  if (!client || !base) return base;
  const game = MarketWars.Game.restore(JSON.stringify(state)), seat = actingSeat(state), bot = game.player(seat);
  const key = room + ':' + state.turn + ':' + seat + ':';

  if (state.phase === 'offer') {
    const space = game.board[state.offer!], price = game.purchasePrice(bot, space);
    if (bot.cash < price + 75) return { action: 'skip' };   // never buy into bankruptcy
    const verdict = await ask('Buy this property for $' + price + '?', { property: property(game, space.id), ...facts(game, state, seat) });
    return verdict ? { action: verdict.yes ? 'buy' : 'skip' } : base;
  }

  if (state.phase === 'trade') {
    const trade = state.trade!, rule = judgeTrade(game, trade);
    // The hard rules (breaking a set, handing over a set, cash reserve) are final; the AI only weighs value.
    if (!rule.accept && !rule.note.startsWith('The offer is too low')) return base;
    const names = (ids: number[]) => ids.map(id => property(game, id));
    const verdict = await ask('A rival offers you a trade. Accept?', {
      from: game.player(trade.from).name, youReceive: { cash: trade.give.cash, properties: names(trade.give.properties) },
      youGive: { cash: trade.get.cash, properties: names(trade.get.properties) },
      ruleBotWould: rule.accept ? 'accept' : 'decline (value too low)', ...facts(game, state, seat),
    });
    if (!verdict) return base;
    return verdict.yes ? { action: 'accept-trade' } : { action: 'reject-trade', note: rule.accept ? 'It weighed the deal and passed.' : rule.note, remark: verdict.remark || rule.remark };
  }

  if (state.phase === 'auction') {
    const auction = state.auction!, slot = key + 'bid:' + auction.property;
    let ceiling = memory.get(slot);
    if (ceiling === undefined) {
      const verdict = await ask('Auction: what is the most you would pay in total? Current bid $' + auction.bid + '.', { property: property(game, auction.property), ...facts(game, state, seat) });
      if (!verdict) return base;
      ceiling = verdict.yes ? Math.max(0, verdict.value) : 0;
      remember(slot, ceiling);
    }
    return auction.bid + 10 <= Math.min(ceiling, bot.cash - 200) ? { action: 'bid', increment: 10 } : { action: 'pass' };
  }

  if (state.phase === 'end' && base.action === 'build') {
    const slot = key + 'build:' + base.id;
    if (memory.get(slot) === 0) return { action: 'end' };
    const verdict = await ask('Build one more level here now (cost $' + game.buildingCost(bot, game.board[base.id!]) + '), or keep the cash?', { property: property(game, base.id!), ...facts(game, state, seat) });
    if (verdict && !verdict.yes) { remember(slot, 0); return { action: 'end' }; }
  }
  return base;
}
