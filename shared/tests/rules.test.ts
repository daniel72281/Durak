import { describe, it, expect } from 'vitest';
import {
  beats,
  canAttackCard,
  canDefend,
  canTransfer,
  computeRoundAttackLimit,
  findDurak,
  nextActivePlayerIndex,
  rankIsOnTable,
  rankValue,
  tableIsFullyDefended,
} from '../src/rules';
import type { Card, Player, TablePair, Suit } from '../src/types';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });
const pair = (attack: Card, defense?: Card): TablePair => ({ attack, defense });
const TRUMP: Suit = 'hearts';

const player = (id: string, hand: Card[], isOut = false): Player => ({
  id,
  nickname: id,
  hand,
  isOut,
});

describe('rankValue', () => {
  it('orders ranks ascending: 6 lowest, A highest', () => {
    expect(rankValue('6')).toBe(0);
    expect(rankValue('A')).toBe(8);
    expect(rankValue('K')).toBeGreaterThan(rankValue('J'));
    expect(rankValue('10')).toBeGreaterThan(rankValue('9'));
  });
});

describe('beats', () => {
  it('higher same-suit beats lower same-suit', () => {
    expect(beats(c('7', 'spades'), c('K', 'spades'), TRUMP)).toBe(true);
  });

  it('lower same-suit does NOT beat higher', () => {
    expect(beats(c('K', 'spades'), c('7', 'spades'), TRUMP)).toBe(false);
  });

  it('equal-rank same-suit does NOT beat (defensive — impossible in real play)', () => {
    expect(beats(c('7', 'spades'), c('7', 'spades'), TRUMP)).toBe(false);
  });

  it('trump beats non-trump (any rank)', () => {
    expect(beats(c('A', 'spades'), c('6', 'hearts'), TRUMP)).toBe(true);
  });

  it('non-trump NEVER beats trump', () => {
    expect(beats(c('6', 'hearts'), c('A', 'spades'), TRUMP)).toBe(false);
  });

  it('higher trump beats lower trump', () => {
    expect(beats(c('7', 'hearts'), c('K', 'hearts'), TRUMP)).toBe(true);
  });

  it('different non-trump suits do NOT beat each other', () => {
    expect(beats(c('K', 'spades'), c('A', 'clubs'), TRUMP)).toBe(false);
  });
});

describe('canDefend', () => {
  it('true when hand has a higher same-suit card', () => {
    expect(canDefend([c('K', 'spades'), c('6', 'clubs')], c('7', 'spades'), TRUMP)).toBe(true);
  });

  it('true when hand has any trump against a non-trump attack', () => {
    expect(canDefend([c('6', 'hearts')], c('A', 'spades'), TRUMP)).toBe(true);
  });

  it('false when only lower same-suit and no trump', () => {
    expect(canDefend([c('6', 'spades'), c('7', 'clubs')], c('K', 'spades'), TRUMP)).toBe(false);
  });

  it('false against trump if no higher trump in hand', () => {
    expect(canDefend([c('A', 'spades'), c('K', 'clubs')], c('6', 'hearts'), TRUMP)).toBe(false);
  });

  it('false on empty hand', () => {
    expect(canDefend([], c('7', 'spades'), TRUMP)).toBe(false);
  });
});

describe('computeRoundAttackLimit', () => {
  it('caps round 1 at 5', () => {
    expect(computeRoundAttackLimit(1)).toBe(5);
  });

  it('caps round 2+ at 6', () => {
    expect(computeRoundAttackLimit(2)).toBe(6);
    expect(computeRoundAttackLimit(99)).toBe(6);
  });
});

describe('rankIsOnTable', () => {
  it('detects rank from an attack card', () => {
    expect(rankIsOnTable(c('7', 'hearts'), [pair(c('7', 'spades'))])).toBe(true);
  });

  it('detects rank from a defense card', () => {
    expect(
      rankIsOnTable(c('K', 'hearts'), [pair(c('7', 'spades'), c('K', 'spades'))]),
    ).toBe(true);
  });

  it('false when rank not present', () => {
    expect(
      rankIsOnTable(c('A', 'hearts'), [pair(c('7', 'spades'), c('K', 'spades'))]),
    ).toBe(false);
  });

  it('false on empty table', () => {
    expect(rankIsOnTable(c('A', 'hearts'), [])).toBe(false);
  });
});

describe('canAttackCard', () => {
  it('opening attack: any card on empty table when defender has cards', () => {
    expect(canAttackCard(c('6', 'hearts'), [], 6, 5)).toBe(true);
  });

  it('throw-in: must match a rank already on the table', () => {
    const table = [pair(c('7', 'spades'))];
    expect(canAttackCard(c('7', 'hearts'), table, 6, 5)).toBe(true);
    expect(canAttackCard(c('8', 'hearts'), table, 6, 5)).toBe(false);
  });

  it('rejects when table is at the round attack limit', () => {
    const table: TablePair[] = Array(5)
      .fill(null)
      .map(() => pair(c('7', 'spades'), c('K', 'spades')));
    expect(canAttackCard(c('7', 'hearts'), table, 6, 5)).toBe(false);
  });

  it('allows throw-in regardless of defender hand size (so long as > 0)', () => {
    // 3 cards on the table, 2 defended. The total cap (round limit) is
    // what caps throw-ins, not how many defended/undefended attacks there are.
    const table: TablePair[] = [
      pair(c('7', 'spades'), c('K', 'spades')),
      pair(c('7', 'clubs'), c('A', 'clubs')),
      pair(c('7', 'diamonds')),
    ];
    expect(canAttackCard(c('7', 'hearts'), table, 2, 6)).toBe(true);
  });

  it('rejects any attack/throw-in when defender has zero cards (user rule)', () => {
    // Opening attack to 0-card defender — blocked
    expect(canAttackCard(c('6', 'hearts'), [], 0, 5)).toBe(false);
    // Throw-in to 0-card defender — also blocked
    const table = [pair(c('7', 'spades'), c('K', 'spades'))];
    expect(canAttackCard(c('7', 'hearts'), table, 0, 6)).toBe(false);
  });

  it('still allows throw-ins to a 0-card defender who is taking (Infinity)', () => {
    // When defender is taking, callers pass Infinity — the "0 cards" rule
    // doesn't apply because the defender is collecting everything.
    const table = [pair(c('7', 'spades'))];
    expect(
      canAttackCard(c('7', 'hearts'), table, Number.POSITIVE_INFINITY, 6),
    ).toBe(true);
  });
});

describe('canTransfer', () => {
  it('allows transfer with matching rank and no defenses played', () => {
    expect(canTransfer(c('7', 'hearts'), [pair(c('7', 'spades'))], 5)).toBe(true);
  });

  it('rejects once any pair has been defended', () => {
    const table = [pair(c('7', 'spades'), c('K', 'spades'))];
    expect(canTransfer(c('7', 'hearts'), table, 5)).toBe(false);
  });

  it('rejects when rank does not match', () => {
    expect(canTransfer(c('8', 'hearts'), [pair(c('7', 'spades'))], 5)).toBe(false);
  });

  it('rejects on empty table (nothing to transfer)', () => {
    expect(canTransfer(c('7', 'hearts'), [], 5)).toBe(false);
  });

  it('rejects when new defender does not have enough cards for table + 1', () => {
    const table = [pair(c('7', 'spades')), pair(c('7', 'clubs'))];
    expect(canTransfer(c('7', 'hearts'), table, 2)).toBe(false);
    expect(canTransfer(c('7', 'hearts'), table, 3)).toBe(true);
  });

  it('rejects when attacks on table have mixed ranks (shouldn\'t happen, but defensive)', () => {
    const table = [pair(c('7', 'spades')), pair(c('8', 'clubs'))];
    expect(canTransfer(c('7', 'hearts'), table, 5)).toBe(false);
  });
});

describe('nextActivePlayerIndex', () => {
  it('returns the next index clockwise', () => {
    const players = [player('a', []), player('b', []), player('c', [])];
    expect(nextActivePlayerIndex(players, 0)).toBe(1);
    expect(nextActivePlayerIndex(players, 2)).toBe(0);
  });

  it('skips out players', () => {
    const players = [player('a', []), player('b', [], true), player('c', [])];
    expect(nextActivePlayerIndex(players, 0)).toBe(2);
  });

  it('returns -1 when everyone is out', () => {
    const players = [player('a', [], true), player('b', [], true)];
    expect(nextActivePlayerIndex(players, 0)).toBe(-1);
  });
});

describe('findDurak', () => {
  it('null while deck still has cards', () => {
    expect(findDurak([player('a', []), player('b', [c('6', 'hearts')])], 5)).toBe(null);
  });

  it('returns the lone remaining player\'s id when deck is empty', () => {
    expect(
      findDurak(
        [player('a', []), player('b', [c('6', 'hearts')]), player('c', [])],
        0,
      ),
    ).toBe('b');
  });

  it('null when multiple players still hold cards', () => {
    expect(
      findDurak(
        [player('a', [c('6', 'hearts')]), player('b', [c('7', 'spades')])],
        0,
      ),
    ).toBe(null);
  });

  it('null on a simultaneous-clearance draw', () => {
    expect(findDurak([player('a', []), player('b', [])], 0)).toBe(null);
  });
});

describe('tableIsFullyDefended', () => {
  it('false on empty table', () => {
    expect(tableIsFullyDefended([])).toBe(false);
  });

  it('true when every pair has a defense', () => {
    const table = [
      pair(c('7', 'spades'), c('K', 'spades')),
      pair(c('7', 'clubs'), c('A', 'clubs')),
    ];
    expect(tableIsFullyDefended(table)).toBe(true);
  });

  it('false when any pair is undefended', () => {
    const table = [
      pair(c('7', 'spades'), c('K', 'spades')),
      pair(c('7', 'clubs')),
    ];
    expect(tableIsFullyDefended(table)).toBe(false);
  });
});
