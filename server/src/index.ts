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
import { games, type GameEngine } from '../../shared/src/games/common';
import {
  applyAutoTakeIfNeeded as shitheadApplyAutoTake,
  canPlayerPlay as shitheadCanPlay,
} from '../../shared/src/games/shithead/engine';
import type { ShitheadGameState } from '../../shared/src/games/shithead/types';
import * as rooms from './rooms';
import {
  clearTurnTimer,
  getTurnDeadline,
  startTurnTimer,
} from './turnTimer';

// Single-game type erasure for the dispatcher. Each engine is independently
// typed at its own callsite; the server holds rooms whose state shape varies
// per gameType, so we widen at the boundary and trust the engine to validate
// its own input. Cleaner than threading a union through every call.
type AnyEngine = GameEngine<unknown, unknown, unknown>;
function engineFor(room: rooms.Room): AnyEngine {
  return games[room.gameType] as AnyEngine;
}

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
      gameType: room.gameType,
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
// multiple events touch the same final state. The per-game scoring rule
// (who gets how many points) lives in games/<g>/scoring.ts so this
// function stays game-agnostic.
function commitScoreIfFinished(room: rooms.Room): void {
  if (!room.game) return;
  const engine = engineFor(room);
  if (!engine.isFinished(room.game)) return;
  if (room.scoredCurrentGame) return;
  const deltas = engine.computeScoreDeltas(room.game);
  // An empty deltas map means the game ended in a way that shouldn't
  // touch the scoreboard (e.g. 'player_disconnected' in Durak). Still
  // mark scored so subsequent events for the same final state are no-ops.
  for (const p of room.players) {
    const delta = deltas.get(p.id);
    if (delta === undefined) continue;
    const score = room.scoreboard.get(p.id) ?? { points: 0 };
    room.scoreboard.set(p.id, { points: score.points + delta });
  }
  room.scoredCurrentGame = true;
}

// Sends each player in the room their personalised ClientGameState.
// Skips players whose sockets are currently down — they'll get state on rejoin.
function broadcastGameState(roomId: string): void {
  const room = rooms.getRoom(roomId);
  if (!room || !room.game) return;
  broadcastGameStateOverride(roomId, room.game);
}

// Like broadcastGameState, but uses the provided `overrideGame` instead
// of `room.game`. Used by the Shithead burn-reveal pattern: the
// authoritative state in room.game has already cleared the pile, but
// for ~1.5s we ship clients a "pre-burn" view that still shows the
// cards on top so spectators can actually see what got burned.
function broadcastGameStateOverride(roomId: string, overrideGame: unknown): void {
  const room = rooms.getRoom(roomId);
  if (!room) return;
  commitScoreIfFinished(room);
  const engine = engineFor(room);
  const deadline = getTurnDeadline(roomId);
  const disconnectedIds = new Set(
    room.players.filter((p) => p.disconnected).map((p) => p.id),
  );
  for (const player of room.players) {
    if (player.disconnected) continue;
    const view = engine.filterForPlayer(
      overrideGame,
      player.id,
      room.id,
      deadline,
      room.scoreboard,
      disconnectedIds,
    );
    io.to(player.socketId).emit('game:state', view as never);
  }
}

// Shithead burn announcer: detects "the pile just burned" by comparing
// pre/post burnedPile size, and emits a transient toast so spectators
// can read what happened — the engine clears the pile inline so there's
// no other visible cue beyond the burned counter incrementing.
//
// Two distinct burn causes both ship the same notice key (cause spelt
// out in i18n) so the client doesn't have to branch:
//   - 10 burn: actor's play contained a 10
//   - 4-in-a-row / 4-of-a-kind: the actor's play stacked four of the
//     same rank onto the pile
//
// shi.joker.choose also lands the Joker(s) into burnedPile but that's
// part of the Joker mechanic, not a "pile burn" the user has been
// asking about, so we skip it here.
function maybeAnnounceShitheadBurn(
  room: rooms.Room,
  before: ShitheadGameState,
  after: ShitheadGameState,
  action: { type?: string; playerId?: string },
): void {
  if (action.type === 'shi.joker.choose') return;
  const burnedGrew = after.burnedPile.length > before.burnedPile.length;
  const pileEmptied = before.pile.length >= 0 && after.pile.length === 0;
  if (!burnedGrew || !pileEmptied) return;

  const actor = after.players.find((p) => p.id === action.playerId);
  if (!actor) return;

  // Distinguish 10-burn from four-in-a-row by looking at what landed in
  // burnedPile this turn. Last items are the most recent additions; if
  // any are 10s, it's a ten-burn.
  const justBurned = after.burnedPile.slice(before.burnedPile.length);
  const hasTen = justBurned.some((c) => c.rank === '10');
  io.to(room.id).emit('game:notice', {
    i18nKey: hasTen
      ? 'games.shithead.notice_burn_ten'
      : 'games.shithead.notice_burn_four',
    i18nArgs: { nickname: actor.nickname },
    durationMs: 3000,
  });
}

// Shithead burn-reveal: the engine clears the pile inline as part of
// 10-burns and four-in-a-row burns, but players need to actually SEE
// what got burned (which 10, which four-of-a-kind, etc.). The server
// stages a "pre-burn" broadcast — the same authoritative state, but
// with the just-burned cards held on the pile — then schedules the
// real (post-burn) broadcast after a short pause. Cancelled if any
// follow-up action arrives in the meantime (the actor wants to keep
// playing; skip straight to the post-action state).
const BURN_REVEAL_DELAY_MS = 1500;

// Shithead's auto-take: when the current actor has no legal play and the
// pile is non-empty, the engine no longer takes the pile inline (so the
// state ships unchanged after the action). The server schedules the
// take 3 seconds later, broadcasting a notice first so all players see
// "X cannot respond — taking pile in 3s" before the pile actually moves.
// Cancelled if any other action arrives in the meantime.
const AUTO_TAKE_DELAY_MS = 3000;

// Stage a pre-burn view of the just-applied state. The cards the engine
// moved into burnedPile this action are temporarily re-placed on top of
// the pile (for display only); after BURN_REVEAL_DELAY_MS the real
// state is re-broadcast. Returns true when staging happened (so the
// caller can skip the regular broadcast), false otherwise.
function maybeStageBurnReveal(
  room: rooms.Room,
  before: ShitheadGameState,
  after: ShitheadGameState,
): boolean {
  // Both shi.play and shi.burst can trigger an inline burn — the
  // signature is "pile is empty AND burnedPile grew". Joker.choose
  // also lands the Joker into burnedPile, but the pile already empty
  // there is the chooser's normal behavior, not a burn animation.
  // We use the action context in the caller to gate this.
  if (after.burnedPile.length <= before.burnedPile.length) return false;
  if (after.pile.length !== 0) return false;

  const justBurned = after.burnedPile.slice(before.burnedPile.length);
  const preBurnGame: ShitheadGameState = {
    ...after,
    pile: justBurned,
    burnedPile: before.burnedPile,
  };

  if (room.burnRevealTimer) {
    clearTimeout(room.burnRevealTimer);
    room.burnRevealTimer = null;
  }
  broadcastGameStateOverride(room.id, preBurnGame);
  room.burnRevealTimer = setTimeout(() => {
    const r = rooms.getRoom(room.id);
    if (!r) return;
    r.burnRevealTimer = null;
    broadcastGameState(r.id);
  }, BURN_REVEAL_DELAY_MS);
  return true;
}

function maybeScheduleAutoTake(room: rooms.Room): void {
  if (room.autoTakeTimer) {
    clearTimeout(room.autoTakeTimer);
    room.autoTakeTimer = null;
  }
  if (room.gameType !== 'shithead') return;
  if (!room.game) return;
  const state = room.game as ShitheadGameState;
  if (state.phase !== 'playing') return;
  if (state.pendingJokerChooserId !== null) return;
  if (state.pile.length === 0) return;
  const cur = state.players[state.currentPlayerIdx];
  if (!cur || cur.isOut) return;
  if (shitheadCanPlay(state, state.currentPlayerIdx)) return;

  io.to(room.id).emit('game:notice', {
    i18nKey: 'games.shithead.notice_auto_take',
    i18nArgs: { nickname: cur.nickname },
    durationMs: AUTO_TAKE_DELAY_MS,
  });

  room.autoTakeTimer = setTimeout(() => {
    const r = rooms.getRoom(room.id);
    if (!r) return;
    r.autoTakeTimer = null;
    if (!r.game || r.gameType !== 'shithead') return;
    const newState = shitheadApplyAutoTake(r.game as ShitheadGameState);
    r.game = newState;
    if (newState.phase === 'playing') {
      startTurnTimer(r.id, () => handleTimerExpiry(r.id));
    } else {
      clearTurnTimer(r.id);
    }
    broadcastGameState(r.id);
    // The taker's next-active neighbour might also be stuck — check again.
    maybeScheduleAutoTake(r);
  }, AUTO_TAKE_DELAY_MS);
}

// Called when the 20s turn timer fires for a room: apply the engine's
// default expiry action and re-broadcast.
function handleTimerExpiry(roomId: string): void {
  const room = rooms.getRoom(roomId);
  if (!room || !room.game) return;
  const engine = engineFor(room);
  const { result, action } = engine.applyExpiryAction(room.game);
  if (!result.ok) {
    console.log(`[timer] room=${roomId} expiry action failed: ${result.error}`);
    return;
  }
  if (action) {
    const typed = action as { type?: string };
    console.log(`[timer] room=${roomId} auto-applied ${typed.type ?? '<unknown>'}`);
  }
  room.game = result.state;
  if (!engine.isFinished(result.state)) {
    startTurnTimer(roomId, () => handleTimerExpiry(roomId));
  } else {
    clearTurnTimer(roomId);
  }
  broadcastGameState(roomId);
}

io.on('connection', (socket) => {
  console.log(`[socket] connected: ${socket.id}`);

  socket.on('room:create', ({ nickname, maxPlayers, gameType }, ack) => {
    console.log(`[room:create] from ${socket.id}: nickname='${nickname}' max=${maxPlayers} game=${gameType}`);
    if (!(gameType in games)) {
      return ack({ ok: false, error: `unknown gameType '${gameType}'` });
    }
    const result = rooms.createRoom(nickname, maxPlayers, gameType, socket.id);
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
    const room = rooms.getRoom(result.roomId)!;
    ack({ ok: true, playerId: result.playerId, gameType: room.gameType });
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
    const engine = engineFor(room);
    if (!room.game || !engine.isFinished(room.game)) {
      return ack({ ok: false, error: 'no finished game to restart' });
    }
    // Ensure final score from the just-finished game is committed before reset.
    commitScoreIfFinished(room);
    // Pick the previous game's winner (first to empty their hand) as the
    // starter — walk outOrder from front to back, picking the first one
    // who's still in the room.
    let startPlayerId: string | null = null;
    for (const pid of engine.outOrder(room.game)) {
      if (room.players.some((p) => p.id === pid)) { startPlayerId = pid; break; }
    }
    // Previous game's loser, threaded into createGame so engines can apply
    // a restart penalty (Shithead deals the loser's face-up randomly).
    const previousLoserId =
      (room.game as { loser?: string | null } | null)?.loser ?? null;
    try {
      const initial = engine.createGame(
        room.players.map((p) => ({ id: p.id, nickname: p.nickname })),
        { previousLoserId },
      );
      const shuffled = engine.buildShuffledDeck();
      // startGame in Durak supports an options arg with startPlayerId.
      // The generic GameEngine interface doesn't surface it (other games
      // may pick a starter differently); pass it positionally via cast.
      const result = (engine.startGame as (s: unknown, d: unknown, o?: { startPlayerId?: string | null }) => ReturnType<typeof engine.startGame>)(
        initial,
        shuffled,
        { startPlayerId },
      );
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
      const engine = engineFor(room);
      const initial = engine.createGame(
        room.players.map((p) => ({ id: p.id, nickname: p.nickname })),
      );
      const shuffled = engine.buildShuffledDeck();
      const result = engine.startGame(initial, shuffled);
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
    const typedAction = action as { playerId?: string; type?: string };
    if (typedAction.playerId !== playerId) {
      return ack({ ok: false, error: 'cannot act on behalf of another player' });
    }
    const engine = engineFor(room);
    // Snapshot the pre-action state so we can detect Shithead burn-pile
    // transitions (pile -> burnedPile grew, pile is now empty) and
    // announce them. Joker.choose also moves the Joker into burnedPile
    // but that's not a "pile burn" in the user-facing sense, so it's
    // excluded below.
    const preActionGame = room.game;
    // Cancel any pending burn-reveal — the new action supersedes the
    // staged display; the actor (typically the burster) wants to keep
    // playing, so jump straight to the post-action state.
    if (room.burnRevealTimer) {
      clearTimeout(room.burnRevealTimer);
      room.burnRevealTimer = null;
    }
    const result = engine.applyAction(room.game, action);
    if (!result.ok) return ack({ ok: false, error: result.error });
    room.game = result.state;
    if (engine.isPlaying(result.state)) {
      startTurnTimer(room.id, () => handleTimerExpiry(room.id));
    } else {
      clearTurnTimer(room.id);
    }
    ack({ ok: true });

    // Shithead-only: when the action burned the pile (10 or 4-in-row /
    // 4-of-a-kind), broadcast a "pre-burn" view first so players can
    // actually see the cards that triggered the burn. The real state
    // is re-broadcast after BURN_REVEAL_DELAY_MS. shi.joker.choose is
    // excluded because the Joker landing in burnedPile isn't visually
    // a "burn" — the pile naturally empties as part of the choice.
    const actionType = (action as { type?: string }).type ?? '';
    const isBurnCapableAction =
      actionType === 'shi.play' ||
      actionType === 'shi.burst' ||
      actionType === 'shi.playFaceDown';
    const staged =
      room.gameType === 'shithead' &&
      preActionGame !== null &&
      isBurnCapableAction &&
      maybeStageBurnReveal(
        room,
        preActionGame as ShitheadGameState,
        result.state as ShitheadGameState,
      );
    if (!staged) {
      broadcastGameState(room.id);
    }

    if (room.gameType === 'shithead' && preActionGame) {
      maybeAnnounceShitheadBurn(
        room,
        preActionGame as ShitheadGameState,
        result.state as ShitheadGameState,
        action as { type?: string; playerId?: string },
      );
    }
    // Shithead-only: if the new current player can't play, schedule an
    // auto-take with a 3-second notice so spectators see what's going on.
    maybeScheduleAutoTake(room);
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
  if (room.game) {
    const engine = engineFor(room);
    if (engine.isPlaying(room.game)) {
      room.game = engine.abortGameDueToDisconnect(room.game);
      clearTurnTimer(roomId);
      room.scoredCurrentGame = true; // explicit: don't update wins/duraks
    }
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
