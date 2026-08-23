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
import { drawFromTop, shuffle } from '../../deck';
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
  options: {
    shitheadId?: string | null;
    // Previous game's finishing order. If provided, seating is
    // reordered to [winner, 2nd out, ..., shithead] and currentPlayerIdx=0
    // puts the winner first — takes precedence over randomizeSeats.
    previousOutOrder?: readonly string[] | null;
    // Only checked when previousOutOrder is empty. True → shuffle seats
    // (server passes this on the FIRST game so the starter is random).
    // Defaulting to false keeps the tests deterministic without every
    // call site having to pass an rng.
    randomizeSeats?: boolean;
    // Deterministic hook for tests + the random-seat path in production.
    // Production leaves it undefined (falls through to Math.random).
    rng?: () => number;
  } = {},
): ShitheadGameState {
  const orderedSpecs = orderPlayerSpecs(
    playerSpecs,
    options.previousOutOrder ?? null,
    options.shitheadId ?? null,
    options.randomizeSeats ?? false,
    options.rng,
  );
  const players: ShitheadPlayer[] = orderedSpecs.map((p) => ({
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
    // Index 0 is the previous winner (or a random pick on the first
    // game), so the current player starts as the round's first actor.
    currentPlayerIdx: 0,
    pendingJokerChooserId: null,
    quickChainEligible: null,
    eightChain: null,
    outOrder: [],
    loser: null,
    endReason: null,
  };
}

// Seat players so the turn sequence follows the previous game's
// finishing order:
//   - previousOutOrder = [winner, 2nd, 3rd, ...] → seat them in that
//     sequence at the head of the array, then append the shithead
//     (loserId) at the end.
//   - No previousOutOrder but randomizeSeats=true → shuffle (server
//     uses this on the very first game so the starter is random).
//   - Otherwise keep the incoming specs order (tests + any caller that
//     needs deterministic seating).
// Any player present in `specs` but not referenced by outOrder/loser
// is appended at the end (defensive — shouldn't happen in practice).
function orderPlayerSpecs(
  specs: readonly { id: string; nickname: string }[],
  previousOutOrder: readonly string[] | null,
  loserId: string | null,
  randomizeSeats: boolean,
  rng?: () => number,
): readonly { id: string; nickname: string }[] {
  if (!previousOutOrder || previousOutOrder.length === 0) {
    return randomizeSeats ? shuffle(specs.slice(), rng) : specs.slice();
  }
  const remaining = new Map(specs.map((s) => [s.id, s]));
  const ordered: { id: string; nickname: string }[] = [];
  for (const id of previousOutOrder) {
    const s = remaining.get(id);
    if (s) {
      ordered.push(s);
      remaining.delete(id);
    }
  }
  if (loserId !== null) {
    const loser = remaining.get(loserId);
    if (loser) {
      ordered.push(loser);
      remaining.delete(loserId);
    }
  }
  for (const s of remaining.values()) {
    ordered.push(s);
  }
  return ordered;
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
//   - 8 skip           from the actor's running 8 streak: parity at 2-3
//                      players, one skipped seat per 8 at 4+ — see below
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
      eightChain: null,
    };
  }

  const samePlayerReplays = isTen || isFourBurn;

  // Running total of 8s this actor has laid down without anyone else
  // acting in between — their own play plus any quick-chained follow-ups.
  // Whichever rule applies below reads this ACCUMULATED total, so playing
  // 2-then-1 resolves exactly like playing all three at once. A burn
  // (10 / four-in-a-row) overrides the skip entirely, so the streak only
  // builds on non-burning 8 plays.
  const isEight = args.rank === '8';
  const prevChain = args.state.eightChain;
  const eightStreak =
    isEight && !samePlayerReplays
      ? (prevChain?.playerId === args.playerId ? prevChain.count : 0) +
        args.playedCount
      : 0;

  // When the actor keeps the turn (10 burn / 4-burn), they continue as
  // current player. For normal advance, walk active seats forward from
  // the actor's position — this lets quick-chain plays (where the actor
  // is NOT state.currentPlayerIdx) advance naturally.
  let nextIdx = args.playerIdx;
  if (!samePlayerReplays) {
    let steps = 1;
    if (isEight) {
      const activeCount = args.newPlayers.filter((p) => !p.isOut).length;
      if (activeCount <= 3) {
        // Small tables resolve 8s by PARITY. The seats wrap so quickly
        // that a literal "one skipped seat per 8" overshoots: with 3
        // players a third 8 would land on the next player instead of
        // behaving like a lone 8, and with 2 players an even count would
        // hand the turn to the opponent. Two 8s cancel out and bring the
        // turn back; an odd count skips exactly one seat.
        steps = eightStreak % 2 === 0 ? 0 : 2;
      } else {
        // 4+ players skip literally, one seat per 8. The deck holds only
        // four 8s, so the count can never wrap a full cycle — a fourth 8
        // burns as four-of-a-kind before any skip applies.
        steps = eightStreak + 1;
      }
    }
    let cur = args.playerIdx;
    for (let s = 0; s < steps; s++) {
      const next = nextActivePlayerIndex(args.newPlayers, cur);
      if (next === -1) break;
      cur = next;
    }
    nextIdx = cur;
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
    eightChain: isEight && !samePlayerReplays
      ? { playerId: args.playerId, count: eightStreak }
      : null,
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

  // Failure: actor swallows pile + the revealed card. Same "4s never
  // go to a hand" rule applies — any 4s in the combined take-pile (the
  // existing pile plus the revealed card) stay on the table as the new
  // pile, the rest joins the hand. Remaining faceDown stays as-is.
  // Turn advances normally — taking the pile means the next player
  // after the taker plays (matches plan rule 5).
  const taken = state.pile.concat([revealed]);
  const fours = taken.filter((c) => c.rank === '4');
  const others = taken.filter((c) => c.rank !== '4');
  const newHand = player.hand.concat(others);
  const newPlayers = state.players.map((p, k) =>
    k === playerIdx ? { ...p, hand: newHand, faceDown: newFaceDown } : p,
  );
  const nextIdx = nextActivePlayerIndex(newPlayers, playerIdx);
  return ok({
    ...state,
    pile: fours,
    players: newPlayers,
    currentPlayerIdx: nextIdx === -1 ? state.currentPlayerIdx : nextIdx,
    quickChainEligible: null,
    eightChain: null,
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

  const playerIdx = state.players.findIndex((p) => p.id === action.playerId);
  if (playerIdx === -1) return fail('player not in game');
  const player = state.players[playerIdx]!;
  if (player.isOut) return fail('player is out');

  const cards = action.cards;
  if (cards.length === 0) return fail('must burst at least one card');
  const rank = cards[0]!.rank;
  for (const c of cards) {
    if (c.rank !== rank) return fail('burst cards must all share a rank');
  }

  // Two flavors of burst are accepted out of turn:
  //
  //   (a) Classic 4-burst: the cards are all 4s AND the pile is empty
  //       or holds nothing but 4s (an open burst chain). May or may
  //       not trigger a burn — even a single 4 on an empty pile is a
  //       valid out-of-turn interruption.
  //
  //   (b) Burn-burst: the cards' rank lines up with the run already at
  //       the top of the pile, and after placing them the top 4 cards
  //       share that rank — completing a four-in-a-row and burning
  //       the pile. Works for ANY rank, not just 4s. Example: 1×6 on
  //       the pile + 3×6 in hand → place 3, top 4 are 6s → burn.
  //
  // pileHasFourInARow does the literal-rank scan so it captures every
  // shape (4-of-a-kind from hand, partial run completion, all-on-pile
  // already, etc.).
  const candidatePile = state.pile.concat(cards);
  const wouldBurn = pileHasFourInARow(candidatePile);
  const isClassicFourBurst =
    rank === '4' &&
    (state.pile.length === 0 || state.pile.every((c) => c.rank === '4'));
  if (!wouldBurn && !isClassicFourBurst) {
    return fail(
      'burst must be 4s on an empty/all-4s pile or complete a four-in-a-row',
    );
  }

  // Source can be hand or faceUp. faceUp burst is only allowed when the
  // burster is already in faceUp phase (no hand cards, no deck) — same
  // gate as a regular faceUp play.
  let newHand = player.hand.slice();
  let newFaceUp = player.faceUp.slice();
  const newDeck = state.deck.slice();
  let chainEligibleAfter = false;
  if (action.source === 'hand') {
    for (const c of cards) {
      const i = newHand.findIndex(
        (h) => h.rank === c.rank && h.suit === c.suit,
      );
      if (i === -1) return fail('card not in hand');
      newHand.splice(i, 1);
    }
    // Track refill so we can re-arm the quick-chain when the deck hands
    // the burster another card of the same rank — same race window as
    // a regular play.
    const handLenBeforeRefill = newHand.length;
    while (newHand.length < POST_SETUP_HAND_TARGET && newDeck.length > 0) {
      newHand.push(newDeck.pop()!);
    }
    for (let i = handLenBeforeRefill; i < newHand.length; i++) {
      if (newHand[i]!.rank === rank) {
        chainEligibleAfter = true;
        break;
      }
    }
    // Also cover the "I just emptied hand AND deck, but my faceUp still
    // holds another matching card" transition.
    if (
      !chainEligibleAfter &&
      newHand.length === 0 &&
      newDeck.length === 0 &&
      newFaceUp.some((c) => c.rank === rank)
    ) {
      chainEligibleAfter = true;
    }
  } else if (action.source === 'handAndFaceUp') {
    // Combined burn: a player holding e.g. two 5s in hand and two 5s
    // face-up spends all four in ONE move instead of playing the hand pair
    // now and waiting a whole round for the face-up pair. Three conditions
    // gate it, and all three matter:
    //   1. the draw deck is empty (face-up cards are otherwise untouchable)
    //   2. the move actually burns
    //   3. it consumes the ENTIRE hand
    // Without (3) a player holding 6,6,7 plus two face-up 6s could burn the
    // 6s while still sitting on the 7 — reaching into their face-up cards
    // with a live hand, which the normal turn rules forbid. They have to
    // play the 7 first.
    if (state.deck.length > 0) {
      return fail('cannot combine hand and faceUp while deck is not empty');
    }
    if (!wouldBurn) {
      return fail('combined hand+faceUp burst must complete a four-in-a-row');
    }
    // Every rank+suit is unique in the 54-card deck, so each named card
    // lives in exactly one of the two piles — the hand lookup first is
    // just ordering, not a preference.
    for (const c of cards) {
      const hi = newHand.findIndex(
        (h) => h.rank === c.rank && h.suit === c.suit,
      );
      if (hi !== -1) {
        newHand.splice(hi, 1);
        continue;
      }
      const fi = newFaceUp.findIndex(
        (h) => h.rank === c.rank && h.suit === c.suit,
      );
      if (fi === -1) return fail('card not in hand or faceUp');
      newFaceUp.splice(fi, 1);
    }
    if (newHand.length > 0) {
      return fail('combined burn must use every card left in your hand');
    }
    // No refill (the deck is empty by the gate above) and a burn keeps the
    // turn with the burster anyway, so the quick chain never applies here.
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
    // FaceUp burst doesn't refill, but if another matching card is
    // still on the faceUp pile the chain stays open.
    if (newFaceUp.some((c) => c.rank === rank)) {
      chainEligibleAfter = true;
    }
  }

  const newPlayers = state.players.map((p, i) =>
    i === playerIdx ? { ...p, hand: newHand, faceUp: newFaceUp } : p,
  );

  // Apply the burst. The candidate pile is what wouldBurn was checked
  // against above — if it burns, sweep everything to burnedPile and the
  // burster keeps the turn; otherwise the pile stays put and the turn
  // passes to the player AFTER the burster (out-of-turn nature of the
  // burst).
  let newPile: Card[] = candidatePile;
  let newBurned = state.burnedPile;
  const burned = wouldBurn;
  if (burned) {
    newBurned = newBurned.concat(newPile);
    newPile = [];
  }

  let nextIdx: number;
  if (burned) {
    nextIdx = playerIdx;
  } else {
    const candidate = nextActivePlayerIndex(newPlayers, playerIdx);
    nextIdx = candidate === -1 ? state.currentPlayerIdx : candidate;
  }

  // Re-arm the chain only when the burst did NOT burn (burned bursts
  // already keep the turn with the burster, no chain needed) and the
  // turn actually left the actor's seat.
  const reArmChain = chainEligibleAfter && !burned && nextIdx !== playerIdx;
  const newQuickChain = reArmChain
    ? { playerId: action.playerId, rank }
    : null;

  return ok({
    ...state,
    pile: newPile,
    burnedPile: newBurned,
    deck: newDeck,
    players: newPlayers,
    currentPlayerIdx: nextIdx,
    quickChainEligible: newQuickChain,
    eightChain: null,
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

  // Three buckets:
  //   - Joker(s) burn (consumed by their own effect).
  //   - 4s stay on the table — the "4s never go to a hand" rule applies
  //     to the joker victim too: think of them grabbing the pile and
  //     bursting any 4s straight back onto a fresh pile.
  //   - Everything else goes into the victim's hand.
  const jokers = state.pile.filter((c) => c.rank === 'JOKER');
  const fours = state.pile.filter((c) => c.rank === '4');
  const others = state.pile.filter(
    (c) => c.rank !== 'JOKER' && c.rank !== '4',
  );

  const newPlayers = state.players.map((p, i) =>
    i === victimIdx ? { ...p, hand: p.hand.concat(others) } : p,
  );

  const nextIdx = nextActivePlayerIndex(newPlayers, victimIdx);

  return ok({
    ...state,
    pile: fours,
    burnedPile: state.burnedPile.concat(jokers),
    players: newPlayers,
    currentPlayerIdx: nextIdx === -1 ? state.currentPlayerIdx : nextIdx,
    pendingJokerChooserId: null,
    quickChainEligible: null,
    eightChain: null,
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

  // The "4s never go to a hand" rule: any 4s in the pile stay on the
  // table as the new pile (think of the taker grabbing everything and
  // immediately bursting all 4s back onto an empty pile). Only the
  // non-4 cards land in the taker's hand.
  const fours = state.pile.filter((c) => c.rank === '4');
  const others = state.pile.filter((c) => c.rank !== '4');
  const newHand = player.hand.concat(others);
  const newPlayers = state.players.map((p, i) =>
    i === playerIdx ? { ...p, hand: newHand } : p,
  );
  const nextIdx = nextActivePlayerIndex(newPlayers, playerIdx);
  return ok({
    ...state,
    pile: fours,
    players: newPlayers,
    currentPlayerIdx: nextIdx === -1 ? state.currentPlayerIdx : nextIdx,
    quickChainEligible: null,
    eightChain: null,
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

  // Same "4s never go to a hand" rule as the manual takePile path.
  const fours = state.pile.filter((c) => c.rank === '4');
  const others = state.pile.filter((c) => c.rank !== '4');
  const newHand = cur.hand.concat(others);
  const newPlayers = state.players.map((p, i) =>
    i === state.currentPlayerIdx ? { ...p, hand: newHand } : p,
  );
  const nextIdx = nextActivePlayerIndex(newPlayers, state.currentPlayerIdx);
  return {
    ...state,
    pile: fours,
    players: newPlayers,
    currentPlayerIdx: nextIdx === -1 ? state.currentPlayerIdx : nextIdx,
    quickChainEligible: null,
    eightChain: null,
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
