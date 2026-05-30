// Persists the current room session (roomId + playerId + nickname) in
// localStorage so the client can rejoin after a transient socket drop or
// a page refresh. Cleared on intentional leave / room close.

export interface RoomSession {
  roomId: string;
  playerId: string;
  nickname: string;
  isOwner: boolean;
}

const KEY = 'durak:room-session';

export function saveSession(s: RoomSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Quota / private mode — best effort; we still work without persistence.
  }
}

export function loadSession(): RoomSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RoomSession>;
    if (
      typeof parsed.roomId === 'string' &&
      typeof parsed.playerId === 'string' &&
      typeof parsed.nickname === 'string' &&
      typeof parsed.isOwner === 'boolean'
    ) {
      return parsed as RoomSession;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
