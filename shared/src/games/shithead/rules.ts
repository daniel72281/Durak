// Pure predicates for Shithead. No state mutation, no I/O — just functions
// that say what is or isn't legal. The engine guards every action with
// these before applying it.

import type { Card } from '../../types';
import { SHITHEAD_RANKS_IN_ORDER } from './types';

// Numeric value for ranks Shithead reasons about. Joker is excluded —
// it never compares; the rules check rank === 'JOKER' as a special case.
// Returns -1 for unknown ranks (shouldn't happen unless data is corrupt).
export function rankValue(rank: Card['rank']): number {
  return SHITHEAD_RANKS_IN_ORDER.indexOf(rank as never);
}

// "Magic" cards can be placed on any non-Queen top regardless of rank.
// Each has its own effect (see engine.ts handlePlay).
//   - 2     resets the rank constraint
//   - 3     mirrors the card beneath (next must beat what's under the 3)
//   - 10    burns the pile and earns the player another turn
//   - JOKER lets the player pick someone to swallow the pile
export function isMagic(card: Card): boolean {
  return (
    card.rank === '2' ||
    card.rank === '3' ||
    card.rank === '10' ||
    card.rank === 'JOKER'
  );
}

// The constraint a non-magic card must satisfy to land on the pile.
//   - 'none'     no constraint (empty pile, top is 2, or all-3s on top)
//   - { gte, R } card.rank must be >= R (numeric)
//   - 'lte7'     card.rank must be <= 7 (the 7-invert rule)
//
// Resolution algorithm (top-down):
//   - 3   → skip (mirror — look at what's under)
//   - 2   → 'none' (reset)
//   - 7   → 'lte7'
//   - X   → { gte, X }
//   - end → 'none' (pile is empty or only 2s/3s)
//
// Magic cards always bypass this — see canPlay.
export type RankConstraint =
  | { kind: 'none' }
  | { kind: 'gte'; rank: Card['rank'] }
  | { kind: 'lte7' };

export function effectiveConstraint(pile: readonly Card[]): RankConstraint {
  for (let i = pile.length - 1; i >= 0; i--) {
    const c = pile[i]!;
    if (c.rank === '3') continue; // mirror — look deeper
    if (c.rank === '2') return { kind: 'none' };
    if (c.rank === '7') return { kind: 'lte7' };
    // 10 and Joker never sit on the pile (they burn/take), but defensively:
    if (c.rank === '10' || c.rank === 'JOKER') continue;
    return { kind: 'gte', rank: c.rank };
  }
  return { kind: 'none' };
}

// Is `card` a legal regular play on top of `pile`?
//   - Empty pile: anything legal.
//   - Top is Queen and card is magic: blocked (Queen's special power).
//   - Magic card on a non-Queen top: legal.
//   - Non-magic card: must satisfy effectiveConstraint.
export function canPlay(card: Card, pile: readonly Card[]): boolean {
  if (pile.length === 0) return true;
  const top = pile[pile.length - 1]!;
  if (top.rank === 'Q' && isMagic(card)) return false;
  if (isMagic(card)) return true;
  const c = effectiveConstraint(pile);
  if (c.kind === 'none') return true;
  if (c.kind === 'lte7') return rankValue(card.rank) <= rankValue('7');
  return rankValue(card.rank) >= rankValue(c.rank);
}

// Is `card` a legal 4-burst — playing a 4 out of turn?
//
// The pile must be either:
//   - empty (game start, after a take, after a burn), OR
//   - composed entirely of 4s (a burst chain is in progress: an earlier
//     player bursted with their 4(s) and the next player hasn't yet
//     interrupted with a non-4 card, so anyone else who holds a 4 can
//     still pile on).
export function canBurst(card: Card, pile: readonly Card[]): boolean {
  if (card.rank !== '4') return false;
  if (pile.length === 0) return true;
  return pile.every((c) => c.rank === '4');
}

// Do the last four cards on the pile share the same rank? Triggers an
// automatic burn (the player who just played gets another turn).
export function pileHasFourInARow(pile: readonly Card[]): boolean {
  if (pile.length < 4) return false;
  const top = pile[pile.length - 1]!;
  for (let i = pile.length - 2; i >= pile.length - 4; i--) {
    if (pile[i]!.rank !== top.rank) return false;
  }
  return true;
}

// Next active player index after `from`, wrapping clockwise and skipping
// players who are out. Returns -1 when no active player exists (game is
// effectively over).
export function nextActivePlayerIndex(
  players: readonly { isOut: boolean }[],
  from: number,
): number {
  const n = players.length;
  for (let step = 1; step <= n; step++) {
    const i = (from + step) % n;
    if (!players[i]!.isOut) return i;
  }
  return -1;
}
