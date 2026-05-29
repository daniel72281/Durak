// Placeholder — the full game types and engine will live here.
// Will be expanded with: Card, Suit, Rank, Player, GameState, Action, etc.

export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';

export type Rank = '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  suit: Suit;
  rank: Rank;
}

export interface HelloPayload {
  message: string;
  socketId: string;
}
