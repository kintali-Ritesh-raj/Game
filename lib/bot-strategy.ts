import MarketWars from './game-engine.cjs';
import type { Command, GameState } from './types';

/** Chooses legal moves from public information; never reads future event cards. */
export function chooseBotAction(state: GameState): Command | null {
  const game = MarketWars.Game.restore(JSON.stringify(state));
  const player = game.player(state.pending?.payer ?? state.auction?.bidder ?? state.currentPlayer);
  const owned = game.owned(player);
  const reserve = 200;
  switch (state.phase) {
    case 'ready':
      if (player.penalty && player.cash >= 350) return {action:'release'};
      return {action:'roll'};
    case 'offer': {
      const property = MarketWars.BOARD[state.offer!];
      const completes = game.groupSpaces(property.group).every(space => space.id === property.id || game.asset(space.id).owner === player.id);
      return {action: player.cash >= property.price + (completes ? 75 : 150) ? 'buy' : 'skip'};
    }
    case 'auction': {
      const auction = state.auction!, property = MarketWars.BOARD[auction.property];
      const value = property.price + game.asset(property.id).buildings * property.buildingCost * .5;
      return auction.bid + 10 <= Math.min(value, player.cash - reserve) ? {action:'bid',increment:10} : {action:'pass'};
    }
    case 'event': return {action:'apply-event'};
    case 'debt': {
      if (player.cash >= state.pending!.amount) return {action:'settle'};
      if (game.liquidatable(player) < state.pending!.amount) return {action:'bankrupt'};
      const collateral = owned.filter(space => !game.mortgageReason(player,space.id)).sort((a,b) => b.mortgageValue-a.mortgageValue)[0];
      if (collateral) return {action:'mortgage',id:collateral.id};
      const developed = owned.filter(space => game.asset(space.id).buildings > 0).sort((a,b) => game.asset(a.id).buildings-game.asset(b.id).buildings)[0];
      if (developed) return {action:'sell',id:developed.id};
      throw new Error('The bot could not find a valid way to settle its debt.');
    }
    case 'end': {
      if (state.extraRoll) return {action:'roll'};
      const mortgage = owned.find(space => game.asset(space.id).mortgaged && player.cash >= Math.ceil(space.mortgageValue * 1.1) + reserve);
      if (mortgage) return {action:'unmortgage',id:mortgage.id};
      const property = owned.filter(space => !game.buildReason(player,space.id) && player.cash >= game.buildingCost(player,space) + reserve)
        .sort((a,b) => game.asset(a.id).buildings-game.asset(b.id).buildings || game.buildingCost(player,a)-game.buildingCost(player,b))[0];
      return property ? {action:'build',id:property.id} : {action:'end'};
    }
    default: return null;
  }
}
