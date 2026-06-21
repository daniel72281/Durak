import {
  type Card,
  type Suit,
  RANKS_IN_ORDER,
  SUITS_IN_ORDER,
} from './types';

// Returns a fresh 36-card Durak deck in a deterministic order.
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS_IN_ORDER) {
    for (const rank of RANKS_IN_ORDER) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

// Returns a fresh 54-card Shithead deck: full 52 (ranks 2..A across the
// four suits) plus two distinct jokers (rank='JOKER', one in spades for
// the "black" joker and one in hearts for the "red" joker — the suit
// just gives them unique cardKeys so the client can dedupe them).
export function createShitheadDeck(): Card[] {
  const ranks = [
    '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A',
  ] as const;
  const deck: Card[] = [];
  for (const suit of SUITS_IN_ORDER) {
    for (const rank of ranks) {
      deck.push({ suit, rank });
    }
  }
  deck.push({ suit: 'spades', rank: 'JOKER' });
  deck.push({ suit: 'hearts', rank: 'JOKER' });
  return deck;
}

// Fisher–Yates shuffle. Returns a NEW array; does not mutate the input.
// Accepts an optional RNG (defaults to Math.random) so tests can be
// deterministic by passing a seeded function.
export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

export interface DealResult {
  hands: Card[][];   // hands[playerIndex]
  remaining: Card[]; // deck after dealing; remaining[0] is the trump (drawn last)
  trumpCard: Card;
  trumpSuit: Suit;
}

// Deals `handSize` cards to each of `playerCount` players, drawing from the
// TOP of the deck (the end of the array via .pop()). After dealing, the
// bottom card (remaining[0]) is the trump and is visible to all players.
//
// Standard Durak with the 36-card deck supports 2–5 players × 6 cards
// (leaves at least 1 card for the trump). 6 players requires a 52-card
// deck — out of scope for the current MVP, will throw here.
export function dealInitial(
  shuffled: readonly Card[],
  playerCount: number,
  handSize = 6,
): DealResult {
  if (playerCount < 2 || playerCount > 6) {
    throw new Error(`playerCount must be between 2 and 6 (got ${playerCount})`);
  }
  if (shuffled.length < playerCount * handSize + 1) {
    throw new Error(
      `not enough cards: need ${playerCount * handSize + 1}, got ${shuffled.length} ` +
      `(36-card deck supports up to 5 players)`,
    );
  }

  const deck = shuffled.slice();
  const hands: Card[][] = Array.from({ length: playerCount }, () => []);

  // Deal one card at a time around the table (standard rule).
  for (let card = 0; card < handSize; card++) {
    for (let p = 0; p < playerCount; p++) {
      hands[p]!.push(deck.pop()!);
    }
  }

  const trumpCard = deck[0]!;
  return {
    hands,
    remaining: deck,
    trumpCard,
    trumpSuit: trumpCard.suit,
  };
}

// Draws up to `n` cards from the top (end) of the deck. Returns the drawn
// cards and the new deck. Does not mutate the input.
export function drawFromTop(deck: readonly Card[], n: number): { drawn: Card[]; remaining: Card[] } {
  const remaining = deck.slice();
  const drawn: Card[] = [];
  for (let i = 0; i < n && remaining.length > 0; i++) {
    drawn.push(remaining.pop()!);
  }
  return { drawn, remaining };
}
