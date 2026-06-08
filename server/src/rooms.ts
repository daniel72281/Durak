// In-memory room management. No persistence — if the server restarts, all
// rooms are gone. Adequate for the MVP learning-project scope.
//
// Each room tracks its owner, max player count, list of joined players, and
// (later, in stage 2) the running GameState.

import type { GameState, PlayerScore } from '../../shared/src/types';

interface RoomPlayer {
  id: string;
  nickname: string;
  socketId: string;
  // Transient drop — the socket is gone but the player may still rejoin
  // within the grace period. While true, other players see the name dimmed
  // and the turn doesn't advance past actions that need this player.
  disconnected: boolean;
  disconnectedAt: number | null; // epoch ms
}

export interface Room {
  id: string;
  ownerId: string;
  maxPlayers: number;
  players: RoomPlayer[];
  game: GameState | null;
  // Cumulative points per playerId across all games played in the room.
  scoreboard: Map<string, PlayerScore>;
  // Tracks whether the most recently finished game has already been scored
  // (to avoid double-counting if multiple events touch the same final state).
  scoredCurrentGame: boolean;
  // Per-player timers that fire when a disconnect grace period expires.
  // Cleared if the player rejoins, or when the room itself closes.
  disconnectTimers: Map<string, NodeJS.Timeout>;
}

const rooms = new Map<string, Room>();
const playerToRoom = new Map<string, string>(); // playerId → roomId

// 4 uppercase letters, no I or O (to avoid 1/0 confusion).
const ROOM_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function generateRoomId(): string {
  // Loop until we find an unused id — collisions virtually impossible at our
  // scale (24^4 = 331,776 combinations) but be safe.
  while (true) {
    let id = '';
    for (let i = 0; i < 4; i++) {
      id += ROOM_ID_ALPHABET[Math.floor(Math.random() * ROOM_ID_ALPHABET.length)];
    }
    if (!rooms.has(id)) return id;
  }
}

function generatePlayerId(): string {
  return 'p_' + Math.random().toString(36).slice(2, 10);
}

function sanitizeNickname(raw: string): string {
  return raw.trim().slice(0, 24);
}

export type CreateResult =
  | { ok: true; roomId: string; playerId: string }
  | { ok: false; error: string };

export function createRoom(
  nickname: string,
  maxPlayers: number,
  socketId: string,
): CreateResult {
  const clean = sanitizeNickname(nickname);
  if (clean.length === 0) return { ok: false, error: 'nickname required' };
  if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 5) {
    return { ok: false, error: 'maxPlayers must be an integer between 2 and 5' };
  }
  const roomId = generateRoomId();
  const playerId = generatePlayerId();
  rooms.set(roomId, {
    id: roomId,
    ownerId: playerId,
    maxPlayers,
    players: [{
      id: playerId,
      nickname: clean,
      socketId,
      disconnected: false,
      disconnectedAt: null,
    }],
    game: null,
    scoreboard: new Map([[playerId, { points: 0 }]]),
    scoredCurrentGame: false,
    disconnectTimers: new Map(),
  });
  playerToRoom.set(playerId, roomId);
  return { ok: true, roomId, playerId };
}

export type JoinResult =
  | { ok: true; playerId: string; roomId: string }
  | { ok: false; error: string };

export function joinRoom(
  rawRoomId: string,
  nickname: string,
  socketId: string,
): JoinResult {
  const roomId = rawRoomId.trim().toUpperCase();
  const room = rooms.get(roomId);
  if (!room) return { ok: false, error: 'room not found' };
  if (room.game !== null) return { ok: false, error: 'game already in progress' };
  if (room.players.length >= room.maxPlayers) {
    return { ok: false, error: 'room is full' };
  }
  const clean = sanitizeNickname(nickname);
  if (clean.length === 0) return { ok: false, error: 'nickname required' };
  // Prevent duplicate nicknames within the same room.
  if (room.players.some((p) => p.nickname.toLowerCase() === clean.toLowerCase())) {
    return { ok: false, error: 'nickname already taken in this room' };
  }
  const playerId = generatePlayerId();
  room.players.push({
    id: playerId,
    nickname: clean,
    socketId,
    disconnected: false,
    disconnectedAt: null,
  });
  room.scoreboard.set(playerId, { points: 0 });
  playerToRoom.set(playerId, roomId);
  return { ok: true, playerId, roomId };
}

export interface LeaveResult {
  roomId: string;
  wasOwner: boolean;
  gameWasOn: boolean;
  remainingPlayers: number;
}

export function leaveRoom(playerId: string): LeaveResult | null {
  const roomId = playerToRoom.get(playerId);
  if (!roomId) return null;
  const room = rooms.get(roomId);
  if (!room) {
    playerToRoom.delete(playerId);
    return null;
  }
  const wasOwner = room.ownerId === playerId;
  const gameWasOn = room.game !== null;
  room.players = room.players.filter((p) => p.id !== playerId);
  playerToRoom.delete(playerId);
  return { roomId, wasOwner, gameWasOn, remainingPlayers: room.players.length };
}

export function closeRoom(roomId: string): void {
  const room = rooms.get(roomId);
  if (!room) return;
  // Cancel any pending disconnect grace timers so they don't fire after teardown.
  for (const t of room.disconnectTimers.values()) clearTimeout(t);
  room.disconnectTimers.clear();
  for (const player of room.players) {
    playerToRoom.delete(player.id);
  }
  rooms.delete(roomId);
}

export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId);
}

export function getRoomByPlayer(playerId: string): Room | undefined {
  const roomId = playerToRoom.get(playerId);
  return roomId ? rooms.get(roomId) : undefined;
}

// Mark a player as disconnected without removing them from the room — they
// still occupy their seat and may rejoin within the grace period. Returns the
// room so the caller can broadcast updated state, or null if no such room.
export function markDisconnected(playerId: string): Room | null {
  const room = getRoomByPlayer(playerId);
  if (!room) return null;
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return null;
  player.disconnected = true;
  player.disconnectedAt = Date.now();
  return room;
}

// Reverse of markDisconnected. Updates the socketId so future broadcasts
// reach the new connection, and clears any pending grace timer.
export function markReconnected(
  playerId: string,
  newSocketId: string,
): Room | null {
  const room = getRoomByPlayer(playerId);
  if (!room) return null;
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return null;
  player.disconnected = false;
  player.disconnectedAt = null;
  player.socketId = newSocketId;
  const timer = room.disconnectTimers.get(playerId);
  if (timer) {
    clearTimeout(timer);
    room.disconnectTimers.delete(playerId);
  }
  return room;
}

// Permanently remove a player from a room (called when grace expires).
// Also clears their entry from the scoreboard so they no longer appear in
// the cumulative rankings shown to the remaining players.
export function evictPlayer(playerId: string): { room: Room; remainingPlayers: number } | null {
  const room = getRoomByPlayer(playerId);
  if (!room) return null;
  room.players = room.players.filter((p) => p.id !== playerId);
  room.scoreboard.delete(playerId);
  const timer = room.disconnectTimers.get(playerId);
  if (timer) {
    clearTimeout(timer);
    room.disconnectTimers.delete(playerId);
  }
  playerToRoom.delete(playerId);
  return { room, remainingPlayers: room.players.length };
}
