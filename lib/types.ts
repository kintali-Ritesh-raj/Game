export type Role = 'monopolist' | 'competitor';
export type Token = 'briefcase' | 'rocket' | 'building' | 'car' | 'coin' | 'crown' | 'factory' | 'laptop';
export type Profile = { name: string; role: Role; token: Token };
export type Member = Profile & { user_id: string; seat: number };
export type Stats = Record<'propertiesPurchased' | 'rentEarned' | 'rentPaid' | 'buildingsBuilt' | 'taxesPaid' | 'startBonuses' | 'auctionWins' | 'cardsDrawn' | 'turnsPlayed' | 'bonusIncome', number>;
export type Player = Profile & { id: number; cash: number; position: number; bankrupt: boolean; penalty: { kind: 'prison' | 'pricewar'; attempts: number } | null; stats: Stats; color: string };
export type GameState = {
  version: number; players: Player[]; properties: Record<string, { owner: number | null; buildings: number; mortgaged: boolean }>;
  currentPlayer: number; turn: number; phase: 'ready' | 'end' | 'offer' | 'auction' | 'event' | 'debt' | 'victory' | 'rolling' | 'moving';
  dice: number[]; pending: { payer: number; creditor: number | null; amount: number; reason: string } | null;
  auction: { bidder: number; property: number; seller?: number | null; returnPhase?: 'ready' | 'end'; bid: number; leader: number | null; order: number[]; passed: number[] } | null;
  settings: Record<string, boolean | number>; winner: number | null;
};
export type Room = {
  code: string; host_id: string; members: Member[]; member_ids: string[];
  status: 'lobby' | 'playing' | 'finished' | 'closed'; revision: number; state: GameState | null;
  created_at: string; updated_at: string; transition: Transition | null;
};
export type Transition = { action: string; player: number; dice: number[]; path: number[]; sounds: string[] };
export type Connection = { code: string; user_id: string; client_id: string; seen_at: string; connected: boolean };
export const ACTIONS = ['roll', 'end', 'buy', 'skip', 'auction', 'bid', 'pass', 'apply-event', 'release', 'build', 'sell', 'mortgage', 'unmortgage', 'settle', 'bankrupt'] as const;
export type GameAction = typeof ACTIONS[number];
export type Command = { action: GameAction; id?: number; increment?: number };
