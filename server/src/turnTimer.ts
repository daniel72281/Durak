// Per-room turn timer: 20 seconds from the last action. Generic across
// games — the per-game expiry rule lives in games/<game>/expiry.ts and
// is re-exported here so index.ts can keep a single import path.

export { applyExpiryAction } from '../../shared/src/games/durak/expiry';

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
