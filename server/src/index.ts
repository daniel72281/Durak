import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import type {
  ClientToServerEvents,
  RoomClosedReason,
  RoomStatePayload,
  ServerToClientEvents,
} from '../../shared/src/wire';
import { applyAction, createGame, startGame } from '../../shared/src/engine';
import { createDeck, shuffle } from '../../shared/src/deck';
import * as rooms from './rooms';
import { filterGameState } from './state-filter';
import {
  applyExpiryAction,
  clearTurnTimer,
  getTurnDeadline,
  startTurnTimer,
} from './turnTimer';

const PORT = Number(process.env.PORT) || 3002;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

// How long a player has to come back after a socket drop before we end the
// game and remove them from the room. Confirmed by user as 60s on 2026-05-30.
const RECONNECT_GRACE_MS = 60_000;

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'durak-server' });
});

const httpServer = http.createServer(app);
const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: CLIENT_ORIGIN },
});

// Map socket connections to player ids so we can clean up on disconnect.
const socketToPlayer = new Map<string, string>(); // socketId → playerId

// Sends a filtered room:state to every socket currently in the room.
// Owners see the full player list (with names); non-owners see only the count.
function broadcastRoomState(roomId: string): void {
  const room = rooms.getRoom(roomId);
  if (!room) return;
  for (const player of room.players) {
    if (player.disconnected) continue; // their socket is gone; nothing to send
    const isOwner = player.id === room.ownerId;
    const payload: RoomStatePayload = {
      roomId: room.id,
      maxPlayers: room.maxPlayers,
      ownerId: room.ownerId,
      playerCount: room.players.length,
      isPlaying: room.game !== null,
      selfPlayerId: player.id,
    };
    if (isOwner) {
      payload.players = room.players.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        handCount: 0,
        isOut: false,
        disconnected: p.disconnected,
      }));
    }
    io.to(player.socketId).emit('room:state', payload);
  }
}

// Centralised teardown: closes the room with the given reason and clears
// per-player bookkeeping for everyone in it.
function closeRoomWithReason(roomId: string, reason: RoomClosedReason): void {
  const room = rooms.getRoom(roomId);
  if (!room) return;
  clearTurnTimer(roomId);
  for (const p of room.players) {
    // Remove the socket→player mapping so the disconnect handler doesn't
    // try to leave the room again.
    for (const [sid, pid] of socketToPlayer.entries()) {
      if (pid === p.id) socketToPlayer.delete(sid);
    }
  }
  io.to(roomId).emit('room:closed', { reason });
  rooms.closeRoom(roomId); // also clears disconnect timers
}

// Updates the per-room scoreboard with the just-finished game's result.
// Idempotent via room.scoredCurrentGame so we don't double-count if
// multiple events touch the same final state.
function commitScoreIfFinished(room: rooms.Room): void {
  if (!room.game || room.game.phase !== 'finished') return;
  if (room.scoredCurrentGame) return;
  // Games that ended because a player disconnected don't count — the user
  // asked that the scoreboard stay unchanged in that case.
  if (room.game.endReason === 'player_disconnected') {
    room.scoredCurrentGame = true;
    return;
  }
  // Points: winner (first to empty their hand) +2, durak 0, everyone
  // else +1. On a draw (loser === null) the first to finish still gets
  // the +2 since they "won" the race; the rest get +1.
  const loserId = room.game.loser;
  const winnerId = room.game.outOrder[0] ?? null;
  for (const p of room.players) {
    const score = room.scoreboard.get(p.id) ?? { points: 0 };
    let delta = 1;
    if (p.id === winnerId) delta = 2;
    else if (p.id === loserId) delta = 0;
    room.scoreboard.set(p.id, { points: score.points + delta });
  }
  room.scoredCurrentGame = true;
}

// Sends each player in the room their personalised ClientGameState.
// Skips players whose sockets are currently down — they'll get state on rejoin.
function broadcastGameState(roomId: string): void {
  const room = rooms.getRoom(roomId);
  if (!room || !room.game) return;
  commitScoreIfFinished(room);
  const deadline = getTurnDeadline(roomId);
  const disconnectedIds = new Set(
    room.players.filter((p) => p.disconnected).map((p) => p.id),
  );
  for (const player of room.players) {
    if (player.disconnected) continue;
    const view = filterGameState(
      room.game,
      player.id,
      room.id,
      deadline,
      room.scoreboard,
      disconnectedIds,
    );
    io.to(player.socketId).emit('game:state', view);
  }
}

// Called when the 20s turn timer fires for a room: apply the engine's
// default expiry action and re-broadcast.
function handleTimerExpiry(roomId: string): void {
  const room = rooms.getRoom(roomId);
  if (!room || !room.game) return;
  const { result, action } = applyExpiryAction(room.game);
  if (!result.ok) {
    console.log(`[timer] room=${roomId} expiry action failed: ${result.error}`);
    return;
  }
  if (action) {
    console.log(`[timer] room=${roomId} auto-applied ${action.type}`);
  }
  room.game = result.state;
  if (result.state.phase === 'playing') {
    startTurnTimer(roomId, () => handleTimerExpiry(roomId));
  } else {
    clearTurnTimer(roomId);
  }
  broadcastGameState(roomId);
}

io.on('connection', (socket) => {
  console.log(`[socket] connected: ${socket.id}`);

  socket.on('room:create', ({ nickname, maxPlayers }, ack) => {
    console.log(`[room:create] from ${socket.id}: nickname='${nickname}' max=${maxPlayers}`);
    const result = rooms.createRoom(nickname, maxPlayers, socket.id);
    if (!result.ok) {
      console.log(`[room:create] failed: ${result.error}`);
      return ack({ ok: false, error: result.error });
    }
    socketToPlayer.set(socket.id, result.playerId);
    void socket.join(result.roomId);
    console.log(`[room:create] OK: room=${result.roomId} player=${result.playerId}`);
    ack({ ok: true, roomId: result.roomId, playerId: result.playerId });
    broadcastRoomState(result.roomId);
  });

  socket.on('room:join', ({ roomId, nickname }, ack) => {
    const result = rooms.joinRoom(roomId, nickname, socket.id);
    if (!result.ok) return ack({ ok: false, error: result.error });
    socketToPlayer.set(socket.id, result.playerId);
    void socket.join(result.roomId);
    ack({ ok: true, playerId: result.playerId });
    broadcastRoomState(result.roomId);
  });

  socket.on('room:leave', (_payload, ack) => {
    const playerId = socketToPlayer.get(socket.id);
    if (!playerId) return ack({ ok: false, error: 'not in a room' });
    const room = rooms.getRoomByPlayer(playerId);
    if (!room) {
      socketToPlayer.delete(socket.id);
      return ack({ ok: false, error: 'not in a room' });
    }
    socketToPlayer.delete(socket.id);
    void socket.leave(room.id);
    // Cancel any pending grace timer (intentional leave skips the wait).
    const timer = room.disconnectTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      room.disconnectTimers.delete(playerId);
    }
    // Mark first so handleDisconnectExpiry treats this as a real departure.
    rooms.markDisconnected(playerId);
    handleDisconnectExpiry(room.id, playerId);
    ack({ ok: true });
  });

  socket.on('room:close', (_payload, ack) => {
    const playerId = socketToPlayer.get(socket.id);
    if (!playerId) return ack({ ok: false, error: 'not in a room' });
    const room = rooms.getRoomByPlayer(playerId);
    if (!room) return ack({ ok: false, error: 'not in a room' });
    if (room.ownerId !== playerId) {
      return ack({ ok: false, error: 'only the owner can close the room' });
    }
    closeRoomWithReason(room.id, 'owner_closed');
    ack({ ok: true });
  });

  socket.on('game:restart', (_payload, ack) => {
    const playerId = socketToPlayer.get(socket.id);
    if (!playerId) return ack({ ok: false, error: 'not in a room' });
    const room = rooms.getRoomByPlayer(playerId);
    if (!room) return ack({ ok: false, error: 'not in a room' });
    if (room.ownerId !== playerId) {
      return ack({ ok: false, error: 'only the owner can restart' });
    }
    if (!room.game || room.game.phase !== 'finished') {
      return ack({ ok: false, error: 'no finished game to restart' });
    }
    // Ensure final score from the just-finished game is committed before reset.
    commitScoreIfFinished(room);
    // Pick the previous game's winner (first to empty their hand) as the
    // starter — walk outOrder from front to back, picking the first one
    // who's still in the room.
    let startPlayerId: string | null = null;
    for (const pid of room.game.outOrder) {
      if (room.players.some((p) => p.id === pid)) { startPlayerId = pid; break; }
    }
    try {
      const initial = createGame(
        room.players.map((p) => ({ id: p.id, nickname: p.nickname })),
      );
      const shuffled = shuffle(createDeck());
      const result = startGame(initial, shuffled, { startPlayerId });
      if (!result.ok) return ack({ ok: false, error: result.error });
      room.game = result.state;
      room.scoredCurrentGame = false;
    } catch (e) {
      return ack({ ok: false, error: (e as Error).message });
    }
    console.log(`[game:restart] room=${room.id} by ${playerId} startPlayerId=${startPlayerId ?? 'none'}`);
    startTurnTimer(room.id, () => handleTimerExpiry(room.id));
    ack({ ok: true });
    broadcastGameState(room.id);
  });

  socket.on('game:start', (_payload, ack) => {
    const playerId = socketToPlayer.get(socket.id);
    if (!playerId) return ack({ ok: false, error: 'not in a room' });
    const room = rooms.getRoomByPlayer(playerId);
    if (!room) return ack({ ok: false, error: 'not in a room' });
    if (room.ownerId !== playerId) {
      return ack({ ok: false, error: 'only the owner can start the game' });
    }
    if (room.game !== null) {
      return ack({ ok: false, error: 'game already started' });
    }
    if (room.players.length < 2) {
      return ack({ ok: false, error: 'need at least 2 players' });
    }
    try {
      const initial = createGame(
        room.players.map((p) => ({ id: p.id, nickname: p.nickname })),
      );
      const shuffled = shuffle(createDeck());
      const result = startGame(initial, shuffled);
      if (!result.ok) return ack({ ok: false, error: result.error });
      room.game = result.state;
      room.scoredCurrentGame = false;
    } catch (e) {
      return ack({ ok: false, error: (e as Error).message });
    }
    console.log(`[game:start] room=${room.id} by ${playerId}`);
    startTurnTimer(room.id, () => handleTimerExpiry(room.id));
    ack({ ok: true });
    broadcastRoomState(room.id);
    broadcastGameState(room.id);
  });

  socket.on('game:action', (action, ack) => {
    const playerId = socketToPlayer.get(socket.id);
    if (!playerId) return ack({ ok: false, error: 'not in a room' });
    const room = rooms.getRoomByPlayer(playerId);
    if (!room || !room.game) {
      return ack({ ok: false, error: 'no active game' });
    }
    // Ensure the action's playerId matches the sender (no impersonation).
    if (action.playerId !== playerId) {
      return ack({ ok: false, error: 'cannot act on behalf of another player' });
    }
    const result = applyAction(room.game, action);
    if (!result.ok) return ack({ ok: false, error: result.error });
    room.game = result.state;
    if (result.state.phase === 'playing') {
      startTurnTimer(room.id, () => handleTimerExpiry(room.id));
    } else {
      clearTurnTimer(room.id);
    }
    ack({ ok: true });
    broadcastGameState(room.id);
  });

  socket.on('disconnect', (reason) => {
    console.log(`[socket] disconnected: ${socket.id} (${reason})`);
    const playerId = socketToPlayer.get(socket.id);
    if (!playerId) return;
    socketToPlayer.delete(socket.id);
    const room = rooms.markDisconnected(playerId);
    if (!room) return;
    // Schedule eviction after the grace period. The handler is a no-op if
    // the player rejoined in the meantime (markReconnected clears the timer).
    const timer = setTimeout(() => {
      handleDisconnectExpiry(room.id, playerId);
    }, RECONNECT_GRACE_MS);
    room.disconnectTimers.set(playerId, timer);
    // Let the rest of the room know the seat is dimmed (room state for the
    // waiting-room case; game state during a live game).
    if (room.game) broadcastGameState(room.id);
    else broadcastRoomState(room.id);
  });

  socket.on('room:rejoin', ({ roomId, playerId }, ack) => {
    const room = rooms.getRoom(roomId);
    if (!room) return ack({ ok: false, error: 'room not found' });
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return ack({ ok: false, error: 'no such session in room' });
    // Drop any prior socket→player mapping for this player (their old socket
    // is gone anyway; the new one is `socket.id`).
    for (const [sid, pid] of socketToPlayer.entries()) {
      if (pid === playerId) socketToPlayer.delete(sid);
    }
    rooms.markReconnected(playerId, socket.id);
    socketToPlayer.set(socket.id, playerId);
    void socket.join(roomId);
    console.log(`[room:rejoin] room=${roomId} player=${playerId} socket=${socket.id}`);
    ack({ ok: true });
    broadcastRoomState(roomId);
    if (room.game) broadcastGameState(roomId);
  });
});

// Called when a disconnect grace timer fires. Either evicts the player and
// continues (if the room can survive without them) or closes the room.
function handleDisconnectExpiry(roomId: string, playerId: string): void {
  const room = rooms.getRoom(roomId);
  if (!room) return;
  const player = room.players.find((p) => p.id === playerId);
  if (!player || !player.disconnected) return; // they came back, nothing to do
  console.log(`[disconnect-expiry] room=${roomId} player=${playerId}`);

  if (player.id === room.ownerId) {
    closeRoomWithReason(roomId, 'owner_left');
    return;
  }

  // Non-owner left during a live game → end this game without a winner,
  // remove the player + their scoreboard entry, broadcast the final state.
  if (room.game && room.game.phase === 'playing') {
    room.game = {
      ...room.game,
      phase: 'finished',
      loser: null,
      endReason: 'player_disconnected',
    };
    clearTurnTimer(roomId);
    room.scoredCurrentGame = true; // explicit: don't update wins/duraks
  }

  const result = rooms.evictPlayer(playerId);
  if (!result) return;

  // If we have at least 2 players still here, keep the room open so the
  // owner can start a new round. Otherwise tear it down.
  if (result.remainingPlayers >= 2) {
    broadcastRoomState(roomId);
    if (room.game) broadcastGameState(roomId);
  } else {
    closeRoomWithReason(roomId, 'player_left_mid_game');
  }
}

httpServer.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[server] CORS origin: ${CLIENT_ORIGIN}`);
});

// Graceful shutdown so tsx --watch restarts release the port cleanly
// (avoids EADDRINUSE on subsequent file edits).
const shutdown = (signal: string) => {
  console.log(`[server] ${signal} received — shutting down`);
  io.close(() => console.log('[server] socket.io closed'));
  httpServer.close(() => {
    console.log('[server] http closed');
    process.exit(0);
  });
  // Hard exit if cleanup hangs
  setTimeout(() => process.exit(1), 3000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
