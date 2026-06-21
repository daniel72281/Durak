// Default action applied when a Shithead turn timer expires. Pure, no
// I/O — the server's turnTimer just calls this and re-broadcasts.
//
// Rules:
//   - If we're not in 'playing' phase or the current player can't be
//     resolved, do nothing.
//   - If a Joker chooser is pending, do nothing — they have a unique
//     decision the engine can't safely make for them.
//   - If the pile is non-empty, take it (shi.takePile). The engine
//     already auto-takes when there is no legal move; expiry on a turn
//     where the player DID have legal options forces them to swallow
//     the pile.
//   - Pile empty: nothing useful to time out — let the room sit idle.

import { applyAction } from './engine';
import type { EngineResult } from '../common';
import type { ShitheadAction, ShitheadGameState } from './types';

export function applyExpiryAction(state: ShitheadGameState): {
  result: EngineResult<ShitheadGameState>;
  action: ShitheadAction | null;
} {
  if (state.phase !== 'playing') {
    return { result: { ok: true, state }, action: null };
  }
  if (state.pendingJokerChooserId !== null) {
    return { result: { ok: true, state }, action: null };
  }
  const cur = state.players[state.currentPlayerIdx];
  if (!cur || cur.isOut) {
    return { result: { ok: true, state }, action: null };
  }
  if (state.pile.length === 0) {
    return { result: { ok: true, state }, action: null };
  }
  const action: ShitheadAction = { type: 'shi.takePile', playerId: cur.id };
  return { result: applyAction(state, action), action };
}
