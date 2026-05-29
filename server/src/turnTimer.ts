// Per-room turn timer: 20 seconds from the last action. On expiry,
// applies the appropriate default action (defender takes; otherwise
// all non-defenders pass) and triggers a re-broadcast through the
// supplied callback.
//
// Kept out of index.ts so the timing logic can be unit-tested in isolation
// later if we want.

import type { Action, GameState } from '../../shared/src/types';
import { applyAction, type EngineResult } from '../../shared/src/engine';
import { tableIsFullyDefended } from '../../shared/src/rules';

// Set to 0 to disable the turn timer entirely (useful during development
// when you want unlimited time to explore the game state). Default for
// production / normal play: 20_000 ms.
export const TURN_DURATION_MS = 0;

interface ActiveTimer {
  timeout: NodeJS.Timeout;
  deadline: number; // epoch ms
}

const timers = new Map<string, ActiveTimer>(); // roomId → timer

// Clears any pending timer for the room. Safe to call multiple times.
export function clearTurnTimer(roomId: string): void {
  const t = timers.get(roomId);
  if (t) {
    clearTimeout(t.timeout);
    timers.delete(roomId);
  }
}

// Returns the deadline (epoch ms) of the active timer for this room, or null.
export function getTurnDeadline(roomId: string): number | null {
  return timers.get(roomId)?.deadline ?? null;
}

// Decides which default action to apply on expiry and runs it through the
// engine. Returns the new state and the action taken (for logging).
export function applyExpiryAction(state: GameState): {
  result: EngineResult;
  action: Action | null;
} {
  if (state.phase !== 'playing') {
    return { result: { ok: true, state }, action: null };
  }
  const defender = state.players[state.defenderIndex];
  if (!defender) return { result: { ok: true, state }, action: null };

  // If table is empty, the attacker is overdue. There's no useful "auto-
  // attack" — just skip by handing the round to the next player (we model
  // this as the defender taking nothing; simpler: no-op for now, the
  // attacker will get prompted again). In practice this state is rare.
  if (state.table.length === 0) {
    return { result: { ok: true, state }, action: null };
  }

  // If defender owes a defense (undefended attacks AND not already taking),
  // auto-take.
  if (!state.defenderTaking && !tableIsFullyDefended(state.table)) {
    const action: Action = { type: 'take', playerId: defender.id };
    return { result: applyAction(state, action), action };
  }

  // Otherwise (table fully defended, or defender is taking) all non-
  // defenders need to pass to end the round. Apply a pass for the first
  // non-defender who hasn't passed yet — this will progressively close
  // the round if the timer keeps firing.
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

// Starts (or restarts) the timer for a room. The onExpiry callback fires
// after TURN_DURATION_MS and is responsible for applying the default
// action and broadcasting the new state.
// If TURN_DURATION_MS is 0, this is a no-op — clients will see
// turnDeadline: null and the UI will hide the timer.
export function startTurnTimer(roomId: string, onExpiry: () => void): number | null {
  clearTurnTimer(roomId);
  if (TURN_DURATION_MS <= 0) return null;
  const deadline = Date.now() + TURN_DURATION_MS;
  const timeout = setTimeout(() => {
    timers.delete(roomId);
    onExpiry();
  }, TURN_DURATION_MS);
  timers.set(roomId, { timeout, deadline });
  return deadline;
}
