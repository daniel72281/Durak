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
import * as rooms from './rooms';

const PORT = Number(process.env.PORT) || 3002;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

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
  for (const p of room.players) {
    // Remove the socket→player mapping so the disconnect handler doesn't
    // try to leave the room again.
    for (const [sid, pid] of socketToPlayer.entries()) {
      if (pid === p.id) socketToPlayer.delete(sid);
    }
  }
  io.to(roomId).emit('room:closed', { reason });
  rooms.closeRoom(roomId);
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
    const result = rooms.leaveRoom(playerId);
    socketToPlayer.delete(socket.id);
    if (!result) return ack({ ok: false, error: 'not in a room' });
    void socket.leave(result.roomId);
    if (result.wasOwner) {
      closeRoomWithReason(result.roomId, 'owner_left');
    } else if (result.gameWasOn) {
      closeRoomWithReason(result.roomId, 'player_left_mid_game');
    } else if (result.remainingPlayers > 0) {
      broadcastRoomState(result.roomId);
    } else {
      rooms.closeRoom(result.roomId);
    }
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

  socket.on('game:start', (_payload, ack) => {
    ack({ ok: false, error: 'not implemented yet (stage 2)' });
  });

  socket.on('game:action', (_action, ack) => {
    ack({ ok: false, error: 'not implemented yet (stage 2)' });
  });

  socket.on('disconnect', (reason) => {
    console.log(`[socket] disconnected: ${socket.id} (${reason})`);
    const playerId = socketToPlayer.get(socket.id);
    if (!playerId) return;
    const result = rooms.leaveRoom(playerId);
    socketToPlayer.delete(socket.id);
    if (!result) return;
    if (result.wasOwner) {
      closeRoomWithReason(result.roomId, 'owner_left');
    } else if (result.gameWasOn) {
      closeRoomWithReason(result.roomId, 'player_left_mid_game');
    } else if (result.remainingPlayers > 0) {
      broadcastRoomState(result.roomId);
    } else {
      rooms.closeRoom(result.roomId);
    }
  });
});

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
