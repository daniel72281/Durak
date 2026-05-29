// Core data model for Durak Online — shared between client (Vite/React)
// and server (Express/Socket.IO). Pure types and constants only; no runtime
// imports of anything DOM- or Node-specific.

export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';

export const SUITS_IN_ORDER: readonly Suit[] = [
  'hearts',
  'diamonds',
  'clubs',
  'spades',
];

// Ranks in ascending order of value. '6' is the lowest; 'A' the highest.
export const RANKS_IN_ORDER = [
  '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A',
] as const;
export type Rank = (typeof RANKS_IN_ORDER)[number];

export interface Card {
  suit: Suit;
  rank: Rank;
}

export interface Player {
  id: string;        // stable session id (or socket id)
  nickname: string;
  hand: Card[];      // server holds full hands; filter per-recipient when broadcasting
  isOut: boolean;    // true when player has finished their cards (deck also empty)
}

// A single attack on the table, with an optional defense card.
export interface TablePair {
  attack: Card;
  defense?: Card;
}

export type GamePhase = 'waiting' | 'playing' | 'finished';

// Authoritative state held on the server.
export interface GameState {
  phase: GamePhase;
  players: Player[];        // seat order (clockwise from index 0)
  deck: Card[];             // remaining draw pile; deck[0] is the bottom = trump card
  trumpSuit: Suit;
  discard: Card[];          // "bito" — successfully defended cards live here
  table: TablePair[];       // pairs currently in play for this round
  attackerIndex: number;    // index into players[] — opens the round
  defenderIndex: number;    // index into players[] — currently being attacked
  roundNumber: number;      // 1-indexed; round 1 caps attacks at 5, round 2+ at 6
  roundAttackLimit: number; // max attacks this round (computed at round start)
  passedPlayerIds: string[]; // non-defenders who have declared "pass" this round
  defenderTaking: boolean;  // true once defender declared 'take' (more throw-ins allowed)
  loser: string | null;     // player id of the durak once phase === 'finished'
}

// Actions a player can send over the wire. (Game lifecycle actions like
// startGame are server-internal — see startGame() in engine.ts.)
export type Action =
  | { type: 'attack'; playerId: string; card: Card }
  | { type: 'defend'; playerId: string; pairIndex: number; card: Card }
  | { type: 'transfer'; playerId: string; card: Card }   // Перевод pass-on
  | { type: 'take'; playerId: string }                   // defender picks up
  | { type: 'pass'; playerId: string };                  // attackers concede the round

// What a single player sees. Other players' hands collapse to counts so we
// never leak hidden information across the socket.
export interface PublicPlayer {
  id: string;
  nickname: string;
  handCount: number;
  isOut: boolean;
}

export interface ClientGameState {
  phase: GamePhase;
  selfHand: Card[];
  selfIndex: number;     // index of "me" in players[]
  players: PublicPlayer[];
  deckCount: number;
  trumpCard: Card | null; // visible bottom card while deck has cards
  trumpSuit: Suit;
  discardCount: number;
  table: TablePair[];
  attackerIndex: number;
  defenderIndex: number;
  loser: string | null;
}

// --- Wire payload kept from the scaffold; will be replaced by GameState
// messages once the engine wiring lands.
export interface HelloPayload {
  message: string;
  socketId: string;
}
