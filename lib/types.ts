export type Token = 'black' | 'blue' | 'magenta' | 'lime';
export type BoardSides = 4 | 5 | 6;
// `sides` is the Host's board choice (only the Host's is used).
export type Profile = { name: string; token: Token; sides?: BoardSides };
export type Member = Profile & { user_id: string; seat: number; type?: 'human' | 'bot' };
export type Stats = Record<'propertiesPurchased' | 'rentEarned' | 'rentPaid' | 'buildingsBuilt' | 'taxesPaid' | 'startBonuses' | 'auctionWins' | 'cardsDrawn' | 'turnsPlayed' | 'bonusIncome', number>;
export type Player = Profile & { id: number; type?: 'human' | 'bot'; cash: number; position: number; bankrupt: boolean; penalty: { kind: 'prison'; attempts: number } | null; jailFree?: number; perks?: Record<'launch' | 'tailwind' | 'shield' | 'doubler' | 'reversal', number>; stats: Stats; color: string };
export type GameState = {
  sides?: BoardSides;
  version: number; players: Player[]; properties: Record<string, { owner: number | null; buildings: number; mortgaged: boolean; ready?: boolean }>;
  currentPlayer: number; turn: number; phase: 'ready' | 'end' | 'offer' | 'auction' | 'trade' | 'wheel' | 'freebuild' | 'event' | 'debt' | 'victory' | 'rolling' | 'moving';
  dice: number[]; offer: number | null; extraRoll: boolean; hasRolled: boolean; pending: { payer: number; creditor: number | null; amount: number; reason: string } | null;
  log: { id: number; turn: number; message: string; kind: string; tone?: 'gain' | 'loss' | 'power' | 'prison' | 'deal' | 'city'; player?: number; remark?: string }[];
  auction: { bidder: number; property: number; seller?: number | null; returnPhase?: 'ready' | 'end'; bid: number; leader: number | null; order: number[]; passed: number[] } | null;
  round?: number; jackpot?: number;
  city?: { upcoming: { kind: 'boom' | 'recession' | 'audit'; round: number } | null; active: { kind: 'boom' | 'recession' | 'audit'; until: number } | null; last?: 'boom' | 'recession' | 'audit' | null };
  wheelFree?: number;
  lastWheel?: { id: number; player: number; index: number; label: string; outcome: string } | null;
  lastDie?: { id: number; player: number; value: number; title: string; tone: 'gain' | 'loss' | 'neutral'; result: string; detail: string } | null;
  droppedDie?: number | null;
  trade?: (TradeOffer & { from: number; returnPhase: 'ready' | 'end' }) | null; tradesThisTurn?: number;
  tradeHistory?: { from: number; to: number; turn: number; properties: number[] }[];
  settings: Record<string, boolean | number>; winner: number | null;
};
export type TradeSide = { cash: number; properties: number[] };
export type TradeOffer = { to: number; give: TradeSide; get: TradeSide };
export type Room = {
  code: string; host_id: string; members: Member[]; member_ids: string[];
  status: 'lobby' | 'playing' | 'finished' | 'closed'; revision: number; state: GameState | null;
  created_at: string; updated_at: string; transition: Transition | null;
};
// `die` is set when the move threw a card die, so bots and turn timers wait for that throw to finish on screen.
export type Transition = { action: string; player: number; dice: number[]; path: number[]; sounds: string[]; die?: number };
export type Connection = { code: string; user_id: string; client_id: string; seen_at: string; connected: boolean };
export const ACTIONS = ['roll', 'end', 'buy', 'skip', 'auction', 'bid', 'pass', 'apply-event', 'release', 'build', 'sell', 'mortgage', 'unmortgage', 'settle', 'bankrupt', 'trade', 'accept-trade', 'reject-trade', 'spin', 'free-build'] as const;
export type GameAction = typeof ACTIONS[number];
// `note` is only ever set by the server's bot code (a reason for declining a trade); player commands are rebuilt without it.
export type Command = { action: GameAction; id?: number; increment?: number; trade?: TradeOffer; note?: string; remark?: string };
