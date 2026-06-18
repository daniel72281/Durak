// Core agnostic data model shared across all games + the lobby. Game-
// specific shapes (Durak's GameState, Action, etc.) live in
// shared/src/games/<game>/types.ts. Pure types and constants only; no
// runtime imports of anything DOM- or Node-specific.

export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';

export const SUITS_IN_ORDER: readonly Suit[] = [
  'hearts',
  'diamonds',
  'clubs',
  'spades',
];

// Ranks in ascending order of value. '6' is the lowest; 'A' the highest.
// (Durak deck. Shithead adds '2'..'5' and possibly Joker — see its types.)
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

// What a single player sees of another player. Hidden info collapses to counts.
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
  // Cumulative points across all games played in this room.
  // Scoring per game (Durak; other games may differ):
  //   - first to empty their hand (outOrder[0]) → +2
  //   - middle finishers → +1
  //   - durak (loser) → 0
  // A draw (loser === null) still credits outOrder[0] with +2; the rest
  // get +1 since no one is the durak.
  points: number;
}

// --- Wire payload kept from the scaffold; legacy, may be removed.
export interface HelloPayload {
  message: string;
  socketId: string;
}
