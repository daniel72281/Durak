// Computes which cards in the viewer's hand are legal to play right now,
// and what drop targets each card can be dropped on. Uses the shared rules
// directly so the UI hint stays consistent with the server's validation.

import type { Card, ClientGameState } from '@shared/types';
import {
  beats,
  canAttackCard,
  canTransfer,
  tableIsFullyDefended,
} from '@shared/rules';

export type DropTargetKind =
  | { kind: 'attack' } // central attack/throw-in zone
  | { kind: 'defend'; pairIndex: number } // overlay on a specific undefended pair
  | { kind: 'transfer' }; // transfer zone

export interface LegalMovesForCard {
  // The card can be played in any of these targets. Empty array = not playable.
  targets: DropTargetKind[];
}

export interface LegalMoves {
  // Per-card key (suit-rank) → its legal targets.
  byCard: Map<string, LegalMovesForCard>;
  // Convenience: any card legal at all?
  anyLegal: boolean;
}

export function cardKey(card: Card): string {
  return `${card.suit}-${card.rank}`;
}

export function computeLegalMoves(state: ClientGameState): LegalMoves {
  const result: LegalMoves = { byCard: new Map(), anyLegal: false };

  const self = state.players[state.selfIndex];
  if (!self || self.isOut || state.phase !== 'playing') return result;

  const isDefender = state.selfIndex === state.defenderIndex;
  const isAttacker = state.selfIndex === state.attackerIndex;

  // For transfer: new defender (next active player after current defender)
  const nextDefenderIdx = nextActiveIndex(state, state.defenderIndex);
  const newDefenderHand =
    nextDefenderIdx >= 0
      ? (state.players[nextDefenderIdx]?.handCount ?? 0)
      : 0;

  const fullyDefended = tableIsFullyDefended(state.table);
  const haveIPassed = state.passedPlayerIds.includes(self.id);

  for (const card of state.selfHand) {
    const targets: DropTargetKind[] = [];

    if (isDefender) {
      if (!state.defenderTaking) {
        // Defense: which undefended pairs can this card beat?
        for (let i = 0; i < state.table.length; i++) {
          const pair = state.table[i]!;
          if (pair.defense !== undefined) continue;
          if (beats(pair.attack, card, state.trumpSuit)) {
            targets.push({ kind: 'defend', pairIndex: i });
          }
        }
        // Transfer: only legal if no defense yet and matching rank
        if (canTransfer(card, state.table, newDefenderHand)) {
          targets.push({ kind: 'transfer' });
        }
      }
    } else {
      // Attacker or throw-in. Opening attack: must be official attacker.
      // Throw-in: anyone non-defender if rank matches table.
      if (state.table.length === 0) {
        if (isAttacker) {
          targets.push({ kind: 'attack' });
        }
      } else {
        // After defender has settled (defenderTaking or fullyDefended) and
        // I already passed, no more attacking from me.
        const blockedByPass = (state.defenderTaking || fullyDefended) && haveIPassed;
        if (
          !blockedByPass &&
          canAttackCard(card, state.table, computeAttackLimit(state))
        ) {
          targets.push({ kind: 'attack' });
        }
      }
    }

    if (targets.length > 0) {
      result.byCard.set(cardKey(card), { targets });
      result.anyLegal = true;
    }
  }
  return result;
}

// Approximate the round attack limit on the client. The server is the
// source of truth — we use 6 as the safe upper bound (round 2+). Round 1
// is actually 5; if a click is rejected the server's error message will
// say so.
function computeAttackLimit(_state: ClientGameState): number {
  return 6;
}

function nextActiveIndex(state: ClientGameState, from: number): number {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const i = (from + step) % n;
    if (!state.players[i]!.isOut) return i;
  }
  return -1;
}
