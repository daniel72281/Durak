// Per-game score deltas for Durak. Caller (the server) accumulates these
// into the room's cumulative scoreboard. Pure — no I/O, no Room awareness.
//
// Scoring (user-confirmed):
//   - Winner (outOrder[0], first to empty their hand): +2
//   - Durak (loser): +0
//   - Everyone else: +1
//   - Heads-up (2 players): winner +1 instead of +2 — there's no
//     middle place between winner and loser, so a smaller spread fits.
//   - A draw (loser === null) still credits outOrder[0] with the winner's
//     amount; the rest get +1 since no one is the durak.
//   - Games that ended via 'player_disconnected' return an EMPTY map — the
//     caller should leave the scoreboard untouched in that case.

import type { GameState } from './types';

export function computeScoreDeltas(state: GameState): Map<string, number> {
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
