// Default action applied when a Durak turn timer expires. Pure, no I/O —
// the server's turnTimer just calls this and re-broadcasts the result.
//
// Rules (user-confirmed):
//   - If the defender owes a defense (undefended attacks and not yet taking),
//     auto-take.
//   - Otherwise (table fully defended or defender is taking), apply a pass
//     for the first non-defender who hasn't passed yet. The next expiry will
//     pick the next one, progressively closing the round.

import { applyAction, type EngineResult } from './engine';
import { tableIsFullyDefended } from './rules';
import type { Action, GameState } from './types';

export function applyExpiryAction(state: GameState): {
  result: EngineResult;
  action: Action | null;
} {
  if (state.phase !== 'playing') {
    return { result: { ok: true, state }, action: null };
  }
  const defender = state.players[state.defenderIndex];
  if (!defender) return { result: { ok: true, state }, action: null };

  // Empty table = attacker is overdue. No useful auto-attack; just skip.
  if (state.table.length === 0) {
    return { result: { ok: true, state }, action: null };
  }

  if (!state.defenderTaking && !tableIsFullyDefended(state.table)) {
    const action: Action = { type: 'take', playerId: defender.id };
    return { result: applyAction(state, action), action };
  }

  for (let i = 0; i < state.players.length; i++) {
    if (i === state.defenderIndex) continue;
    const p = state.players[i]!;
    if (p.isOut) continue;
    if (state.passedPlayerIds.includes(p.id)) continue;
    const action: Action = { type: 'pass', playerId: p.id };
    return { result: applyAction(state, action), action };
  }
  return { result: { ok: true, state }, action: null };
}
