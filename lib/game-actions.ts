import { randomInt } from 'node:crypto';
import MarketWars from './game-engine.cjs';
import { ApiError } from './validation';
import type { Command, GameState, Room, Transition } from './types';

export function memberIndex(room: Room, actor: string) {
  const index = room.members.findIndex(member => member.user_id === actor);
  if (index === -1) throw new ApiError(403, 'You are not a player in this room.');
  return index;
}
export function requireRevision(room: Room, expected: number) {
  if (room.revision !== expected) throw new ApiError(409, 'The room changed. It has been synchronized; try your action again.');
}
const random = () => randomInt(0x100000000) / 0x100000000;
// Each die is an independent, exactly uniform draw from Node's cryptographic generator.
const rollDie = () => randomInt(1, 7);
const options = { random, rollDie, wait: async () => {} };

export function startGame(room: Room, actor: string) {
  memberIndex(room, actor);
  if (room.host_id !== actor) throw new ApiError(403, 'Only the Host can start the game.');
  if (room.status !== 'lobby') throw new ApiError(409, 'The game has already started.');
  const error = MarketWars.validatePlayers(room.members);
  if (error) throw new ApiError(400, error);
  // The Host picks the board in the lobby (stored on their member entry): 4 sides (40 spaces), 5 (50) or 6 (60).
  const sides = room.members.find(member => member.user_id === room.host_id)?.sides;
  const game = new MarketWars.Game(room.members, {}, { ...options, sides: sides === 5 || sides === 6 ? sides : 4 });
  game.state.players.forEach((player, seat) => { player.type = room.members[seat].type === 'bot' ? 'bot' : 'human'; });
  return JSON.parse(game.serialize()) as GameState;
}

export async function applyGameAction(room: Room, actor: string, command: Command | { action: 'timeout' }) {
  const seat = memberIndex(room, actor);
  if (room.status !== 'playing' || !room.state) throw new ApiError(409, 'This game is not accepting turns.');
  const state = room.state;
  const auctionAction = ['bid', 'pass'].includes(command.action);
  const managementAction = ['build', 'sell', 'mortgage', 'unmortgage', 'settle', 'bankrupt'].includes(command.action);
  const tradeResponse = ['accept-trade', 'reject-trade'].includes(command.action);
  // Auctions, event debts and trade answers can belong to a player other than the current turn.
  const actingSeat = auctionAction ? state.auction?.bidder : managementAction ? state.pending?.payer ?? state.currentPlayer : tradeResponse ? state.trade?.to : state.currentPlayer;
  if (seat !== actingSeat || state.players[seat].bankrupt) throw new ApiError(403, 'Only the acting player can take this action.');
  if (state.pending && !managementAction) throw new ApiError(409, 'The pending payment must be resolved first.');
  if (state.auction && !auctionAction) throw new ApiError(409, 'The auction must be resolved first.');
  if (state.trade && !tradeResponse) throw new ApiError(409, 'The trade offer must be answered first.');
  const transition: Transition = { action: command.action, player: state.currentPlayer, dice: [...state.dice], path: [], sounds: [] };
  let lastPosition = state.players[state.currentPlayer].position;
  const game = MarketWars.Game.restore(JSON.stringify(state), {
    ...options,
    onSound: (sound: string) => { if (!transition.sounds.includes(sound)) transition.sounds.push(sound); },
    onChange: (snapshot: GameState) => {
      const position = snapshot.players[transition.player].position;
      if (snapshot.phase === 'moving' && lastPosition !== position) {
        transition.path.push(position); lastPosition = position;
      }
    },
  });
  try {
    switch (command.action) {
      case 'roll': await game.rollDice(); break;
      case 'end': game.nextTurn(); break;
      case 'timeout': game.timeoutTurn(); break;
      case 'buy': game.purchaseProperty(); break;
      case 'skip': game.declineProperty(); break;
      case 'auction': game.startAuction(command.id); break;
      case 'bid': game.auctionBid(command.increment); break;
      case 'pass': game.auctionPass(); break;
      case 'apply-event': await game.applyCard(); break;
      case 'spin': game.spinWheel(); break;
      case 'free-build': game.freeBuild(command.id); break;
      case 'release': game.payPenalty(); break;
      case 'build': game.buildStructure(command.id); break;
      case 'sell': game.sellBuilding(command.id); break;
      case 'mortgage': game.mortgageProperty(command.id); break;
      case 'unmortgage': game.unmortgageProperty(command.id); break;
      case 'settle': game.settleDebt(); break;
      case 'bankrupt': game.declareBankruptcy(); break;
      case 'trade': game.proposeTrade(command.trade); break;
      case 'accept-trade': game.acceptTrade(); break;
      case 'reject-trade': game.rejectTrade('declined', 'note' in command ? command.note : '', 'remark' in command ? command.remark : ''); break;
    }
    // The unchanged model also starts movement from a payment continuation.
    // Drain that work before saving; animation never holds a database lock.
    for (let i = 0; game.busy && i < 100; i++) await new Promise<void>(resolve => setImmediate(resolve));
    if (game.busy) throw new Error('The move did not finish. Try again.');
    transition.dice = [...game.state.dice];
    if ((game.state.lastDie?.id || 0) > (state.lastDie?.id || 0)) transition.die = game.state.lastDie!.id;
    return { state: JSON.parse(game.serialize()) as GameState, transition };
  } catch (error) {
    throw new ApiError(400, error instanceof Error ? error.message : 'This action is unavailable.');
  }
}
