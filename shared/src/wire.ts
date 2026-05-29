// Wire protocol — typed Socket.IO event maps shared between client and server.
// Both sides import these types to keep payloads in sync.

import type { Action, ClientGameState, PublicPlayer } from './types';

// Marker type for events that carry no extra payload (other than ok flag).
export type EmptyPayload = Record<string, never>;

// Discriminated union for acknowledgement callbacks. When T is empty, the
// success branch is just `{ ok: true }` (intersecting with `Record<string,
// never>` would produce an impossible type since `ok: true` collides with
// the all-`never`-values constraint).
export type AckResult<T extends object = EmptyPayload> = (
  T extends EmptyPayload ? { ok: true } : { ok: true } & T
) | { ok: false; error: string };

// --- Client → Server payloads
export interface RoomCreatePayload {
  nickname: string;
  maxPlayers: number; // 2-5
}
export interface RoomCreateAck {
  roomId: string;
  playerId: string;
}

export interface RoomJoinPayload {
  roomId: string;
  nickname: string;
}
export interface RoomJoinAck {
  playerId: string;
}

// --- Server → Client payloads
export interface RoomStatePayload {
  roomId: string;
  maxPlayers: number;
  ownerId: string;
  playerCount: number;
  // Only sent to the room owner — non-owners see just the count.
  players?: PublicPlayer[];
  isPlaying: boolean;
  // The receiving socket's own playerId, so the client can identify itself.
  selfPlayerId: string;
}

export type RoomClosedReason =
  | 'owner_closed'
  | 'owner_left'
  | 'player_left_mid_game';

export interface RoomClosedPayload {
  reason: RoomClosedReason;
}

export interface GameErrorPayload {
  message: string;
}

// --- Socket.IO typed event maps

export interface ClientToServerEvents {
  'room:create': (
    payload: RoomCreatePayload,
    ack: (r: AckResult<RoomCreateAck>) => void,
  ) => void;
  'room:join': (
    payload: RoomJoinPayload,
    ack: (r: AckResult<RoomJoinAck>) => void,
  ) => void;
  'room:leave': (
    payload: Record<string, never>,
    ack: (r: AckResult) => void,
  ) => void;
  'room:close': (
    payload: Record<string, never>,
    ack: (r: AckResult) => void,
  ) => void;
  'game:start': (
    payload: Record<string, never>,
    ack: (r: AckResult) => void,
  ) => void;
  'game:restart': (
    payload: Record<string, never>,
    ack: (r: AckResult) => void,
  ) => void;
  'game:action': (
    payload: Action,
    ack: (r: AckResult) => void,
  ) => void;
}

export interface ServerToClientEvents {
  'room:state': (state: RoomStatePayload) => void;
  'game:state': (state: ClientGameState) => void;
  'room:closed': (payload: RoomClosedPayload) => void;
  'game:error': (payload: GameErrorPayload) => void;
}
