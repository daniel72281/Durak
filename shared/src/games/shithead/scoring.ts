// Per-game score deltas for Shithead. Same shape as Durak so the server
// scoreboard logic stays game-agnostic:
//   - Winner (outOrder[0], first to empty): +2
//   - Shithead (loser): +0
//   - Everyone else: +1
//   - Heads-up (2 players): winner +1 instead of +2 — there's no podium
//     of three with a "middle place" to differentiate from, so the
//     spread is just winner +1 / shithead 0.
//   - Games that ended via 'player_disconnected' return an EMPTY map — the
//     caller leaves the scoreboard untouched.

import type { ShitheadGameState } from './types';

export function computeScoreDeltas(
  state: ShitheadGameState,
): Map<string, number> {
  const deltas = new Map<string, number>();
  if (state.phase !== 'finished') return deltas;
  if (state.endReason === 'player_disconnected') return deltas;
  const loserId = state.loser;
  const winnerId = state.outOrder[0] ?? null;
  const isHeadsUp = state.players.length === 2;
  for (const p of state.players) {
    let delta = 1;
    if (p.id === winnerId) delta = isHeadsUp ? 1 : 2;
    else if (p.id === loserId) delta = 0;
    deltas.set(p.id, delta);
  }
  return deltas;
}
