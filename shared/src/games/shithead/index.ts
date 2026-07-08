// Public barrel for the Shithead game. Mirrors durak/index.ts so the
// server's dispatcher and Stage 5 UI can talk to either game through
// the same GameEngine<...> contract.

import type { GameEngine } from '../common';
import { createShitheadDeck, shuffle } from '../../deck';
import { applyAction, createGame, startGame } from './engine';
import { computeScoreDeltas } from './scoring';
import { applyExpiryAction } from './expiry';
import { filterGameState } from './stateFilter';
import type {
  ShitheadAction,
  ShitheadClientGameState,
  ShitheadGameState,
} from './types';

export const shitheadEngine: GameEngine<
  ShitheadGameState,
  ShitheadAction,
  ShitheadClientGameState
> = {
  createGame(players, context) {
    const previousOutOrder = context?.previousOutOrder ?? null;
    return createGame(players, {
      shitheadId: context?.previousLoserId ?? null,
      previousOutOrder,
      // First game in the room (no previous ranking) → randomize seats
      // so the starter is a random player. Restart uses previousOutOrder
      // instead and doesn't need shuffling.
      randomizeSeats: !previousOutOrder || previousOutOrder.length === 0,
    });
  },
  buildShuffledDeck(rng) {
    // 52 standard cards + 2 jokers (one black-spades, one red-hearts) so
    // each Joker has a unique cardKey for client-side deduping.
    return shuffle(createShitheadDeck(), rng);
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

// Convenience re-exports for tests + UI.
export {
  applyAction,
  createGame,
  startGame,
} from './engine';
export type {
  ShitheadAction,
  ShitheadClientGameState,
  ShitheadGameState,
  ShitheadPhase,
  ShitheadPlayer,
  ShitheadPublicPlayer,
} from './types';
