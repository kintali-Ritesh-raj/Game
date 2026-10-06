import type { GameState, Profile } from './types';
interface EngineOptions { random?:()=>number; wait?:(ms:number)=>Promise<void>; onChange?:(state:GameState)=>void; onSound?:(sound:string)=>void }
declare class Game {
  constructor(players:Profile[], settings?:Record<string,boolean|number>, options?:EngineOptions);
  state: GameState;
  readonly busy:boolean;
  readonly active:GameState['players'][number];
  readonly managerPlayer:GameState['players'][number];
  static restore(save:string,options?:EngineOptions):Game;
  serialize():string;
  rollDice():Promise<void>; applyCard():Promise<void>; nextTurn():void;
  purchaseProperty():void; declineProperty():void; startAuction(id?:number):void; auctionBid(increment?:number):void; auctionPass():void;
  payPenalty():void; buildStructure(id?:number):void; sellBuilding(id?:number):void; mortgageProperty(id?:number):void; unmortgageProperty(id?:number):void;
  settleDebt():void; declareBankruptcy():void; resolveSpace():void;
  beginPayments(payments:{payer:number;creditor:number|null;amount:number;reason:string;category:string}[],continuation?:{kind:string;steps?:number}):void;
}
declare const MarketWars: {Game:typeof Game;validatePlayers(players:Profile[]):string;TOKENS:Record<string,string>;COLORS:string[]};
export = MarketWars;
