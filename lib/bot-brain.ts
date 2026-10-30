import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import MarketWars from './game-engine.cjs';
import { actingSeat } from './bot-timing';
import { chooseBotAction, judgeTrade } from './bot-strategy';
import type { Command, GameState } from './types';

// The AI only makes the judgement calls a person would think about: buy or skip, accept a trade, how high to bid,
// build now or keep the cash. Dice, rent, debts and every hard trading rule stay with the rule bot, which is also the
// fallback whenever the API is missing, slow or wrong. The key lives only in the server environment (ANTHROPIC_API_KEY).
// Provider, first key found wins: Groq (free tier) → OpenRouter → Claude. BOT_AI_MODEL overrides the model name.
const MODEL = 'claude-haiku-5-5';
const OPEN_PROVIDERS = [
  { key: process.env.GROQ_API_KEY, url: 'https://api.groq.com/openai/v1/chat/completions', model: 'openai/gpt-oss-20b' },
  { key: process.env.OPENROUTER_API_KEY, url: 'https://openrouter.ai/api/v1/chat/completions', model: 'openai/gpt-oss-20b:free' },
];
const open = OPEN_PROVIDERS.find(provider => provider.key);
const anthropic = !open && process.env.ANTHROPIC_API_KEY ? new Anthropic({ timeout: 4000, maxRetries: 0 }) : null;
const client = open || anthropic;

// Groq and OpenRouter speak the OpenAI chat format. gpt-oss reasons before answering, so it gets room and a low effort.
async function askOpen(provider: NonNullable<typeof open>, prompt: string): Promise<string | null> {
  const response = await fetch(provider.url, {
    method: 'POST', signal: AbortSignal.timeout(6000),
    headers: { Authorization: 'Bearer ' + provider.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.BOT_AI_MODEL || provider.model, max_tokens: 600, reasoning_effort: 'low',
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM + '\nReply as {"yes": boolean, "value": integer, "remark": string}.' }, { role: 'user', content: prompt }],
    }),
  });
  if (!response.ok) throw new Error(provider.url.split('/')[2] + ' ' + response.status);
  const body = await response.json() as { choices?: { message?: { content?: string } }[] };
  return body.choices?.[0]?.message?.content ?? null;
}

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

// Each bot plays (and talks) in its own style; the hard rules are the same for all of them.
const PERSONAS: Record<string, string> = {
  'Bot Ada': 'You are a careful accountant: keep a healthy cash cushion and only pay for clear value.',
  'Bot Atlas': 'You are an empire builder: grab land and build aggressively, accept some risk.',
  'Bot Nova': 'You are a shrewd dealmaker: hunt for trades that complete your sets and drive hard bargains.',
  'Bot Quinn': 'You are a spoiler: above all, deny rivals the colour sets they are close to.',
  'Bot Echo': 'You are a patient collector: focus on one or two colours and wait for the right moment.',
  'Bot Vega': 'You are a gambler: love auctions and bold bids, quick to take a chance.',
};

// Classic Super Buffed plays very differently: big money, tower-in-one-visit building, flat jail fine. The bot is told so.
function modeBriefing(state: GameState) {
  if (state.mode !== 'buffed') return '';
  const twists = (state.twists || []).map(id => MarketWars.TWISTS[id as keyof typeof MarketWars.TWISTS]).filter(Boolean);
  return `MODE: Classic Super Buffed. These rules REPLACE the normal ones:
- Everyone starts with $5,000 and gets $3,000 every time they pass Gateway of India. Cash is plentiful; property and towers win the game.
- After you land on a property you own (once it is bought, land on it again), you may build as many levels as you can afford in ONE visit, straight to the tower. No even-building rule.
- A tower's rent is about 25x a single house, so building a tower immediately on a busy property is usually right. Keep only about $1,000 spare.
- Buy almost every property you land on; each one is a future tower.
- You move one of two coupons each turn. Picking a jailed coupon after doubles (or a single-die 6) frees it for free and it moves; on other rolls it costs $5,000 and spends the roll; a jailed coupon left alone walks free after 8 turns.
- Rare cards: Hostile Takeover (seize any rival property) and Grand Swap (swap every property with a rival).` + (twists.length ? '\nTODAY\'S TWIST: ' + twists.map(twist => twist.name + ' - ' + twist.text).join(' | ') : '');
}
// The game the bot is deciding a move in; set by smartBotAction so every question carries the mode briefing.
let deciding: GameState | null = null;
async function ask(question: string, facts: { you?: string; [detail: string]: unknown }, state: GameState | null = deciding): Promise<Verdict | null> {
  if (!client) return null;
  const persona = PERSONAS[facts.you || ''];
  if (persona) question = persona + '\n' + question;
  const briefing = state ? modeBriefing(state) : '';
  if (briefing) question = briefing + '\n' + question;
  try {
    if (open) {
      const content = await askOpen(open, question + '\n' + JSON.stringify(facts));
      const parsed = content ? JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1)) as Verdict : null;
      if (!parsed || typeof parsed.yes !== 'boolean') return null;
      console.info('AI bot', process.env.BOT_AI_MODEL || open.model, facts.you, question.split('\n').pop()?.slice(0, 50), '->', parsed.yes, parsed.value || '', parsed.remark || '');
      return { yes: parsed.yes, value: Math.round(Number(parsed.value) || 0), remark: String(parsed.remark || '').slice(0, 60) };
    }
    const response = await anthropic!.messages.create({
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
  const holdings = (id: number) => game.board.filter(space => game.asset(space.id)?.owner === id)
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
  deciding = state;
  if (!client || !base) return base;
  const game = MarketWars.Game.restore(JSON.stringify(state)), seat = actingSeat(state), bot = game.player(seat);
  const key = room + ':' + state.turn + ':' + seat + ':';

  if (state.phase === 'offer') {
    const space = game.board[state.offer!], price = game.purchasePrice(bot, space);
    if (bot.cash < price + 75) return { action: 'skip' };   // never buy into bankruptcy
    const verdict = await ask('Buy this property for $' + price + '?', { property: property(game, space.id), ...facts(game, state, seat) }, state);
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
      const verdict = await ask('Auction: what is the most you would pay in total? Current bid $' + auction.bid + '.', { property: property(game, auction.property), ...facts(game, state, seat) }, state);
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
