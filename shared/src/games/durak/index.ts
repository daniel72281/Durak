// Public barrel for the Durak game. Other modules should prefer to import
// from this file rather than reaching into engine.ts/rules.ts directly.
// In Stage 2 this will export a `durakEngine` object that conforms to the
// shared GameEngine<...> interface.

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
