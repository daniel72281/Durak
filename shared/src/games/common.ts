// Game registry + the contract every game implements. The server and the
// client both talk to games through the GameEngine interface so adding a
// new game means writing one games/<name>/ directory and adding one entry
// to the `games` registry below — no changes to lobby / socket / Room
// plumbing.

import type { Card, PlayerScore } from '../types';

// Allowed game ids. Add a new string here when registering a new game.
export type GameType = 'durak' | 'shithead';

// Minimal player descriptor passed into createGame.
export interface PlayerSpec {
  id: string;
  nickname: string;
}

// Generic engine result. State shape is per-game (Durak's GameState,
// Shithead's ShitheadGameState, ...) — callers thread the type via the
// generic parameter so we don't sacrifice safety inside any one engine.
export interface EngineSuccess<S> {
  ok: true;
  state: S;
}
export interface EngineError {
  ok: false;
  error: string;
}
export type EngineResult<S> = EngineSuccess<S> | EngineError;

// Restart-time context shared across games. Server passes this on
// game:restart so engines can apply game-specific carryover rules:
//   - Shithead reads `previousLoserId` to mark the new shithead with
//     `forcedFaceUp` so the engine deals their face-up cards randomly.
//   - Durak ignores it (its restart-starter logic lives on startGame's
//     own options arg).
export interface CreateGameContext {
  previousLoserId?: string | null;
}

// The contract each game implements. The server holds an opaque `unknown`
// state per room and lets the engine mutate it — only the engine has the
// right typed view of its own State.
export interface GameEngine<State, Action, ClientState> {
  // Construct the initial 'waiting' state from the room's player list.
  // `context` is non-null on game:restart and may carry the previous
  // game's loser id for engines that want to apply a restart penalty.
  createGame(players: PlayerSpec[], context?: CreateGameContext): State;

  // Build a fresh shuffled draw deck appropriate for this game. Pass an
  // explicit `rng` from tests for determinism; production uses Math.random.
  buildShuffledDeck(rng?: () => number): Card[];

  // Deal hands and move from 'waiting' → 'playing'.
  startGame(state: State, shuffledDeck: Card[]): EngineResult<State>;

  // Apply a player action.
  applyAction(state: State, action: Action): EngineResult<State>;

  // Server-side filter: hide everyone else's hidden info, fold in lobby
  // metadata (deadlines, scoreboard, disconnect flags) and emit the
  // ClientState the recipient is allowed to see.
  filterForPlayer(
    state: State,
    viewerPlayerId: string,
    roomId: string,
    turnDeadline: number | null,
    scoreboard: ReadonlyMap<string, PlayerScore>,
    disconnectedIds: ReadonlySet<string>,
  ): ClientState;

  // Decide whether a finished game should touch the cumulative scoreboard
  // and, if so, by how much per player. Empty map = leave scoreboard alone
  // (e.g. 'player_disconnected' games in Durak).
  computeScoreDeltas(state: State): Map<string, number>;

  // Action to apply when the turn timer expires. Returns the result of
  // running that action through the engine plus the action itself (for
  // logging). action: null means "no useful default — do nothing".
  applyExpiryAction(state: State): {
    result: EngineResult<State>;
    action: Action | null;
  };

  // True once the game has reached a terminal phase. Used by the server to
  // commit scores and broadcast a game-over state.
  isFinished(state: State): boolean;

  // True while a round is actively being played. False during setup /
  // 'waiting' / 'finished'. The disconnect handler uses this to decide
  // whether to abort the round when a player walks away.
  isPlaying(state: State): boolean;

  // Mid-game abort: a player's reconnect-grace expired and we need to
  // end the round without a winner. The engine returns the terminal
  // state to broadcast. Server checks isPlaying() before calling this.
  abortGameDueToDisconnect(state: State): State;

  // The just-finished game's win order (first to empty their hand to
  // last). Used by 'game:restart' to determine who starts next.
  outOrder(state: State): readonly string[];
}

// Registered engines. Server (and tests) look up by GameType.
//
// We rely on the inferred shape of each engine module rather than declaring
// the registry as `Record<GameType, GameEngine<any, any, any>>` — the latter
// would erase the State/Action/ClientState parameters and force callers to
// re-narrow at every call site. Importing the concrete engine here keeps
// per-game type information intact at every callsite that knows the
// gameType statically (which is most of them, after gameType discrimination).
//
import { durakEngine as _durakEngine } from './durak';
import { shitheadEngine as _shitheadEngine } from './shithead';
export const games = {
  durak: _durakEngine,
  shithead: _shitheadEngine,
} as const satisfies Record<GameType, unknown>;

// Re-exported for callers that want the registry type without importing
// each game's engine directly.
export type GamesRegistry = typeof games;
