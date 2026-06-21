// The Shithead game engine: pure reducer over ShitheadGameState.
//
// Public surface:
//   - createGame(playerSpecs)        → initial 'setup' state (or 'waiting'
//                                      if startGame hasn't been called yet)
//   - startGame(state, shuffledDeck) → deals 3 face-down + 6 hand per
//                                      player, draws the rest into the
//                                      deck, moves to 'setup' phase
//   - applyAction(state, action)     → dispatch for player actions
//
// Every function returns a NEW state; never mutates inputs.

import type { EngineResult } from '../common';
import type { Card } from '../../types';
import { drawFromTop } from '../../deck';
import { canPlay, nextActivePlayerIndex, pileHasFourInARow } from './rules';
import type {
  ShitheadAction,
  ShitheadGameState,
  ShitheadPlayer,
} from './types';

// User-confirmed setup numbers.
const FACE_DOWN_PER_PLAYER = 3;
const SETUP_HAND_PER_PLAYER = 6; // dealt → pick 3 to flip face-up → keep 3
// Post-setup the engine refills the hand from the draw deck after every
// play until the deck empties. The target stays at 3.
const POST_SETUP_HAND_TARGET = 3;

// ---------------------------------------------------------------------------
// Public constructors
// ---------------------------------------------------------------------------

export function createGame(
  playerSpecs: readonly { id: string; nickname: string }[],
  options: { shitheadId?: string | null } = {},
): ShitheadGameState {
  const players: ShitheadPlayer[] = playerSpecs.map((p) => ({
    id: p.id,
    nickname: p.nickname,
    hand: [],
    faceUp: [],
    faceDown: [],
    isOut: false,
    setupConfirmed: false,
    // The previous game's shithead loses their face-up choice in the
    // next game (penalty rule). Other players go through the normal
    // setup flow.
    forcedFaceUp: options.shitheadId !== null && options.shitheadId === p.id,
  }));
  return {
    phase: 'setup',
    players,
    deck: [],
    pile: [],
    burnedPile: [],
    currentPlayerIdx: 0,
    pendingJokerChooserId: null,
    quickChainEligible: null,
    outOrder: [],
    loser: null,
    endReason: null,
  };
}

// Deal 3 face-down + 6 hand cards to each player from `shuffledDeck`.
// For players with forcedFaceUp=true the engine immediately assigns 3
// random face-up cards (no choice) and shrinks the hand to 3. The
// remaining cards form the draw deck. Phase stays 'setup' so the
// non-forced players can confirm their pick.
export function startGame(
  state: ShitheadGameState,
  shuffledDeck: readonly Card[],
): EngineResult<ShitheadGameState> {
  if (state.phase !== 'setup') return fail('startGame: not in setup phase');
  if (state.players.length < 2) return fail('startGame: need at least 2 players');

  const needed =
    state.players.length * (FACE_DOWN_PER_PLAYER + SETUP_HAND_PER_PLAYER);
  if (shuffledDeck.length < needed) {
    return fail(
      `startGame: deck too small — need ${needed}, got ${shuffledDeck.length}`,
    );
  }

  // Pop from the END (top of the draw deck). Same convention as Durak.
  let deck = shuffledDeck.slice();
  const players = state.players.map((p) => ({ ...p, hand: [] as Card[], faceUp: [] as Card[], faceDown: [] as Card[] }));

  // 1) Three face-down cards each.
  for (let card = 0; card < FACE_DOWN_PER_PLAYER; card++) {
    for (const p of players) {
      p.faceDown.push(deck.pop()!);
    }
  }
  // 2) Six hand cards each (player will choose 3 to flip up; forced-faceUp
  //    players have their faceUp picked at random by the engine below).
  for (let card = 0; card < SETUP_HAND_PER_PLAYER; card++) {
    for (const p of players) {
      p.hand.push(deck.pop()!);
    }
  }

  // 3) For the (previous-game) shithead: skip setup, pick 3 random hand
  //    cards as faceUp. They confirm automatically.
  for (const p of players) {
    if (!p.forcedFaceUp) continue;
    const indexes = pickThreeIndexes(p.hand.length);
    p.faceUp = indexes.map((i) => p.hand[i]!);
    p.hand = p.hand.filter((_, i) => !indexes.includes(i));
    p.setupConfirmed = true;
  }

  return ok({
    ...state,
    players,
    deck,
    phase: 'setup',
  });
}

// ---------------------------------------------------------------------------
// Action dispatch
// ---------------------------------------------------------------------------

export function applyAction(
  state: ShitheadGameState,
  action: ShitheadAction,
): EngineResult<ShitheadGameState> {
  const result = dispatch(state, action);
  if (!result.ok) return result;
  return ok(postProcess(result.state));
}

function dispatch(
  state: ShitheadGameState,
  action: ShitheadAction,
): EngineResult<ShitheadGameState> {
  switch (action.type) {
    case 'shi.setup.confirm':
      return handleSetupConfirm(state, action);
    case 'shi.play':
      return handlePlay(state, action);
    case 'shi.playFaceDown':
      return handlePlayFaceDown(state, action);
    case 'shi.burst':
      return handleBurst(state, action);
    case 'shi.joker.choose':
      return handleJokerChoose(state, action);
    case 'shi.takePile':
      return handleTakePile(state, action);
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function handleSetupConfirm(
  state: ShitheadGameState,
  action: Extract<ShitheadAction, { type: 'shi.setup.confirm' }>,
): EngineResult<ShitheadGameState> {
  if (state.phase !== 'setup') return fail('not in setup phase');
  const playerIdx = state.players.findIndex((p) => p.id === action.playerId);
  if (playerIdx === -1) return fail('player not in game');
  const player = state.players[playerIdx]!;
  if (player.setupConfirmed) return fail('already confirmed');
  if (player.forcedFaceUp) return fail('shithead does not choose face-up');

  // Indexes must be exactly 3 distinct values within current hand range.
  const idx = [...action.faceUpIndexes].sort((a, b) => a - b);
  if (idx.length !== 3) return fail('must select exactly 3 cards');
  for (const i of idx) {
    if (!Number.isInteger(i) || i < 0 || i >= player.hand.length) {
      return fail('invalid card index');
    }
  }
  for (let k = 1; k < idx.length; k++) {
    if (idx[k] === idx[k - 1]) return fail('duplicate index');
  }

  const faceUp = idx.map((i) => player.hand[i]!);
  const newHand = player.hand.filter((_, i) => !idx.includes(i));
  const newPlayers = state.players.map((p, i) =>
    i === playerIdx
      ? { ...p, faceUp, hand: newHand, setupConfirmed: true }
      : p,
  );
  const allConfirmed = newPlayers.every((p) => p.setupConfirmed);
  return ok({
    ...state,
    players: newPlayers,
    phase: allConfirmed ? 'playing' : 'setup',
    // Stage 4b will set currentPlayerIdx via a "first attacker" rule when
    // we enter 'playing' here. For now it stays at the default 0.
  });
}

// Regular play from hand or faceUp.
//
// Validates:
//   - phase is 'playing' and no joker chooser is pending
//   - it is the actor's turn and they are still in the game
//   - cards array is non-empty and all same rank
//   - source='faceUp' requires hand AND deck both empty (faceUp phase)
//   - the actor actually owns each card (matched by rank+suit) in the
//     declared source pile
//   - the first card is a legal play on top of the pile (canPlay)
//
// Then applies the play:
//   - cards leave their source pile, join the pile
//   - rank '10' burns the pile (cards land on burnedPile) and the same
//     player plays again (no turn advance)
//   - rank '8' skips N additional players where N = cards.length (so a
//     single 8 skips one player, 2× 8 skips two, etc. — see plan for the
//     3-player example)
//   - JOKER stops the loop — chooser must follow up with shi.joker.choose
//   - 4-in-a-row / 4-of-a-kind burns and the same player plays again
//   - 2 / 3 / 7 effects are applied lazily through rules.effectiveConstraint
//     when the NEXT player tries to play, so the engine just leaves them on
//     the pile here
//   - hand refills from the draw deck up to POST_SETUP_HAND_TARGET (3) when
//     drawing from hand AND the deck still has cards
//
// faceDown play is its own handler (handlePlayFaceDown). Out-of-game
// detection (Stage 4e) is intentionally deferred.
function handlePlay(
  state: ShitheadGameState,
  action: Extract<ShitheadAction, { type: 'shi.play' }>,
): EngineResult<ShitheadGameState> {
  if (state.phase !== 'playing') return fail('not in playing phase');
  if (state.pendingJokerChooserId !== null) {
    return fail('joker chooser must pick a victim first');
  }
  const playerIdx = state.players.findIndex((p) => p.id === action.playerId);
  if (playerIdx === -1) return fail('player not in game');
  const player = state.players[playerIdx]!;
  if (player.isOut) return fail('player is out');

  const cards = action.cards;
  if (cards.length === 0) return fail('must play at least one card');
  const rank = cards[0]!.rank;
  for (const c of cards) {
    if (c.rank !== rank) return fail('all played cards must share a rank');
  }

  // Turn check. Normally the actor must be the current player; the
  // quick-chain rule loosens that: a player who just played a card and
  // wound up holding another of the same rank — whether through a draw-
  // deck refill OR by transitioning to faceUp phase with a matching
  // faceUp card — can chain it in even though `currentPlayerIdx` has
  // already moved on, provided their action arrives BEFORE the next
  // player plays. The race is decided naturally by socket-arrival order
  // on the server. Source can be 'hand' or 'faceUp' to support the
  // post-empty-hand chain into faceUp phase.
  if (playerIdx !== state.currentPlayerIdx) {
    const qc = state.quickChainEligible;
    if (
      !qc ||
      qc.playerId !== action.playerId ||
      qc.rank !== rank
    ) {
      return fail('not your turn');
    }
  }

  // Pick the source pile, validate the phase gate for faceUp.
  let sourceCards: Card[];
  if (action.source === 'hand') {
    sourceCards = player.hand;
  } else {
    // 'faceUp' — only usable once both hand and the draw deck are exhausted.
    if (player.hand.length > 0) {
      return fail('cannot play from faceUp while hand is not empty');
    }
    if (state.deck.length > 0) {
      return fail('cannot play from faceUp while deck is not empty');
    }
    if (player.faceUp.length === 0) {
      return fail('no faceUp cards to play');
    }
    sourceCards = player.faceUp;
  }

  // Confirm ownership — every card in `cards` must match a DISTINCT card in
  // the chosen source by rank+suit. Build the post-play source by removing
  // those entries one at a time.
  const remainingSource = sourceCards.slice();
  for (const c of cards) {
    const i = remainingSource.findIndex(
      (h) => h.rank === c.rank && h.suit === c.suit,
    );
    if (i === -1) {
      return fail(`card not in ${action.source}`);
    }
    remainingSource.splice(i, 1);
  }

  // The rules check examines only the lead card — multi-card plays share a
  // rank, so the rest are legal iff the lead is.
  if (!canPlay(cards[0]!, state.pile)) return fail('illegal play');

  // Refill hand from the END of the deck (same pop() convention as setup).
  // Only when the played cards came from hand — faceUp plays happen after
  // the deck has run dry, so no refill applies there.
  const newDeck = state.deck.slice();
  let newHand: Card[] = player.hand.slice();
  let newFaceUp: Card[] = player.faceUp.slice();
  let chainEligibleAfter = false;
  if (action.source === 'hand') {
    newHand = remainingSource;
    const handLenBeforeRefill = newHand.length;
    while (newHand.length < POST_SETUP_HAND_TARGET && newDeck.length > 0) {
      newHand.push(newDeck.pop()!);
    }
    // Quick-chain trigger A: refill drew at least one card of the same
    // rank the actor just played — chain another from hand.
    for (let i = handLenBeforeRefill; i < newHand.length; i++) {
      if (newHand[i]!.rank === rank) {
        chainEligibleAfter = true;
        break;
      }
    }
    // Quick-chain trigger B: the actor just emptied their hand, the
    // deck is dry too, AND their face-up pile still has a card of the
    // same rank. They can chain it from face-up before the next player
    // acts — same race as the refill case.
    if (
      !chainEligibleAfter &&
      newHand.length === 0 &&
      newDeck.length === 0 &&
      newFaceUp.some((c) => c.rank === rank)
    ) {
      chainEligibleAfter = true;
    }
  } else {
    newFaceUp = remainingSource;
    // Quick-chain trigger C: still in face-up phase with another
    // matching card available — chain it.
    if (newFaceUp.some((c) => c.rank === rank)) {
      chainEligibleAfter = true;
    }
  }

  const newPlayers = state.players.map((p, i) =>
    i === playerIdx ? { ...p, hand: newHand, faceUp: newFaceUp } : p,
  );

  const newPile = state.pile.concat(cards);
  return ok(
    applyPostPlay({
      state,
      playerId: action.playerId,
      playerIdx,
      newPile,
      newBurned: state.burnedPile,
      newDeck,
      newPlayers,
      rank,
      playedCount: cards.length,
      drewSameRank: chainEligibleAfter,
    }),
  );
}

// Apply Shithead's post-placement effects given a snapshot of the state
// where `cards` have just been added to `newPile` and removed from the
// actor's source pile. Centralized so both handlePlay and
// handlePlayFaceDown follow exactly the same rules pathway:
//
//   - 10 burn          rank '10' → newPile (incl. 10s) → burnedPile, actor
//                                  plays again
//   - 4-in-a-row burn  top 4 cards same rank → burn, actor plays again
//                      (covers 4-of-a-kind in one play and accumulated runs)
//   - Joker            actor must follow up with shi.joker.choose; turn does
//                      not advance and the Joker stays on the pile
//   - 8 skip           advance by (playedCount + 1) active seats
//   - default          normal next-active
function applyPostPlay(args: {
  state: ShitheadGameState;
  playerId: string;
  playerIdx: number;
  newPile: Card[];
  newBurned: Card[];
  newDeck: Card[];
  newPlayers: ShitheadPlayer[];
  rank: Card['rank'];
  playedCount: number;
  drewSameRank: boolean;
}): ShitheadGameState {
  let newPile = args.newPile;
  let newBurned = args.newBurned;
  const isTen = args.rank === '10';
  const isJoker = args.rank === 'JOKER';

  if (isTen) {
    newBurned = newBurned.concat(newPile);
    newPile = [];
  }
  let isFourBurn = false;
  if (!isTen && !isJoker && pileHasFourInARow(newPile)) {
    newBurned = newBurned.concat(newPile);
    newPile = [];
    isFourBurn = true;
  }

  if (isJoker) {
    return {
      ...args.state,
      pile: newPile,
      burnedPile: newBurned,
      deck: args.newDeck,
      players: args.newPlayers,
      pendingJokerChooserId: args.playerId,
      // Joker has its own pending-choose flow; chain doesn't apply here.
      quickChainEligible: null,
    };
  }

  const samePlayerReplays = isTen || isFourBurn;
  // When the actor keeps the turn (10 burn / 4-burn), they continue as
  // current player. For normal advance, walk active seats forward from
  // the actor's position — this lets quick-chain plays (where the actor
  // is NOT state.currentPlayerIdx) advance naturally.
  let nextIdx = args.playerIdx;
  if (!samePlayerReplays) {
    const activeCount = args.newPlayers.filter((p) => !p.isOut).length;
    if (args.rank === '8' && activeCount <= 2) {
      // 2-player rule: 8s keep the turn with the actor. You can't skip
      // yourself, and there's only one other seat — every skip bounces
      // the round back, so any number of 8s leaves you on turn.
      nextIdx = args.playerIdx;
    } else {
      const steps = args.rank === '8' ? args.playedCount + 1 : 1;
      let cur = args.playerIdx;
      for (let s = 0; s < steps; s++) {
        const next = nextActivePlayerIndex(args.newPlayers, cur);
        if (next === -1) break;
        cur = next;
      }
      nextIdx = cur;
    }
  }

  // Re-arm the chain only when the turn ACTUALLY left the actor (any
  // same-player-replay case wins them the next turn anyway, no chain
  // needed), and only on a hand-source play where the refill drew the
  // same rank.
  const reArmChain =
    args.drewSameRank && !samePlayerReplays && nextIdx !== args.playerIdx;
  const newQuickChain = reArmChain
    ? { playerId: args.playerId, rank: args.rank }
    : null;

  return {
    ...args.state,
    pile: newPile,
    burnedPile: newBurned,
    deck: args.newDeck,
    players: args.newPlayers,
    currentPlayerIdx: nextIdx,
    quickChainEligible: newQuickChain,
  };
}

// Reveal and play a single face-down card. The actor must have already
// drained their hand AND faceUp piles (faceDown phase). The revealed
// card is removed from faceDown. If it is a legal play, normal post-play
// effects apply; otherwise the actor picks up the pile + that revealed
// card (it joins their hand) and the turn passes to the next player.
function handlePlayFaceDown(
  state: ShitheadGameState,
  action: Extract<ShitheadAction, { type: 'shi.playFaceDown' }>,
): EngineResult<ShitheadGameState> {
  if (state.phase !== 'playing') return fail('not in playing phase');
  if (state.pendingJokerChooserId !== null) {
    return fail('joker chooser must pick a victim first');
  }
  const playerIdx = state.players.findIndex((p) => p.id === action.playerId);
  if (playerIdx === -1) return fail('player not in game');
  if (playerIdx !== state.currentPlayerIdx) return fail('not your turn');
  const player = state.players[playerIdx]!;
  if (player.isOut) return fail('player is out');

  // Gate to the faceDown phase only.
  if (player.hand.length > 0) {
    return fail('cannot play faceDown while hand is not empty');
  }
  if (player.faceUp.length > 0) {
    return fail('cannot play faceDown while faceUp is not empty');
  }
  if (state.deck.length > 0) {
    return fail('cannot play faceDown while deck is not empty');
  }
  if (player.faceDown.length === 0) {
    return fail('no faceDown cards left');
  }
  const i = action.faceDownIndex;
  if (!Number.isInteger(i) || i < 0 || i >= player.faceDown.length) {
    return fail('invalid faceDown index');
  }

  const revealed = player.faceDown[i]!;
  const newFaceDown = player.faceDown.filter((_, k) => k !== i);

  if (canPlay(revealed, state.pile)) {
    const newPlayers = state.players.map((p, k) =>
      k === playerIdx ? { ...p, faceDown: newFaceDown } : p,
    );
    return ok(
      applyPostPlay({
        state,
        playerId: action.playerId,
        playerIdx,
        newPile: state.pile.concat([revealed]),
        newBurned: state.burnedPile,
        newDeck: state.deck,
        newPlayers,
        rank: revealed.rank,
        playedCount: 1,
        // FaceDown play never refills (deck is empty in that phase), so
        // the quick-chain rule can't trigger off a face-down reveal.
        drewSameRank: false,
      }),
    );
  }

  // Failure: actor swallows pile + the revealed card into their hand. The
  // remaining faceDown stays as-is. Turn advances normally — taking the
  // pile means the next player after the taker plays (matches plan rule 5).
  const newHand = player.hand.concat(state.pile, [revealed]);
  const newPlayers = state.players.map((p, k) =>
    k === playerIdx ? { ...p, hand: newHand, faceDown: newFaceDown } : p,
  );
  const nextIdx = nextActivePlayerIndex(newPlayers, playerIdx);
  return ok({
    ...state,
    pile: [],
    players: newPlayers,
    currentPlayerIdx: nextIdx === -1 ? state.currentPlayerIdx : nextIdx,
    quickChainEligible: null,
  });
}

// Out-of-turn 4-burst: any active player can interrupt with 1+ 4s when
// the pile is empty (game start, after a take, after a burn). Multi-card
// bursts let a player slam down all the 4s they own at once — when that
// fills the pile with four of the same rank, the four-in-a-row burn
// triggers and the burster keeps their turn.
function handleBurst(
  state: ShitheadGameState,
  action: Extract<ShitheadAction, { type: 'shi.burst' }>,
): EngineResult<ShitheadGameState> {
  if (state.phase !== 'playing') return fail('not in playing phase');
  if (state.pendingJokerChooserId !== null) {
    return fail('joker chooser must pick a victim first');
  }
  // Burst is legal on an empty pile OR when the pile contains nothing
  // but 4s — that's the "burst chain" window opened by an earlier
  // burster. As soon as any non-4 lands on top, the window closes.
  if (state.pile.length > 0 && state.pile.some((c) => c.rank !== '4')) {
    return fail('burst requires an empty pile or an all-4s pile');
  }

  const playerIdx = state.players.findIndex((p) => p.id === action.playerId);
  if (playerIdx === -1) return fail('player not in game');
  const player = state.players[playerIdx]!;
  if (player.isOut) return fail('player is out');

  const cards = action.cards;
  if (cards.length === 0) return fail('must burst at least one card');
  for (const c of cards) {
    if (c.rank !== '4') return fail('burst cards must all be 4s');
  }

  // Source can be hand or faceUp. faceUp burst is only allowed when the
  // burster is already in faceUp phase (no hand cards, no deck) — same
  // gate as a regular faceUp play.
  let newHand = player.hand.slice();
  let newFaceUp = player.faceUp.slice();
  const newDeck = state.deck.slice();
  if (action.source === 'hand') {
    for (const c of cards) {
      const i = newHand.findIndex(
        (h) => h.rank === c.rank && h.suit === c.suit,
      );
      if (i === -1) return fail('card not in hand');
      newHand.splice(i, 1);
    }
    while (newHand.length < POST_SETUP_HAND_TARGET && newDeck.length > 0) {
      newHand.push(newDeck.pop()!);
    }
  } else {
    if (player.hand.length > 0) {
      return fail('cannot burst from faceUp while hand is not empty');
    }
    if (state.deck.length > 0) {
      return fail('cannot burst from faceUp while deck is not empty');
    }
    for (const c of cards) {
      const i = newFaceUp.findIndex(
        (h) => h.rank === c.rank && h.suit === c.suit,
      );
      if (i === -1) return fail('card not in faceUp');
      newFaceUp.splice(i, 1);
    }
  }

  const newPlayers = state.players.map((p, i) =>
    i === playerIdx ? { ...p, hand: newHand, faceUp: newFaceUp } : p,
  );

  // Place the burst cards on top of whatever 4s are already there
  // (chain bursts) and apply the four-in-a-row burn rule. When the pile
  // hits 4× 4s the rule fires, the pile burns, and the burster keeps
  // their turn. Otherwise the pile stays put and the turn passes to the
  // player AFTER the burster (out-of-turn nature of the burst).
  let newPile: Card[] = state.pile.concat(cards);
  let newBurned = state.burnedPile;
  let burned = false;
  if (pileHasFourInARow(newPile)) {
    newBurned = newBurned.concat(newPile);
    newPile = [];
    burned = true;
  }

  let nextIdx: number;
  if (burned) {
    nextIdx = playerIdx;
  } else {
    const candidate = nextActivePlayerIndex(newPlayers, playerIdx);
    nextIdx = candidate === -1 ? state.currentPlayerIdx : candidate;
  }

  return ok({
    ...state,
    pile: newPile,
    burnedPile: newBurned,
    deck: newDeck,
    players: newPlayers,
    currentPlayerIdx: nextIdx,
    quickChainEligible: null,
  });
}

// Resolve a pending Joker: the chooser names a victim, the entire pile
// (including the Joker) moves into the victim's hand, and the turn goes
// to the active player AFTER the victim.
function handleJokerChoose(
  state: ShitheadGameState,
  action: Extract<ShitheadAction, { type: 'shi.joker.choose' }>,
): EngineResult<ShitheadGameState> {
  if (state.phase !== 'playing') return fail('not in playing phase');
  if (state.pendingJokerChooserId !== action.playerId) {
    return fail('not your joker to resolve');
  }
  if (action.victimId === action.playerId) {
    return fail('cannot choose yourself as victim');
  }
  const victimIdx = state.players.findIndex((p) => p.id === action.victimId);
  if (victimIdx === -1) return fail('victim not in game');
  const victim = state.players[victimIdx]!;
  if (victim.isOut) return fail('victim is out');

  // The Joker(s) themselves don't go to the victim — they burn. The
  // victim only swallows the non-Joker cards that were on the pile.
  const jokers = state.pile.filter((c) => c.rank === 'JOKER');
  const nonJokers = state.pile.filter((c) => c.rank !== 'JOKER');

  const newPlayers = state.players.map((p, i) =>
    i === victimIdx ? { ...p, hand: p.hand.concat(nonJokers) } : p,
  );

  const nextIdx = nextActivePlayerIndex(newPlayers, victimIdx);

  return ok({
    ...state,
    pile: [],
    burnedPile: state.burnedPile.concat(jokers),
    players: newPlayers,
    currentPlayerIdx: nextIdx === -1 ? state.currentPlayerIdx : nextIdx,
    pendingJokerChooserId: null,
    quickChainEligible: null,
  });
}

// Explicit take. Sweeps the entire pile into the actor's hand and passes
// the turn to the next active player. Plan rule 5: the taker does NOT
// play next — the player AFTER them does. Used by the turn-timer fallback
// and an eventual "give up" UI; the engine usually auto-takes via
// applyAutoTakeIfNeeded without anyone clicking.
function handleTakePile(
  state: ShitheadGameState,
  action: Extract<ShitheadAction, { type: 'shi.takePile' }>,
): EngineResult<ShitheadGameState> {
  if (state.phase !== 'playing') return fail('not in playing phase');
  if (state.pendingJokerChooserId !== null) {
    return fail('joker chooser must pick a victim first');
  }
  const playerIdx = state.players.findIndex((p) => p.id === action.playerId);
  if (playerIdx === -1) return fail('player not in game');
  if (playerIdx !== state.currentPlayerIdx) return fail('not your turn');
  const player = state.players[playerIdx]!;
  if (player.isOut) return fail('player is out');
  if (state.pile.length === 0) return fail('pile is empty');

  const newHand = player.hand.concat(state.pile);
  const newPlayers = state.players.map((p, i) =>
    i === playerIdx ? { ...p, hand: newHand } : p,
  );
  const nextIdx = nextActivePlayerIndex(newPlayers, playerIdx);
  return ok({
    ...state,
    pile: [],
    players: newPlayers,
    currentPlayerIdx: nextIdx === -1 ? state.currentPlayerIdx : nextIdx,
    quickChainEligible: null,
  });
}

// ---------------------------------------------------------------------------
// Post-processing pipeline
// ---------------------------------------------------------------------------
//
// Runs after every successful dispatch. Steps in order:
//   1. markOuts            — players whose hand+faceUp+faceDown are all
//                            empty (and aren't owing a Joker choice) leave
//                            the game; they're appended to outOrder
//   2. checkFinished       — when only one (or zero) active players remain,
//                            phase flips to 'finished' and `loser` is set
//   3. advanceIfCurrentOut — the engine moves currentPlayerIdx off any
//                            now-out player (happens when the actor just
//                            emptied themselves)
//
// Auto-take (when the current actor has no legal move and the pile is
// non-empty) used to live here too, but the server now orchestrates it
// with a 3-second notice so spectators can see what's about to happen.
// Server code calls `applyAutoTakeIfNeeded` directly after a delay; the
// engine still exposes it as a pure helper.

function postProcess(state: ShitheadGameState): ShitheadGameState {
  state = markOuts(state);
  state = checkFinished(state);
  if (state.phase !== 'playing') return state;
  state = advanceIfCurrentOut(state);
  return state;
}

function markOuts(state: ShitheadGameState): ShitheadGameState {
  const newOutOrder = state.outOrder.slice();
  let changed = false;
  const newPlayers = state.players.map((p) => {
    if (p.isOut) return p;
    if (
      p.hand.length === 0 &&
      p.faceUp.length === 0 &&
      p.faceDown.length === 0 &&
      state.pendingJokerChooserId !== p.id
    ) {
      newOutOrder.push(p.id);
      changed = true;
      return { ...p, isOut: true };
    }
    return p;
  });
  if (!changed) return state;
  return { ...state, players: newPlayers, outOrder: newOutOrder };
}

function checkFinished(state: ShitheadGameState): ShitheadGameState {
  if (state.phase !== 'playing') return state;
  const active = state.players.filter((p) => !p.isOut);
  if (active.length <= 1) {
    return {
      ...state,
      phase: 'finished',
      loser: active[0]?.id ?? null,
      endReason: 'normal',
    };
  }
  return state;
}

function advanceIfCurrentOut(state: ShitheadGameState): ShitheadGameState {
  const cur = state.players[state.currentPlayerIdx];
  if (!cur || !cur.isOut) return state;
  const next = nextActivePlayerIndex(state.players, state.currentPlayerIdx);
  if (next === -1) return state;
  return { ...state, currentPlayerIdx: next };
}

// Server-exposed: sweeps the pile into the current actor's hand and
// advances the turn — same behavior as a manual shi.takePile, but the
// caller invokes it directly after a 3-second notice broadcast so the
// other players see WHY the pile moved. Returns the state unchanged if
// the current actor still has a legal move or the pile is empty.
export function applyAutoTakeIfNeeded(
  state: ShitheadGameState,
): ShitheadGameState {
  if (state.phase !== 'playing') return state;
  if (state.pendingJokerChooserId !== null) return state;
  if (state.pile.length === 0) return state;
  const cur = state.players[state.currentPlayerIdx];
  if (!cur || cur.isOut) return state;
  if (canPlayerPlay(state, state.currentPlayerIdx)) return state;

  const newHand = cur.hand.concat(state.pile);
  const newPlayers = state.players.map((p, i) =>
    i === state.currentPlayerIdx ? { ...p, hand: newHand } : p,
  );
  const nextIdx = nextActivePlayerIndex(newPlayers, state.currentPlayerIdx);
  return {
    ...state,
    pile: [],
    players: newPlayers,
    currentPlayerIdx: nextIdx === -1 ? state.currentPlayerIdx : nextIdx,
    quickChainEligible: null,
  };
}

// Does this player have ANY legal move right now? Used by auto-take.
// Hand phase if hand is non-empty; otherwise faceUp once the deck is
// drained; finally faceDown (blind, so always legal). Exported so the
// server can decide whether to schedule an auto-take notice.
export function canPlayerPlay(
  state: ShitheadGameState,
  playerIdx: number,
): boolean {
  if (state.pile.length === 0) return true;
  const p = state.players[playerIdx]!;
  if (p.hand.length > 0) {
    return p.hand.some((c) => canPlay(c, state.pile));
  }
  if (state.deck.length > 0) return true;
  if (p.faceUp.length > 0) {
    return p.faceUp.some((c) => canPlay(c, state.pile));
  }
  if (p.faceDown.length > 0) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickThreeIndexes(handSize: number): number[] {
  // Choose 3 distinct indexes from [0, handSize). Picks the first three —
  // good enough for the forced-faceUp penalty case since the hand itself
  // is already from a shuffled deck.
  return [0, 1, 2].filter((i) => i < handSize);
}

function ok(state: ShitheadGameState): EngineResult<ShitheadGameState> {
  return { ok: true, state };
}
function fail(error: string): EngineResult<ShitheadGameState> {
  return { ok: false, error };
}

// drawFromTop comes from the shared deck helpers. Re-exported so this
// file's reader doesn't have to chase the import to see what the engine
// uses for hand replenishment in subsequent sub-stages.
export { drawFromTop };
