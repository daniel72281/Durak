// Public barrel for the Durak game. Other modules should prefer to import
// from this file rather than reaching into engine.ts/rules.ts directly.

import type { GameEngine } from '../common';
import { createDeck, shuffle } from '../../deck';
import {
  applyAction,
  createGame,
  startGame,
} from './engine';
import { computeScoreDeltas } from './scoring';
import { applyExpiryAction } from './expiry';
import { filterGameState } from './stateFilter';
import type { Action, ClientGameState, GameState } from './types';

// The GameEngine<...> implementation for Durak. Wires the existing
// per-file pure functions into a single object that the server's
// dispatcher (and Stage 2+ shared infrastructure) talks to.
export const durakEngine: GameEngine<GameState, Action, ClientGameState> = {
  createGame,
  buildShuffledDeck(rng) {
    return shuffle(createDeck(), rng);
  },
  startGame,
  applyAction,
  filterForPlayer: filterGameState,
  computeScoreDeltas,
  applyExpiryAction,
  isFinished(state) {
    return state.phase === 'finished';
  },
  isPlaying(state) {
    return state.phase === 'playing';
  },
  abortGameDueToDisconnect(state) {
    return {
      ...state,
      phase: 'finished',
      loser: null,
      endReason: 'player_disconnected',
    };
  },
  outOrder(state) {
    return state.outOrder;
  },
};

// Convenience re-exports for callers that prefer the function-style API.
// Eventually most of these will be reached through the engine object, but
// the older imports stay valid so we don't have to churn every call site.
export {
  applyAction,
  createGame,
  findFirstAttackerForNewGame,
  startGame,
} from './engine';
export type {
  EngineError,
  EngineResult,
  EngineSuccess,
  StartGameOptions,
} from './engine';
export {
  beats,
  canAttackCard,
  canDefend,
  canTransfer,
  computeRoundAttackLimit,
  findDurak,
  nextActivePlayerIndex,
  rankIsOnTable,
  rankValue,
  tableIsFullyDefended,
} from './rules';
export type {
  Action,
  ClientGameState,
  GamePhase,
  GameState,
  TablePair,
} from './types';
