// Single shared Socket.IO instance for the whole app.
// Imported by HomePage and RoomPage; auto-connects on first import.

import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  RoomClosedPayload,
  RoomStatePayload,
  ServerToClientEvents,
} from '@shared/wire';
import type { ClientGameState } from '@shared/games/durak';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL, {
  autoConnect: true,
});

// Module-level cache for room:state events. Without this, there's a race:
// the server emits room:state right after the room:create ack, but by the
// time React unmounts HomePage and mounts RoomPage, the event may have
// already arrived and been dropped. Components read the cache as their
// initial state to bridge that gap.

let latestRoomState: RoomStatePayload | null = null;
let latestRoomClosed: RoomClosedPayload | null = null;
let latestGameState: ClientGameState | null = null;

socket.on('room:state', (s) => {
  latestRoomState = s;
  latestRoomClosed = null;
});

socket.on('room:closed', (p) => {
  latestRoomState = null;
  latestRoomClosed = p;
  latestGameState = null;
});

socket.on('game:state', (s) => {
  latestGameState = s;
});

socket.on('disconnect', () => {
  // Don't clear the cache here — the auto-reconnect will refresh it via a
  // fresh room:state if we're still in a room. Clearing now would briefly
  // flash "Connecting..." in the UI for a transient blip.
});

export function getLatestRoomState(): RoomStatePayload | null {
  return latestRoomState;
}

export function getLatestRoomClosed(): RoomClosedPayload | null {
  return latestRoomClosed;
}

export function getLatestGameState(): ClientGameState | null {
  return latestGameState;
}

export function clearRoomCache(): void {
  latestRoomState = null;
  latestRoomClosed = null;
  latestGameState = null;
}
