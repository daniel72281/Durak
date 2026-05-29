// The Durak game engine: pure reducer over GameState.
//
// Public surface:
//   - createGame(playerSpecs)         → initial 'waiting' state
//   - startGame(state, shuffledDeck)  → deals hands, starts round 1
//   - applyAction(state, action)      → dispatch for player actions
//
// Every function returns a NEW state; never mutates inputs. Invalid actions
// return { ok: false, error } so the server can log/respond without crashing.

import {
  type Action,
  type Card,
  type GameState,
  type Player,
  type Suit,
} from './types';
import {
  beats,
  canAttackCard,
  canTransfer,
  computeRoundAttackLimit,
  findDurak,
  nextActivePlayerIndex,
  rankValue,
  tableIsFullyDefended,
} from './rules';
import { dealInitial, drawFromTop } from './deck';

export interface EngineSuccess {
  ok: true;
  state: GameState;
}
export interface EngineError {
  ok: false;
  error: string;
}
export type EngineResult = EngineSuccess | EngineError;

const HAND_TARGET = 6;

// ---------------------------------------------------------------------------
// Public constructors
// ---------------------------------------------------------------------------

export function createGame(
  playerSpecs: readonly { id: string; nickname: string }[],
): GameState {
  if (playerSpecs.length < 2 || playerSpecs.length > 5) {
    throw new Error(
      `Durak needs 2–5 players (got ${playerSpecs.length}); 6 requires a 52-card deck (out of MVP scope)`,
    );
  }
  const ids = new Set(playerSpecs.map((p) => p.id));
  if (ids.size !== playerSpecs.length) {
    throw new Error('player ids must be unique');
  }
  return {
    phase: 'waiting',
    players: playerSpecs.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      hand: [],
      isOut: false,
    })),
    deck: [],
    trumpSuit: 'hearts', // placeholder until startGame
    discard: [],
    table: [],
    attackerIndex: 0,
    defenderIndex: 1,
    roundNumber: 0,
    roundAttackLimit: 0,
    passedPlayerIds: [],
    defenderTaking: false,
    loser: null,
  };
}

export function startGame(state: GameState, shuffledDeck: readonly Card[]): EngineResult {
  if (state.phase !== 'waiting') {
    return fail('game already started');
  }
  let deal;
  try {
    deal = dealInitial(shuffledDeck, state.players.length);
  } catch (e) {
    return fail((e as Error).message);
  }
  const players = state.players.map((p, i) => ({
    ...p,
    hand: [...deal.hands[i]!],
  }));
  const attackerIndex = findFirstAttacker(players, deal.trumpSuit);
  const defenderIndex = nextActivePlayerIndex(players, attackerIndex);
  const roundAttackLimit = computeRoundAttackLimit(
    1,
    players[defenderIndex]!.hand.length,
  );
  return ok({
    ...state,
    phase: 'playing',
    players,
    deck: deal.remaining,
    trumpSuit: deal.trumpSuit,
    attackerIndex,
    defenderIndex,
    roundNumber: 1,
    roundAttackLimit,
    passedPlayerIds: [],
    defenderTaking: false,
  });
}

// Standard rule: player with the lowest trump card opens. If nobody holds a
// trump, the first seat opens (rare with a 36-card deck and ≥2 players).
function findFirstAttacker(players: readonly Player[], trumpSuit: Suit): number {
  let bestIdx = 0;
  let bestValue: number | null = null;
  for (let i = 0; i < players.length; i++) {
    const trumps = players[i]!.hand.filter((c) => c.suit === trumpSuit);
    if (trumps.length === 0) continue;
    const minTrump = trumps.reduce((min, c) =>
      rankValue(c.rank) < rankValue(min.rank) ? c : min,
    );
    const v = rankValue(minTrump.rank);
    if (bestValue === null || v < bestValue) {
      bestValue = v;
      bestIdx = i;
    }
  }
  return bestIdx;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export function applyAction(state: GameState, action: Action): EngineResult {
  if (state.phase !== 'playing') return fail('game is not in playing phase');
  switch (action.type) {
    case 'attack':   return handleAttack(state, action);
    case 'defend':   return handleDefend(state, action);
    case 'transfer': return handleTransfer(state, action);
    case 'take':     return handleTake(state, action);
    case 'pass':     return handlePass(state, action);
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function handleAttack(
  state: GameState,
  action: { playerId: string; card: Card },
): EngineResult {
  const playerIdx = findPlayerIndex(state, action.playerId);
  if (playerIdx === -1) return fail('player not in game');
  if (state.players[playerIdx]!.isOut) return fail('player is out');
  if (playerIdx === state.defenderIndex) return fail('defender cannot attack');

  // Opening attack must come from the official attacker.
  if (state.table.length === 0 && playerIdx !== state.attackerIndex) {
    return fail('opening attack must come from the attacker');
  }

  const player = state.players[playerIdx]!;
  if (!hasCard(player.hand, action.card)) return fail('card not in hand');

  // While defender is taking, throw-ins are still capped by roundAttackLimit
  // but no longer constrained by defender hand size (they aren't defending).
  const defenderHand = state.players[state.defenderIndex]!.hand.length;
  const effectiveDefenderHand = state.defenderTaking
    ? Number.POSITIVE_INFINITY
    : defenderHand;

  if (!canAttackCard(action.card, state.table, effectiveDefenderHand, state.roundAttackLimit)) {
    return fail('card is not a legal attack now');
  }

  const newPlayers = replacePlayer(state.players, playerIdx, {
    ...player,
    hand: removeCard(player.hand, action.card),
  });
  return ok({
    ...state,
    players: newPlayers,
    table: [...state.table, { attack: action.card }],
    passedPlayerIds: [],
  });
}

function handleDefend(
  state: GameState,
  action: { playerId: string; pairIndex: number; card: Card },
): EngineResult {
  const playerIdx = findPlayerIndex(state, action.playerId);
  if (playerIdx !== state.defenderIndex) return fail('only defender can defend');
  if (state.defenderTaking) return fail('cannot defend after declaring take');
  if (action.pairIndex < 0 || action.pairIndex >= state.table.length) {
    return fail('invalid pair index');
  }
  const pair = state.table[action.pairIndex]!;
  if (pair.defense !== undefined) return fail('pair already defended');

  const defender = state.players[playerIdx]!;
  if (!hasCard(defender.hand, action.card)) return fail('card not in hand');
  if (!beats(pair.attack, action.card, state.trumpSuit)) {
    return fail('card does not beat that attack');
  }

  const newPlayers = replacePlayer(state.players, playerIdx, {
    ...defender,
    hand: removeCard(defender.hand, action.card),
  });
  const newTable = state.table.map((p, i) =>
    i === action.pairIndex ? { ...p, defense: action.card } : p,
  );
  return ok({
    ...state,
    players: newPlayers,
    table: newTable,
    passedPlayerIds: [],
  });
}

function handleTransfer(
  state: GameState,
  action: { playerId: string; card: Card },
): EngineResult {
  const playerIdx = findPlayerIndex(state, action.playerId);
  if (playerIdx !== state.defenderIndex) return fail('only defender can transfer');
  if (state.defenderTaking) return fail('cannot transfer after declaring take');

  const defender = state.players[playerIdx]!;
  if (!hasCard(defender.hand, action.card)) return fail('card not in hand');

  const newDefenderIdx = nextActivePlayerIndex(state.players, playerIdx);
  if (newDefenderIdx === -1) return fail('no next active player to transfer to');
  const newDefenderHand = state.players[newDefenderIdx]!.hand.length;

  if (!canTransfer(action.card, state.table, newDefenderHand)) {
    return fail('transfer not allowed in current state');
  }

  const newPlayers = replacePlayer(state.players, playerIdx, {
    ...defender,
    hand: removeCard(defender.hand, action.card),
  });
  const newRoundAttackLimit = computeRoundAttackLimit(
    state.roundNumber,
    newPlayers[newDefenderIdx]!.hand.length,
  );
  return ok({
    ...state,
    players: newPlayers,
    table: [...state.table, { attack: action.card }],
    defenderIndex: newDefenderIdx,
    roundAttackLimit: newRoundAttackLimit,
    passedPlayerIds: [],
  });
}

function handleTake(state: GameState, action: { playerId: string }): EngineResult {
  if (state.players[state.defenderIndex]?.id !== action.playerId) {
    return fail('only defender can take');
  }
  if (state.defenderTaking) return fail('already declared take');
  if (state.table.length === 0) return fail('nothing on table to take');
  return ok({
    ...state,
    defenderTaking: true,
    passedPlayerIds: [],
  });
}

function handlePass(state: GameState, action: { playerId: string }): EngineResult {
  const playerIdx = findPlayerIndex(state, action.playerId);
  if (playerIdx === -1) return fail('player not in game');
  if (state.players[playerIdx]!.isOut) return fail('player is out');
  if (playerIdx === state.defenderIndex) return fail('defender cannot pass');
  if (state.table.length === 0) return fail('cannot pass on empty table');

  if (!state.defenderTaking && !tableIsFullyDefended(state.table)) {
    return fail('cannot pass while defender owes a defense — defender must defend or take');
  }

  const newPassed = state.passedPlayerIds.includes(action.playerId)
    ? state.passedPlayerIds
    : [...state.passedPlayerIds, action.playerId];
  const interimState: GameState = { ...state, passedPlayerIds: newPassed };

  if (!allNonDefendersPassed(interimState)) {
    return ok(interimState);
  }
  return ok(completeRound(interimState));
}

// ---------------------------------------------------------------------------
// Round transition
// ---------------------------------------------------------------------------

function completeRound(state: GameState): GameState {
  // 1. Collect table cards either to defender (take) or to discard.
  const tableCards: Card[] = [];
  for (const pair of state.table) {
    tableCards.push(pair.attack);
    if (pair.defense) tableCards.push(pair.defense);
  }

  let players = [...state.players];
  let discard = state.discard;
  let nextAttackerIdx: number;
  let nextDefenderIdx: number;

  if (state.defenderTaking) {
    const def = players[state.defenderIndex]!;
    players[state.defenderIndex] = { ...def, hand: [...def.hand, ...tableCards] };
    // Defender skips their attack turn: attacker advances 2 seats past defender.
    nextAttackerIdx = nextActivePlayerIndex(players, state.defenderIndex);
    nextDefenderIdx = nextActivePlayerIndex(players, nextAttackerIdx);
  } else {
    discard = [...discard, ...tableCards];
    // Defender successfully defended → becomes next attacker.
    nextAttackerIdx = state.defenderIndex;
    nextDefenderIdx = nextActivePlayerIndex(players, nextAttackerIdx);
  }

  // 2. Replenish hands. Order: previous attacker first, clockwise, defender last.
  let deck = state.deck;
  const drawOrder = computeDrawOrder(players.length, state.attackerIndex, state.defenderIndex);
  for (const idx of drawOrder) {
    const player = players[idx]!;
    const need = Math.max(0, HAND_TARGET - player.hand.length);
    if (need === 0) continue;
    const { drawn, remaining } = drawFromTop(deck, need);
    players[idx] = { ...player, hand: [...player.hand, ...drawn] };
    deck = remaining;
  }

  // 3. Mark players who are out (hand empty AND deck empty).
  players = players.map((p) => ({
    ...p,
    isOut: p.hand.length === 0 && deck.length === 0,
  }));

  // 4. Game over?
  const durakId = findDurak(players, deck.length);
  if (durakId !== null) {
    return {
      ...state,
      players,
      deck,
      discard,
      table: [],
      passedPlayerIds: [],
      defenderTaking: false,
      phase: 'finished',
      loser: durakId,
    };
  }
  // Also check the "everyone empty" draw case — phase 'finished', loser null.
  const allEmpty = players.every((p) => p.hand.length === 0);
  if (allEmpty && deck.length === 0) {
    return {
      ...state,
      players,
      deck,
      discard,
      table: [],
      passedPlayerIds: [],
      defenderTaking: false,
      phase: 'finished',
      loser: null,
    };
  }

  // 5. Skip any out players in the new attacker/defender assignment.
  if (players[nextAttackerIdx]?.isOut) {
    nextAttackerIdx = nextActivePlayerIndex(players, nextAttackerIdx);
  }
  if (players[nextDefenderIdx]?.isOut || nextDefenderIdx === nextAttackerIdx) {
    nextDefenderIdx = nextActivePlayerIndex(players, nextAttackerIdx);
  }

  const nextRoundNumber = state.roundNumber + 1;
  const nextRoundAttackLimit = computeRoundAttackLimit(
    nextRoundNumber,
    players[nextDefenderIdx]?.hand.length ?? 0,
  );

  return {
    ...state,
    players,
    deck,
    discard,
    table: [],
    passedPlayerIds: [],
    defenderTaking: false,
    attackerIndex: nextAttackerIdx,
    defenderIndex: nextDefenderIdx,
    roundNumber: nextRoundNumber,
    roundAttackLimit: nextRoundAttackLimit,
  };
}

// Standard draw order: from the previous attacker, clockwise, defender LAST.
function computeDrawOrder(
  playerCount: number,
  attackerIdx: number,
  defenderIdx: number,
): number[] {
  const order: number[] = [];
  for (let step = 0; step < playerCount; step++) {
    const i = (attackerIdx + step) % playerCount;
    if (i !== defenderIdx) order.push(i);
  }
  order.push(defenderIdx);
  return order;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findPlayerIndex(state: GameState, playerId: string): number {
  return state.players.findIndex((p) => p.id === playerId);
}

function hasCard(hand: readonly Card[], card: Card): boolean {
  return hand.some((c) => c.suit === card.suit && c.rank === card.rank);
}

function removeCard(hand: readonly Card[], card: Card): Card[] {
  const idx = hand.findIndex(
    (c) => c.suit === card.suit && c.rank === card.rank,
  );
  if (idx === -1) throw new Error('engine bug: removeCard on card not in hand');
  return [...hand.slice(0, idx), ...hand.slice(idx + 1)];
}

function replacePlayer(
  players: readonly Player[],
  index: number,
  next: Player,
): Player[] {
  const arr = [...players];
  arr[index] = next;
  return arr;
}

function allNonDefendersPassed(state: GameState): boolean {
  const required: string[] = [];
  for (let i = 0; i < state.players.length; i++) {
    if (i === state.defenderIndex) continue;
    if (state.players[i]!.isOut) continue;
    required.push(state.players[i]!.id);
  }
  if (required.length === 0) return true;
  const passed = new Set(state.passedPlayerIds);
  return required.every((id) => passed.has(id));
}

function ok(state: GameState): EngineSuccess {
  return { ok: true, state };
}

function fail(error: string): EngineError {
  return { ok: false, error };
}
