// Pure predicates and helpers for the Durak (Переводной) rules.
// No state mutation, no I/O — just functions that say what is or isn't legal.
// The engine (engine.ts) uses these as guards before applying actions.

import {
  type Card,
  type Suit,
  type Player,
  type TablePair,
  RANKS_IN_ORDER,
} from './types';

// Numeric value for rank comparison. 6 → 0, A → 8.
export function rankValue(rank: Card['rank']): number {
  return RANKS_IN_ORDER.indexOf(rank);
}

// Can `defense` legally beat `attack` given the trump suit?
//   - Same suit:    defense.rank must be strictly higher
//   - Different:    defense must be trump AND attack must NOT be trump
export function beats(attack: Card, defense: Card, trumpSuit: Suit): boolean {
  if (attack.suit === defense.suit) {
    return rankValue(defense.rank) > rankValue(attack.rank);
  }
  return defense.suit === trumpSuit && attack.suit !== trumpSuit;
}

// Does the defender's hand contain at least one card that beats this attack?
export function canDefend(
  defenderHand: readonly Card[],
  attack: Card,
  trumpSuit: Suit,
): boolean {
  return defenderHand.some((c) => beats(attack, c, trumpSuit));
}

// Maximum attacks allowed in the round (user-confirmed rule):
//   Round 1: cap at 5 (gives defender a chance early in the game).
//   Round 2+: cap at 6.
// Defender hand size is intentionally NOT a factor — the only ceiling is
// the per-round cap. If the defender runs out of cards mid-round, they
// have to take whatever is on the table.
export function computeRoundAttackLimit(roundNumber: number): number {
  return roundNumber === 1 ? 5 : 6;
}

// Is `card`'s rank already represented somewhere on the table (attack or defense)?
// Used to validate throw-ins.
export function rankIsOnTable(card: Card, table: readonly TablePair[]): boolean {
  for (const p of table) {
    if (p.attack.rank === card.rank) return true;
    if (p.defense && p.defense.rank === card.rank) return true;
  }
  return false;
}

// Is `card` a legal attack/throw-in right now?
//   - Table empty: any card is a legal opening attack.
//   - Otherwise:   card's rank must match some rank already on the table.
//   - Total attacks must stay under `roundAttackLimit` (5 in round 1,
//     6 in round 2+).
//   - **No attacks may be added to a defender with zero cards** —
//     pass `Number.POSITIVE_INFINITY` for `defenderHandSize` when the
//     defender has already declared 'take' (in that case they're
//     collecting everything, so hand size doesn't matter).
//
// Note: this does not check WHO is playing the card. The caller (engine)
// enforces that the opening attack comes from `attackerIndex` and that
// throw-ins come from any non-defender.
export function canAttackCard(
  card: Card,
  table: readonly TablePair[],
  defenderHandSize: number,
  roundAttackLimit: number,
): boolean {
  if (table.length >= roundAttackLimit) return false;
  if (defenderHandSize <= 0) return false;
  if (table.length === 0) return true;
  return rankIsOnTable(card, table);
}

// Can the current defender pass the attack on to the next player (Перевод)?
// Conditions (standard variant — user-confirmed):
//   - There is at least one attack on the table
//   - No defense has been played yet for any pair
//   - All attacks on the table share the same rank
//   - `card` is the same rank as the existing attacks
//   - The NEW defender has enough cards to face the resulting table size
//     (table.length + 1, since the transfer card is added as a new attack)
export function canTransfer(
  card: Card,
  table: readonly TablePair[],
  newDefenderHandSize: number,
): boolean {
  if (table.length === 0) return false;
  if (table.some((p) => p.defense !== undefined)) return false;
  const sharedRank = table[0]!.attack.rank;
  if (!table.every((p) => p.attack.rank === sharedRank)) return false;
  if (card.rank !== sharedRank) return false;
  return newDefenderHandSize >= table.length + 1;
}

// Next clockwise index, skipping any player marked `isOut`.
// Returns -1 if no active player exists (game is effectively over).
export function nextActivePlayerIndex(
  players: readonly Player[],
  fromIndex: number,
): number {
  const n = players.length;
  for (let step = 1; step <= n; step++) {
    const i = (fromIndex + step) % n;
    if (!players[i]!.isOut) return i;
  }
  return -1;
}

// Returns the durak (loser) player id if the game has ended, otherwise null.
// Game ends when the deck is empty AND exactly one player still holds cards.
// If the last play empties everyone simultaneously, it's a draw (returns null).
export function findDurak(players: readonly Player[], deckSize: number): string | null {
  if (deckSize > 0) return null;
  const stillHolding = players.filter((p) => p.hand.length > 0);
  if (stillHolding.length === 1) return stillHolding[0]!.id;
  return null;
}

// Every attack on the table has been defended. (False on an empty table —
// "fully defended" implies there was something to defend.)
export function tableIsFullyDefended(table: readonly TablePair[]): boolean {
  if (table.length === 0) return false;
  return table.every((p) => p.defense !== undefined);
}
