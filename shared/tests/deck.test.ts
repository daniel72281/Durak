import { describe, it, expect } from 'vitest';
import { createDeck, shuffle, dealInitial, drawFromTop } from '../src/deck';
import {
  RANKS_IN_ORDER,
  SUITS_IN_ORDER,
  type Card,
  type Rank,
  type Suit,
} from '../src/types';

const cardKey = (c: Card) => `${c.suit}-${c.rank}`;

// Deterministic linear congruential generator for repeatable shuffles in tests.
const seededRng = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
};

describe('createDeck', () => {
  it('returns exactly 36 cards', () => {
    expect(createDeck()).toHaveLength(36);
  });

  it('contains 36 unique cards', () => {
    const deck = createDeck();
    const keys = new Set(deck.map(cardKey));
    expect(keys.size).toBe(36);
  });

  it('has 9 cards per suit', () => {
    const deck = createDeck();
    for (const suit of SUITS_IN_ORDER) {
      expect(deck.filter((c) => c.suit === suit)).toHaveLength(9);
    }
  });

  it('has 4 cards per rank', () => {
    const deck = createDeck();
    for (const rank of RANKS_IN_ORDER) {
      expect(deck.filter((c) => c.rank === rank)).toHaveLength(4);
    }
  });

  it('uses only valid ranks and suits', () => {
    const validRanks = new Set<Rank>(RANKS_IN_ORDER);
    const validSuits = new Set<Suit>(SUITS_IN_ORDER);
    for (const card of createDeck()) {
      expect(validSuits.has(card.suit)).toBe(true);
      expect(validRanks.has(card.rank)).toBe(true);
    }
  });
});

describe('shuffle', () => {
  it('does not mutate its input', () => {
    const original = createDeck();
    const snapshot = original.map(cardKey).join(',');
    shuffle(original);
    expect(original.map(cardKey).join(',')).toBe(snapshot);
  });

  it('preserves the multiset of cards', () => {
    const deck = createDeck();
    const shuffled = shuffle(deck);
    expect(shuffled).toHaveLength(deck.length);
    expect([...shuffled].map(cardKey).sort()).toEqual([...deck].map(cardKey).sort());
  });

  it('is deterministic with a seeded RNG', () => {
    const a = shuffle(createDeck(), seededRng(42));
    const b = shuffle(createDeck(), seededRng(42));
    expect(a.map(cardKey)).toEqual(b.map(cardKey));
  });

  it('produces different orderings for different seeds (sanity)', () => {
    const a = shuffle(createDeck(), seededRng(1));
    const b = shuffle(createDeck(), seededRng(2));
    expect(a.map(cardKey)).not.toEqual(b.map(cardKey));
  });
});

describe('dealInitial', () => {
  it('deals 6 cards per player by default and reveals trump', () => {
    const shuffled = shuffle(createDeck(), seededRng(7));
    const result = dealInitial(shuffled, 4);

    expect(result.hands).toHaveLength(4);
    for (const hand of result.hands) {
      expect(hand).toHaveLength(6);
    }
    expect(result.remaining).toHaveLength(36 - 4 * 6);
    expect(result.trumpCard).toEqual(result.remaining[0]);
    expect(result.trumpSuit).toBe(result.trumpCard.suit);
  });

  it('works for 2..5 players with a 36-card deck (trump card always remains)', () => {
    for (const n of [2, 3, 4, 5]) {
      const result = dealInitial(shuffle(createDeck(), seededRng(n)), n);
      expect(result.hands).toHaveLength(n);
      expect(result.remaining).toHaveLength(36 - n * 6);
      expect(result.remaining.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('rejects 6 players with the 36-card deck (would leave no trump)', () => {
    expect(() => dealInitial(shuffle(createDeck(), seededRng(6)), 6)).toThrow();
  });

  it('rejects fewer than 2 or more than 6 players (type-level limits)', () => {
    const shuffled = shuffle(createDeck());
    expect(() => dealInitial(shuffled, 1)).toThrow();
    expect(() => dealInitial(shuffled, 7)).toThrow();
  });

  it('never duplicates cards across hands and the remaining deck', () => {
    const shuffled = shuffle(createDeck(), seededRng(99));
    const result = dealInitial(shuffled, 5);
    const all = [...result.hands.flat(), ...result.remaining];
    expect(all).toHaveLength(36);
    expect(new Set(all.map(cardKey)).size).toBe(36);
  });

  it('does not mutate the input deck', () => {
    const shuffled = shuffle(createDeck(), seededRng(11));
    const before = shuffled.map(cardKey).join(',');
    dealInitial(shuffled, 3);
    expect(shuffled.map(cardKey).join(',')).toBe(before);
  });
});

describe('drawFromTop', () => {
  it('draws up to n cards and returns the remainder', () => {
    const shuffled = shuffle(createDeck(), seededRng(3));
    const { drawn, remaining } = drawFromTop(shuffled, 5);
    expect(drawn).toHaveLength(5);
    expect(remaining).toHaveLength(36 - 5);
  });

  it('caps at deck length when n exceeds available cards', () => {
    const small: Card[] = [
      { suit: 'hearts', rank: '6' },
      { suit: 'spades', rank: 'A' },
    ];
    const { drawn, remaining } = drawFromTop(small, 5);
    expect(drawn).toHaveLength(2);
    expect(remaining).toHaveLength(0);
  });

  it('does not mutate the input deck', () => {
    const deck = createDeck();
    const before = deck.map(cardKey).join(',');
    drawFromTop(deck, 10);
    expect(deck.map(cardKey).join(',')).toBe(before);
  });
});
