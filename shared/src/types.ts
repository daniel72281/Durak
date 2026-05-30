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
  // Order in which players emptied their hand (with deck also empty) — the
  // first id is 1st place, last is 2nd-to-last. The durak is the one NOT in
  // this list (set as `loser` once game ends).
  outOrder: string[];
  loser: string | null;     // player id of the durak once phase === 'finished'
  // Why the game ended. 'normal' = standard durak finish; 'player_disconnected'
  // = a player's reconnect-grace expired mid-game, so the round ends with no
  // winner (loser stays null) and the scoreboard isn't updated.
  endReason: 'normal' | 'player_disconnected' | null;
  // Reason the first attacker was chosen. Used by the client to show a one-
  // off banner at the start of each game. null after the first action.
  firstAttackerReason: 'six_of_trumps' | 'random' | 'previous_winner' | null;
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
  // Transient flag while the socket is dropped but the player still has a
  // chance to rejoin within the grace period.
  disconnected: boolean;
}

export interface PlayerScore {
  wins: number;   // games this player finished WITHOUT being the durak
  duraks: number; // games this player ended as the durak (loser)
}

export interface ClientGameState {
  roomId: string;
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
  defenderTaking: boolean;
  passedPlayerIds: string[];
  // Absolute epoch ms when the current required action times out, or null
  // when no timer is active (game finished / waiting for nothing).
  turnDeadline: number | null;
  // Order players went out, 1st place first; durak is `loser` (not in list).
  outOrder: string[];
  loser: string | null;
  endReason: 'normal' | 'player_disconnected' | null;
  firstAttackerReason: 'six_of_trumps' | 'random' | 'previous_winner' | null;
  // Cumulative scoreboard across all games played in this room.
  scoreboard: { [playerId: string]: PlayerScore };
}

// --- Wire payload kept from the scaffold; will be replaced by GameState
// messages once the engine wiring lands.
export interface HelloPayload {
  message: string;
  socketId: string;
}
