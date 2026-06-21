// Wire protocol — typed Socket.IO event maps shared between client and server.
// Both sides import these types to keep payloads in sync.

import type { PublicPlayer } from './types';
import type { GameType } from './games/common';
import type { Action as DurakAction, ClientGameState as DurakClientGameState } from './games/durak';
import type {
  ShitheadAction,
  ShitheadClientGameState,
} from './games/shithead';

// Union of all games' player actions. The server's dispatcher looks at
// the action.type prefix ('shi.*' vs Durak's bare 'attack'/'defend'/...)
// and routes to the right engine.
export type Action = DurakAction | ShitheadAction;

// Union of every game's per-player view state. Clients narrow with the
// surrounding RoomStatePayload.gameType to know which shape to render.
export type ClientGameState = DurakClientGameState | ShitheadClientGameState;

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
  // Which game this room will play. The server stores it on the room
  // and dispatches engine calls through games[gameType].
  gameType: GameType;
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
  // Tells the client which game the room is hosting so it can navigate
  // to the right /play/<gameType>/room/<id> URL even when the user
  // joined from a different game's lobby.
  gameType: GameType;
}

// Rejoin: client comes back from a transient disconnect (or page reload).
// Identifies itself with the playerId saved in localStorage from create/join.
export interface RoomRejoinPayload {
  roomId: string;
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
  // Which game the room is hosting. Lets the client pick the right
  // GamePanel without an extra round-trip.
  gameType: GameType;
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

// Lightweight informational broadcast — used by the server to announce
// in-game events whose visual effect is delayed (e.g. Shithead's
// "Player X cannot respond — taking pile in 3s"). The server sends a
// translation key + arguments so each client renders in their own
// language without the server holding i18n state.
export interface GameNoticePayload {
  i18nKey: string;
  i18nArgs?: { [name: string]: string | number };
  durationMs: number;
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
  'room:rejoin': (
    payload: RoomRejoinPayload,
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
  'game:notice': (payload: GameNoticePayload) => void;
}
