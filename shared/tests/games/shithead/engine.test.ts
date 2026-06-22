// Shithead engine tests. Each `describe` block targets one rule cluster so
// failures point at a specific piece of behaviour. Helpers live at the top.

import { describe, it, expect } from 'vitest';
import {
  applyAction,
  applyAutoTakeIfNeeded,
  canPlayerPlay,
  createGame,
  startGame,
} from '../../../src/games/shithead/engine';
import type {
  ShitheadAction,
  ShitheadGameState,
} from '../../../src/games/shithead/types';
import type { Card, Suit } from '../../../src/types';
import type { EngineResult } from '../../../src/games/common';

// ----- helpers -----------------------------------------------------------

function unwrap(r: EngineResult<ShitheadGameState>): ShitheadGameState {
  if (!r.ok) throw new Error(`expected success, got error: ${r.error}`);
  return r.state;
}

const card = (rank: Card['rank'], suit: Suit = 'spades'): Card => ({
  rank,
  suit,
});

// A deterministic 54-card deck where the END of the array is the top
// (matching the pop()-based draw convention). Used by setup tests so
// we can predict exactly who gets which card.
function deterministicDeck(): Card[] {
  const ranks = [
    '2','3','4','5','6','7','8','9','10','J','Q','K','A',
  ] as const;
  const suits: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
  const out: Card[] = [];
  for (const r of ranks) {
    for (const s of suits) out.push({ suit: s, rank: r });
  }
  // 2 jokers — represented as rank='JOKER' with suit hearts (red) / spades (black).
  out.push({ suit: 'hearts', rank: 'JOKER' });
  out.push({ suit: 'spades', rank: 'JOKER' });
  return out;
}

// ----- createGame / startGame -------------------------------------------

describe('Shithead: setup', () => {
  it('createGame produces an empty setup state with one player per spec', () => {
    const state = createGame([
      { id: 'a', nickname: 'Alice' },
      { id: 'b', nickname: 'Bob' },
      { id: 'c', nickname: 'Carol' },
    ]);
    expect(state.phase).toBe('setup');
    expect(state.players).toHaveLength(3);
    expect(state.players.every((p) => p.hand.length === 0)).toBe(true);
    expect(state.players.every((p) => p.faceUp.length === 0)).toBe(true);
    expect(state.players.every((p) => p.faceDown.length === 0)).toBe(true);
    expect(state.players.every((p) => p.setupConfirmed === false)).toBe(true);
    expect(state.players.every((p) => p.forcedFaceUp === false)).toBe(true);
    expect(state.deck).toHaveLength(0);
    expect(state.pile).toHaveLength(0);
  });

  it('forcedFaceUp marks the previous shithead', () => {
    const state = createGame(
      [
        { id: 'a', nickname: 'Alice' },
        { id: 'b', nickname: 'Bob' },
      ],
      { shitheadId: 'b' },
    );
    expect(state.players[0]!.forcedFaceUp).toBe(false);
    expect(state.players[1]!.forcedFaceUp).toBe(true);
  });

  it('startGame deals 3 face-down + 6 hand per player, leaves remainder as deck', () => {
    const initial = createGame([
      { id: 'a', nickname: 'A' },
      { id: 'b', nickname: 'B' },
      { id: 'c', nickname: 'C' },
    ]);
    const deck = deterministicDeck(); // 54
    const state = unwrap(startGame(initial, deck));
    expect(state.phase).toBe('setup');
    for (const p of state.players) {
      expect(p.faceDown).toHaveLength(3);
      expect(p.hand).toHaveLength(6);
      expect(p.faceUp).toHaveLength(0);
    }
    // 3 players × 9 = 27 dealt, 54 - 27 = 27 left in deck.
    expect(state.deck).toHaveLength(54 - 3 * 9);
  });

  it('startGame fills the previous shithead\'s faceUp at random + auto-confirms', () => {
    const initial = createGame(
      [
        { id: 'a', nickname: 'A' },
        { id: 'b', nickname: 'B' },
      ],
      { shitheadId: 'b' },
    );
    const state = unwrap(startGame(initial, deterministicDeck()));
    const bob = state.players[1]!;
    expect(bob.setupConfirmed).toBe(true);
    expect(bob.faceUp).toHaveLength(3);
    expect(bob.hand).toHaveLength(3); // 6 dealt − 3 chosen automatically
    expect(state.players[0]!.setupConfirmed).toBe(false);
  });

  it('startGame fails when deck is too small for the player count', () => {
    const initial = createGame([
      { id: 'a', nickname: 'A' },
      { id: 'b', nickname: 'B' },
    ]);
    const r = startGame(initial, deterministicDeck().slice(0, 10));
    expect(r.ok).toBe(false);
  });
});

// ----- shi.setup.confirm ------------------------------------------------

describe('Shithead: shi.setup.confirm', () => {
  it('moves the chosen 3 hand cards to faceUp; phase stays setup until everyone confirms', () => {
    const initial = createGame([
      { id: 'a', nickname: 'A' },
      { id: 'b', nickname: 'B' },
    ]);
    const after = unwrap(startGame(initial, deterministicDeck()));
    const aHand = after.players[0]!.hand;
    const action: ShitheadAction = {
      type: 'shi.setup.confirm',
      playerId: 'a',
      faceUpIndexes: [0, 1, 2],
    };
    const result = unwrap(applyAction(after, action));
    const a = result.players[0]!;
    expect(a.setupConfirmed).toBe(true);
    expect(a.hand).toHaveLength(3);
    expect(a.faceUp).toEqual([aHand[0], aHand[1], aHand[2]]);
    // Bob hasn't confirmed yet → still setup phase.
    expect(result.phase).toBe('setup');
  });

  it('moves to playing once every non-forced player has confirmed', () => {
    const initial = createGame([
      { id: 'a', nickname: 'A' },
      { id: 'b', nickname: 'B' },
    ]);
    const after = unwrap(startGame(initial, deterministicDeck()));
    let state = unwrap(
      applyAction(after, {
        type: 'shi.setup.confirm',
        playerId: 'a',
        faceUpIndexes: [0, 1, 2],
      }),
    );
    expect(state.phase).toBe('setup');
    state = unwrap(
      applyAction(state, {
        type: 'shi.setup.confirm',
        playerId: 'b',
        faceUpIndexes: [3, 4, 5],
      }),
    );
    expect(state.phase).toBe('playing');
  });

  it('the forced-faceUp player is already counted as confirmed at startGame', () => {
    const initial = createGame(
      [
        { id: 'a', nickname: 'A' },
        { id: 'b', nickname: 'B' },
      ],
      { shitheadId: 'b' },
    );
    let state = unwrap(startGame(initial, deterministicDeck()));
    state = unwrap(
      applyAction(state, {
        type: 'shi.setup.confirm',
        playerId: 'a',
        faceUpIndexes: [0, 1, 2],
      }),
    );
    expect(state.phase).toBe('playing');
  });

  it('rejects duplicate or out-of-range indexes', () => {
    const initial = createGame([
      { id: 'a', nickname: 'A' },
      { id: 'b', nickname: 'B' },
    ]);
    const after = unwrap(startGame(initial, deterministicDeck()));
    expect(
      applyAction(after, {
        type: 'shi.setup.confirm',
        playerId: 'a',
        faceUpIndexes: [0, 0, 1],
      }).ok,
    ).toBe(false);
    expect(
      applyAction(after, {
        type: 'shi.setup.confirm',
        playerId: 'a',
        faceUpIndexes: [10, 11, 12],
      }).ok,
    ).toBe(false);
  });

  it('rejects a second confirm from the same player', () => {
    const initial = createGame([
      { id: 'a', nickname: 'A' },
      { id: 'b', nickname: 'B' },
    ]);
    let state = unwrap(startGame(initial, deterministicDeck()));
    state = unwrap(
      applyAction(state, {
        type: 'shi.setup.confirm',
        playerId: 'a',
        faceUpIndexes: [0, 1, 2],
      }),
    );
    expect(
      applyAction(state, {
        type: 'shi.setup.confirm',
        playerId: 'a',
        faceUpIndexes: [0, 1, 2],
      }).ok,
    ).toBe(false);
  });

  it('rejects confirm from the forced-faceUp player', () => {
    const initial = createGame(
      [
        { id: 'a', nickname: 'A' },
        { id: 'b', nickname: 'B' },
      ],
      { shitheadId: 'b' },
    );
    const after = unwrap(startGame(initial, deterministicDeck()));
    expect(
      applyAction(after, {
        type: 'shi.setup.confirm',
        playerId: 'b',
        faceUpIndexes: [0, 1, 2],
      }).ok,
    ).toBe(false);
  });
});

// Builds a 'playing'-phase state directly, bypassing the setup flow. Used by
// the regular-play tests below so each test reads as the specific scenario
// it's exercising (hand contents, pile top, deck remainder) without going
// through createGame + startGame + 2× shi.setup.confirm boilerplate.
function makePlayingState(args: {
  hands: Card[][];
  pile?: Card[];
  deck?: Card[];
  faceUp?: Card[][];
  faceDown?: Card[][];
  currentPlayerIdx?: number;
}): ShitheadGameState {
  // Default every player to one face-down placeholder so they don't go OUT
  // unintentionally when a test happens to empty their hand. Tests that
  // need a specifically empty faceDown pass it explicitly.
  const players = args.hands.map((hand, i) => ({
    id: String.fromCharCode(97 + i),
    nickname: String.fromCharCode(65 + i),
    hand: hand.slice(),
    faceUp: args.faceUp?.[i]?.slice() ?? [],
    faceDown:
      args.faceDown?.[i]?.slice() ?? [{ rank: 'A' as const, suit: 'spades' as const }],
    isOut: false,
    setupConfirmed: true,
    forcedFaceUp: false,
  }));
  return {
    phase: 'playing',
    players,
    deck: args.deck?.slice() ?? [],
    pile: args.pile?.slice() ?? [],
    burnedPile: [],
    currentPlayerIdx: args.currentPlayerIdx ?? 0,
    pendingJokerChooserId: null,
    outOrder: [],
    loser: null,
    endReason: null,
  };
}

// ----- shi.play: regular plays + magic 2/3/7/8/10 -----------------------

describe('Shithead: shi.play — regular plays', () => {
  it('plays a card matching pile top and advances to next player', () => {
    const state = makePlayingState({
      hands: [[card('9', 'spades')], [card('K', 'clubs')]],
      pile: [card('5', 'hearts')],
    });
    const r = unwrap(
      applyAction(state, {
        type: 'shi.play',
        playerId: 'a',
        source: 'hand',
        cards: [card('9', 'spades')],
      }),
    );
    expect(r.pile[r.pile.length - 1]).toEqual(card('9', 'spades'));
    expect(r.players[0]!.hand).toHaveLength(0);
    expect(r.currentPlayerIdx).toBe(1);
  });

  it('rejects a card lower than the pile top', () => {
    const state = makePlayingState({
      hands: [[card('5', 'spades')], [card('K', 'clubs')]],
      pile: [card('J', 'hearts')],
    });
    const r = applyAction(state, {
      type: 'shi.play',
      playerId: 'a',
      source: 'hand',
      cards: [card('5', 'spades')],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a play from the wrong player', () => {
    const state = makePlayingState({
      hands: [[card('9', 'spades')], [card('K', 'clubs')]],
      pile: [card('5', 'hearts')],
    });
    const r = applyAction(state, {
      type: 'shi.play',
      playerId: 'b',
      source: 'hand',
      cards: [card('K', 'clubs')],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a card the player does not own', () => {
    const state = makePlayingState({
      hands: [[card('9', 'spades')], [card('K', 'clubs')]],
      pile: [card('5', 'hearts')],
    });
    const r = applyAction(state, {
      type: 'shi.play',
      playerId: 'a',
      source: 'hand',
      cards: [card('K', 'spades')],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects multi-card play of mixed ranks', () => {
    const state = makePlayingState({
      hands: [[card('9', 'spades'), card('K', 'diamonds')], []],
      pile: [card('5', 'hearts')],
    });
    const r = applyAction(state, {
      type: 'shi.play',
      playerId: 'a',
      source: 'hand',
      cards: [card('9', 'spades'), card('K', 'diamonds')],
    });
    expect(r.ok).toBe(false);
  });

  it('refills hand from the deck up to 3 after a play', () => {
    const state = makePlayingState({
      hands: [[card('9', 'spades')], []],
      pile: [card('5', 'hearts')],
      deck: [card('A', 'spades'), card('K', 'spades'), card('Q', 'spades')],
    });
    const r = unwrap(
      applyAction(state, {
        type: 'shi.play',
        playerId: 'a',
        source: 'hand',
        cards: [card('9', 'spades')],
      }),
    );
    // Pops from the END → Q, K, A in order.
    expect(r.players[0]!.hand).toHaveLength(3);
    expect(r.players[0]!.hand).toEqual([
      card('Q', 'spades'),
      card('K', 'spades'),
      card('A', 'spades'),
    ]);
    expect(r.deck).toHaveLength(0);
  });

  it('does not refill past 3 even when many deck cards remain', () => {
    const deck = Array.from({ length: 10 }, () => card('6', 'spades'));
    const state = makePlayingState({
      hands: [[card('9', 'spades'), card('Q', 'diamonds')], []],
      pile: [card('5', 'hearts')],
      deck,
    });
    // We play only the 9; the QD stays in hand. Post-play hand = [QD] (1),
    // refill draws 2 more to reach 3, leaving 8 in the deck.
    const r = unwrap(
      applyAction(state, {
        type: 'shi.play',
        playerId: 'a',
        source: 'hand',
        cards: [card('9', 'spades')],
      }),
    );
    expect(r.players[0]!.hand).toHaveLength(3);
    expect(r.deck).toHaveLength(8);
  });
});

describe('Shithead: shi.play — magic cards', () => {
  it('2 resets the constraint: next player can play anything', () => {
    const state = makePlayingState({
      hands: [[card('2', 'spades')], [card('4', 'clubs')]],
      pile: [card('K', 'hearts')],
    });
    const after2 = unwrap(
      applyAction(state, {
        type: 'shi.play',
        playerId: 'a',
        source: 'hand',
        cards: [card('2', 'spades')],
      }),
    );
    // Pile top is now 2 → constraint is 'none'. Bob plays his 4 legally.
    const afterFour = unwrap(
      applyAction(after2, {
        type: 'shi.play',
        playerId: 'b',
        source: 'hand',
        cards: [card('4', 'clubs')],
      }),
    );
    expect(afterFour.pile[afterFour.pile.length - 1]).toEqual(
      card('4', 'clubs'),
    );
  });

  it('3 mirrors the card beneath: next must beat what is under the 3', () => {
    const state = makePlayingState({
      hands: [[card('3', 'spades')], [card('6', 'clubs'), card('K', 'clubs')]],
      // Under-3 card is a J.
      pile: [card('J', 'hearts')],
    });
    const after3 = unwrap(
      applyAction(state, {
        type: 'shi.play',
        playerId: 'a',
        source: 'hand',
        cards: [card('3', 'spades')],
      }),
    );
    // Bob's 6 is < J → illegal.
    const sixR = applyAction(after3, {
      type: 'shi.play',
      playerId: 'b',
      source: 'hand',
      cards: [card('6', 'clubs')],
    });
    expect(sixR.ok).toBe(false);
    // Bob's K ≥ J → legal.
    const kR = unwrap(
      applyAction(after3, {
        type: 'shi.play',
        playerId: 'b',
        source: 'hand',
        cards: [card('K', 'clubs')],
      }),
    );
    expect(kR.pile[kR.pile.length - 1]).toEqual(card('K', 'clubs'));
  });

  it('7 inverts: next player must play ≤ 7 (or a magic card)', () => {
    const state = makePlayingState({
      hands: [
        [card('7', 'spades')],
        [card('K', 'clubs'), card('5', 'clubs')],
      ],
      pile: [card('6', 'hearts')],
    });
    const after7 = unwrap(
      applyAction(state, {
        type: 'shi.play',
        playerId: 'a',
        source: 'hand',
        cards: [card('7', 'spades')],
      }),
    );
    const kR = applyAction(after7, {
      type: 'shi.play',
      playerId: 'b',
      source: 'hand',
      cards: [card('K', 'clubs')],
    });
    expect(kR.ok).toBe(false);
    const fiveR = unwrap(
      applyAction(after7, {
        type: 'shi.play',
        playerId: 'b',
        source: 'hand',
        cards: [card('5', 'clubs')],
      }),
    );
    expect(fiveR.pile[fiveR.pile.length - 1]).toEqual(card('5', 'clubs'));
  });

  it('10 burns the pile and the same player plays again', () => {
    const state = makePlayingState({
      hands: [
        [card('10', 'spades'), card('9', 'spades')],
        [card('K', 'clubs')],
      ],
      pile: [card('5', 'hearts'), card('7', 'diamonds')],
    });
    const r = unwrap(
      applyAction(state, {
        type: 'shi.play',
        playerId: 'a',
        source: 'hand',
        cards: [card('10', 'spades')],
      }),
    );
    expect(r.pile).toHaveLength(0);
    expect(r.burnedPile).toHaveLength(3); // 5H + 7D + 10S
    expect(r.currentPlayerIdx).toBe(0); // same player
    expect(r.players[0]!.hand).toEqual([card('9', 'spades')]);
  });

  it('8 skips one player', () => {
    // 3 players. A plays a single 8. Next turn should skip B → C.
    const state = makePlayingState({
      hands: [[card('8', 'spades')], [], []],
      pile: [card('5', 'hearts')],
    });
    const r = unwrap(
      applyAction(state, {
        type: 'shi.play',
        playerId: 'a',
        source: 'hand',
        cards: [card('8', 'spades')],
      }),
    );
    expect(r.currentPlayerIdx).toBe(2);
  });

  it('in a 2-player game any number of 8s keeps the turn with the actor', () => {
    // 1× 8 in 2 players
    const oneEight = makePlayingState({
      hands: [[card('8', 'spades')], [card('K', 'clubs')]],
      pile: [card('5', 'hearts')],
    });
    const r1 = unwrap(
      applyAction(oneEight, {
        type: 'shi.play',
        playerId: 'a',
        source: 'hand',
        cards: [card('8', 'spades')],
      }),
    );
    expect(r1.currentPlayerIdx).toBe(0);

    // 2× 8 in 2 players (without the 2-player rule this would land on B)
    const twoEights = makePlayingState({
      hands: [
        [card('8', 'spades'), card('8', 'diamonds')],
        [card('K', 'clubs')],
      ],
      pile: [card('5', 'hearts')],
    });
    const r2 = unwrap(
      applyAction(twoEights, {
        type: 'shi.play',
        playerId: 'a',
        source: 'hand',
        cards: [card('8', 'spades'), card('8', 'diamonds')],
      }),
    );
    expect(r2.currentPlayerIdx).toBe(0);

    // 3× 8 in 2 players
    const threeEights = makePlayingState({
      hands: [
        [card('8', 'spades'), card('8', 'diamonds'), card('8', 'hearts')],
        [card('K', 'clubs')],
      ],
      pile: [card('5', 'hearts')],
    });
    const r3 = unwrap(
      applyAction(threeEights, {
        type: 'shi.play',
        playerId: 'a',
        source: 'hand',
        cards: [
          card('8', 'spades'),
          card('8', 'diamonds'),
          card('8', 'hearts'),
        ],
      }),
    );
    expect(r3.currentPlayerIdx).toBe(0);
  });

  it('2× 8 in 3 players returns the turn to the same player', () => {
    const state = makePlayingState({
      hands: [
        [card('8', 'spades'), card('8', 'diamonds')],
        [],
        [],
      ],
      pile: [card('5', 'hearts')],
    });
    const r = unwrap(
      applyAction(state, {
        type: 'shi.play',
        playerId: 'a',
        source: 'hand',
        cards: [card('8', 'spades'), card('8', 'diamonds')],
      }),
    );
    expect(r.currentPlayerIdx).toBe(0);
  });
});

// ----- Queen blocks magic cards -----------------------------------------

describe('Shithead: Queen blocks magic cards', () => {
  function tryMagic(magic: Card): { ok: boolean } {
    const state = makePlayingState({
      hands: [[magic, card('K', 'diamonds')], []],
      pile: [card('Q', 'hearts')],
    });
    return applyAction(state, {
      type: 'shi.play',
      playerId: 'a',
      source: 'hand',
      cards: [magic],
    });
  }
  it('rejects 2 on top of Q', () => {
    expect(tryMagic(card('2', 'spades')).ok).toBe(false);
  });
  it('rejects 3 on top of Q', () => {
    expect(tryMagic(card('3', 'spades')).ok).toBe(false);
  });
  it('rejects 10 on top of Q', () => {
    expect(tryMagic(card('10', 'spades')).ok).toBe(false);
  });
  it('rejects Joker on top of Q', () => {
    expect(tryMagic(card('JOKER', 'spades')).ok).toBe(false);
  });
  it('still accepts a regular ≥ Q card (K)', () => {
    const state = makePlayingState({
      hands: [[card('K', 'spades')], []],
      pile: [card('Q', 'hearts')],
    });
    const r = applyAction(state, {
      type: 'shi.play',
      playerId: 'a',
      source: 'hand',
      cards: [card('K', 'spades')],
    });
    expect(r.ok).toBe(true);
  });
});

// ----- Joker: play + choose victim --------------------------------------

describe('Shithead: Joker', () => {
  it('playing a Joker sets pendingJokerChooserId and keeps turn with chooser', () => {
    const state = makePlayingState({
      hands: [[card('JOKER', 'spades')], [card('K', 'clubs')], []],
      pile: [card('5', 'hearts')],
    });
    const r = unwrap(
      applyAction(state, {
        type: 'shi.play',
        playerId: 'a',
        source: 'hand',
        cards: [card('JOKER', 'spades')],
      }),
    );
    expect(r.pendingJokerChooserId).toBe('a');
    expect(r.currentPlayerIdx).toBe(0);
    // Joker still sits on the pile until the victim sweeps.
    expect(r.pile[r.pile.length - 1]).toEqual(card('JOKER', 'spades'));
  });

  it('any other action is rejected while joker chooser is pending', () => {
    const state = makePlayingState({
      hands: [[card('JOKER', 'spades')], [card('K', 'clubs')], []],
      pile: [card('5', 'hearts')],
    });
    const after = unwrap(
      applyAction(state, {
        type: 'shi.play',
        playerId: 'a',
        source: 'hand',
        cards: [card('JOKER', 'spades')],
      }),
    );
    const playR = applyAction(after, {
      type: 'shi.play',
      playerId: 'a',
      source: 'hand',
      cards: [],
    });
    expect(playR.ok).toBe(false);
  });

  it('shi.joker.choose hands the non-Joker pile to the victim, burns the Joker(s)', () => {
    const state = makePlayingState({
      hands: [[card('JOKER', 'spades')], [card('K', 'clubs')], []],
      pile: [card('5', 'hearts'), card('7', 'hearts')],
    });
    let s = unwrap(
      applyAction(state, {
        type: 'shi.play',
        playerId: 'a',
        source: 'hand',
        cards: [card('JOKER', 'spades')],
      }),
    );
    s = unwrap(
      applyAction(s, {
        type: 'shi.joker.choose',
        playerId: 'a',
        victimId: 'b',
      }),
    );
    expect(s.pile).toHaveLength(0);
    expect(s.pendingJokerChooserId).toBeNull();
    // Victim received only the non-Joker cards (5H + 7H) — the Joker
    // itself was burned, not given.
    expect(s.players[1]!.hand).toEqual([
      card('K', 'clubs'),
      card('5', 'hearts'),
      card('7', 'hearts'),
    ]);
    expect(s.burnedPile).toEqual([card('JOKER', 'spades')]);
    // Turn went to the player AFTER the victim (b → c).
    expect(s.currentPlayerIdx).toBe(2);
  });

  it('shi.joker.choose rejects choosing yourself', () => {
    const state = makePlayingState({
      hands: [[card('JOKER', 'spades')], [card('K', 'clubs')]],
      pile: [card('5', 'hearts')],
    });
    const after = unwrap(
      applyAction(state, {
        type: 'shi.play',
        playerId: 'a',
        source: 'hand',
        cards: [card('JOKER', 'spades')],
      }),
    );
    const r = applyAction(after, {
      type: 'shi.joker.choose',
      playerId: 'a',
      victimId: 'a',
    });
    expect(r.ok).toBe(false);
  });

  it('shi.joker.choose rejects when no Joker is pending', () => {
    const state = makePlayingState({
      hands: [[card('9', 'spades')], [card('K', 'clubs')]],
      pile: [card('5', 'hearts')],
    });
    const r = applyAction(state, {
      type: 'shi.joker.choose',
      playerId: 'a',
      victimId: 'b',
    });
    expect(r.ok).toBe(false);
  });
});

// ----- 4-of-a-kind + 4-in-a-row burns ----------------------------------

describe('Shithead: four-of-a-kind / four-in-a-row burns', () => {
  it('4-of-a-kind played from hand burns the pile and the actor plays again', () => {
    const state = makePlayingState({
      hands: [
        [
          card('K', 'spades'),
          card('K', 'hearts'),
          card('K', 'diamonds'),
          card('K', 'clubs'),
        ],
        [],
      ],
      pile: [card('9', 'hearts')],
    });
    const r = unwrap(
      applyAction(state, {
        type: 'shi.play',
        playerId: 'a',
        source: 'hand',
        cards: [
          card('K', 'spades'),
          card('K', 'hearts'),
          card('K', 'diamonds'),
          card('K', 'clubs'),
        ],
      }),
    );
    expect(r.pile).toHaveLength(0);
    expect(r.burnedPile.length).toBe(5); // 9H + 4× K
    expect(r.currentPlayerIdx).toBe(0); // same actor
  });

  it('four-in-a-row across separate plays burns the pile too', () => {
    // Pile already has three Ks. Player A adds one more K → 4 in a row.
    const state = makePlayingState({
      hands: [[card('K', 'spades')], []],
      pile: [
        card('K', 'hearts'),
        card('K', 'diamonds'),
        card('K', 'clubs'),
      ],
    });
    const r = unwrap(
      applyAction(state, {
        type: 'shi.play',
        playerId: 'a',
        source: 'hand',
        cards: [card('K', 'spades')],
      }),
    );
    expect(r.pile).toHaveLength(0);
    expect(r.burnedPile.length).toBe(4);
    expect(r.currentPlayerIdx).toBe(0);
  });
});

// ----- shi.burst (out-of-turn 4) ---------------------------------------

describe('Shithead: shi.burst', () => {
  it('any active player can burst with a 4 when the pile is empty', () => {
    // Current player is A; B bursts.
    const state = makePlayingState({
      hands: [[card('K', 'clubs')], [card('4', 'spades')], []],
      pile: [],
      currentPlayerIdx: 0,
    });
    const r = unwrap(
      applyAction(state, {
        type: 'shi.burst',
        playerId: 'b',
        source: 'hand',
        cards: [card('4', 'spades')],
      }),
    );
    expect(r.pile).toEqual([card('4', 'spades')]);
    // Turn moves to the player AFTER the burster (b → c).
    expect(r.currentPlayerIdx).toBe(2);
    expect(r.players[1]!.hand).toHaveLength(0);
  });

  it('rejects bursting when the pile is not empty', () => {
    const state = makePlayingState({
      hands: [[card('K', 'clubs')], [card('4', 'spades')]],
      pile: [card('5', 'hearts')],
    });
    const r = applyAction(state, {
      type: 'shi.burst',
      playerId: 'b',
      source: 'hand',
      cards: [card('4', 'spades')],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a burst card that is not a 4', () => {
    const state = makePlayingState({
      hands: [[card('K', 'clubs')], [card('5', 'spades')]],
      pile: [],
    });
    const r = applyAction(state, {
      type: 'shi.burst',
      playerId: 'b',
      source: 'hand',
      cards: [card('5', 'spades')],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a burst card the player does not own', () => {
    const state = makePlayingState({
      hands: [[card('K', 'clubs')], [card('K', 'spades')]],
      pile: [],
    });
    const r = applyAction(state, {
      type: 'shi.burst',
      playerId: 'b',
      source: 'hand',
      cards: [card('4', 'spades')],
    });
    expect(r.ok).toBe(false);
  });

  it('accepts a faceUp burst when the burster has no hand and no deck', () => {
    const state = makePlayingState({
      hands: [[card('K', 'clubs')], []],
      faceUp: [[], [card('4', 'diamonds')]],
      pile: [],
    });
    const r = unwrap(
      applyAction(state, {
        type: 'shi.burst',
        playerId: 'b',
        source: 'faceUp',
        cards: [card('4', 'diamonds')],
      }),
    );
    expect(r.pile).toEqual([card('4', 'diamonds')]);
    expect(r.players[1]!.faceUp).toHaveLength(0);
  });

  it('rejects a faceUp burst if the burster still has hand cards', () => {
    const state = makePlayingState({
      hands: [[card('K', 'clubs')], [card('5', 'hearts')]],
      faceUp: [[], [card('4', 'diamonds')]],
      pile: [],
    });
    const r = applyAction(state, {
      type: 'shi.burst',
      playerId: 'b',
      source: 'faceUp',
      cards: [card('4', 'diamonds')],
    });
    expect(r.ok).toBe(false);
  });
});

// ----- shi.play source='faceUp' -----------------------------------------

describe('Shithead: shi.play from faceUp', () => {
  it('accepts a faceUp play when hand AND deck are both empty', () => {
    const state = makePlayingState({
      hands: [[], []],
      faceUp: [[card('9', 'spades')], []],
      pile: [card('5', 'hearts')],
    });
    const r = unwrap(
      applyAction(state, {
        type: 'shi.play',
        playerId: 'a',
        source: 'faceUp',
        cards: [card('9', 'spades')],
      }),
    );
    expect(r.pile[r.pile.length - 1]).toEqual(card('9', 'spades'));
    expect(r.players[0]!.faceUp).toHaveLength(0);
    // Turn advances normally.
    expect(r.currentPlayerIdx).toBe(1);
  });

  it('rejects a faceUp play while the actor still has hand cards', () => {
    const state = makePlayingState({
      hands: [[card('K', 'clubs')], []],
      faceUp: [[card('9', 'spades')], []],
      pile: [card('5', 'hearts')],
    });
    const r = applyAction(state, {
      type: 'shi.play',
      playerId: 'a',
      source: 'faceUp',
      cards: [card('9', 'spades')],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a faceUp play while the draw deck is not empty', () => {
    const state = makePlayingState({
      hands: [[], []],
      faceUp: [[card('9', 'spades')], []],
      pile: [card('5', 'hearts')],
      deck: [card('6', 'clubs')],
    });
    const r = applyAction(state, {
      type: 'shi.play',
      playerId: 'a',
      source: 'faceUp',
      cards: [card('9', 'spades')],
    });
    expect(r.ok).toBe(false);
  });

  it('accepts a multi-card faceUp play of the same rank', () => {
    const state = makePlayingState({
      hands: [[], []],
      faceUp: [
        [card('9', 'spades'), card('9', 'diamonds')],
        [],
      ],
      pile: [card('5', 'hearts')],
    });
    const r = unwrap(
      applyAction(state, {
        type: 'shi.play',
        playerId: 'a',
        source: 'faceUp',
        cards: [card('9', 'spades'), card('9', 'diamonds')],
      }),
    );
    expect(r.players[0]!.faceUp).toHaveLength(0);
  });
});

// ----- shi.playFaceDown -------------------------------------------------

describe('Shithead: shi.playFaceDown', () => {
  it('reveals a legal card and lands it on the pile', () => {
    const state = makePlayingState({
      hands: [[], []],
      faceUp: [[], []],
      faceDown: [
        [card('K', 'spades'), card('Q', 'spades'), card('9', 'spades')],
        [],
      ],
      pile: [card('5', 'hearts')],
    });
    const r = unwrap(
      applyAction(state, {
        type: 'shi.playFaceDown',
        playerId: 'a',
        faceDownIndex: 0,
      }),
    );
    expect(r.pile[r.pile.length - 1]).toEqual(card('K', 'spades'));
    expect(r.players[0]!.faceDown).toHaveLength(2);
    expect(r.currentPlayerIdx).toBe(1);
  });

  it('on a failed reveal the player swallows pile + revealed card into hand', () => {
    const state = makePlayingState({
      hands: [[], []],
      faceUp: [[], []],
      faceDown: [
        [card('5', 'spades'), card('Q', 'spades'), card('9', 'spades')],
        [],
      ],
      pile: [card('K', 'hearts'), card('K', 'diamonds')],
    });
    const r = unwrap(
      applyAction(state, {
        type: 'shi.playFaceDown',
        playerId: 'a',
        faceDownIndex: 0,
      }),
    );
    // 5 cannot beat K → take pile + 5 into hand.
    expect(r.pile).toHaveLength(0);
    expect(r.players[0]!.hand).toEqual([
      card('K', 'hearts'),
      card('K', 'diamonds'),
      card('5', 'spades'),
    ]);
    expect(r.players[0]!.faceDown).toHaveLength(2);
    expect(r.currentPlayerIdx).toBe(1);
  });

  it('rejects faceDown play when hand is not empty', () => {
    const state = makePlayingState({
      hands: [[card('Q', 'clubs')], []],
      faceUp: [[], []],
      faceDown: [[card('K', 'spades')], []],
      pile: [],
    });
    const r = applyAction(state, {
      type: 'shi.playFaceDown',
      playerId: 'a',
      faceDownIndex: 0,
    });
    expect(r.ok).toBe(false);
  });

  it('rejects faceDown play when faceUp is not empty', () => {
    const state = makePlayingState({
      hands: [[], []],
      faceUp: [[card('5', 'clubs')], []],
      faceDown: [[card('K', 'spades')], []],
      pile: [],
    });
    const r = applyAction(state, {
      type: 'shi.playFaceDown',
      playerId: 'a',
      faceDownIndex: 0,
    });
    expect(r.ok).toBe(false);
  });

  it('rejects faceDown play when the draw deck is not empty', () => {
    const state = makePlayingState({
      hands: [[], []],
      faceUp: [[], []],
      faceDown: [[card('K', 'spades')], []],
      pile: [],
      deck: [card('6', 'clubs')],
    });
    const r = applyAction(state, {
      type: 'shi.playFaceDown',
      playerId: 'a',
      faceDownIndex: 0,
    });
    expect(r.ok).toBe(false);
  });

  it('rejects an out-of-range faceDown index', () => {
    const state = makePlayingState({
      hands: [[], []],
      faceUp: [[], []],
      faceDown: [[card('K', 'spades')], []],
      pile: [],
    });
    const r = applyAction(state, {
      type: 'shi.playFaceDown',
      playerId: 'a',
      faceDownIndex: 5,
    });
    expect(r.ok).toBe(false);
  });
});

// ----- shi.takePile + auto-take ----------------------------------------

describe('Shithead: take pile (manual + auto)', () => {
  it('shi.takePile sweeps the pile into the actor and passes the turn on', () => {
    const state = makePlayingState({
      hands: [[card('5', 'spades')], [card('K', 'clubs')]],
      pile: [card('Q', 'hearts'), card('K', 'hearts')],
    });
    const r = unwrap(
      applyAction(state, { type: 'shi.takePile', playerId: 'a' }),
    );
    expect(r.pile).toHaveLength(0);
    expect(r.players[0]!.hand).toEqual([
      card('5', 'spades'),
      card('Q', 'hearts'),
      card('K', 'hearts'),
    ]);
    expect(r.currentPlayerIdx).toBe(1);
  });

  it('shi.takePile is rejected when the pile is empty', () => {
    const state = makePlayingState({
      hands: [[card('5', 'spades')], [card('K', 'clubs')]],
      pile: [],
    });
    const r = applyAction(state, { type: 'shi.takePile', playerId: 'a' });
    expect(r.ok).toBe(false);
  });

  it('shi.takePile is rejected when it is not the actor\'s turn', () => {
    const state = makePlayingState({
      hands: [[card('5', 'spades')], [card('K', 'clubs')]],
      pile: [card('Q', 'hearts')],
    });
    const r = applyAction(state, { type: 'shi.takePile', playerId: 'b' });
    expect(r.ok).toBe(false);
  });

  it('applyAutoTakeIfNeeded sweeps the pile to a stuck player and advances the turn', () => {
    // 3 players. A plays K. Pile top becomes K. B has only low cards
    // (5,6) → no legal play. The engine no longer auto-takes inside
    // applyAction (the server now schedules it after a 3s notice) — but
    // the helper still produces the same effect when invoked directly.
    const state = makePlayingState({
      hands: [
        [card('K', 'spades'), card('K', 'diamonds')],
        [card('5', 'clubs'), card('6', 'clubs')],
        [card('A', 'hearts')],
      ],
      pile: [card('9', 'hearts')],
    });
    const afterPlay = unwrap(
      applyAction(state, {
        type: 'shi.play',
        playerId: 'a',
        source: 'hand',
        cards: [card('K', 'spades')],
      }),
    );
    // No auto-take inside applyAction: pile still has the K, B is current.
    expect(afterPlay.currentPlayerIdx).toBe(1);
    expect(afterPlay.pile[afterPlay.pile.length - 1]).toEqual(card('K', 'spades'));
    expect(canPlayerPlay(afterPlay, 1)).toBe(false);

    const afterAuto = applyAutoTakeIfNeeded(afterPlay);
    expect(afterAuto.pile).toHaveLength(0);
    expect(afterAuto.players[1]!.hand).toEqual([
      card('5', 'clubs'),
      card('6', 'clubs'),
      card('9', 'hearts'),
      card('K', 'spades'),
    ]);
    expect(afterAuto.currentPlayerIdx).toBe(2);
  });

  it('does not auto-take when the next player has a legal move', () => {
    const state = makePlayingState({
      hands: [
        [card('K', 'spades'), card('K', 'diamonds')],
        [card('A', 'clubs')],
      ],
      pile: [card('9', 'hearts')],
    });
    const r = unwrap(
      applyAction(state, {
        type: 'shi.play',
        playerId: 'a',
        source: 'hand',
        cards: [card('K', 'spades')],
      }),
    );
    expect(r.pile[r.pile.length - 1]).toEqual(card('K', 'spades'));
    expect(r.currentPlayerIdx).toBe(1);
  });

  it('does not auto-take when the pile is empty (next player can lead freely)', () => {
    // A plays a 10 from hand → burns the pile → A still on turn. Even if
    // A had no other card matching the top, the empty-pile case lets A
    // play anything next.
    const state = makePlayingState({
      hands: [[card('10', 'spades'), card('6', 'spades')], [card('K', 'clubs')]],
      pile: [card('9', 'hearts')],
    });
    const r = unwrap(
      applyAction(state, {
        type: 'shi.play',
        playerId: 'a',
        source: 'hand',
        cards: [card('10', 'spades')],
      }),
    );
    expect(r.pile).toHaveLength(0);
    expect(r.currentPlayerIdx).toBe(0);
  });
});

// ----- quick-chain rule -------------------------------------------------

describe('Shithead: quick-chain (refill same rank)', () => {
  it('arms quickChainEligible when the refill draws another of the played rank', () => {
    // A plays a K, deck pop yields another K → after refill A holds [K].
    // currentPlayerIdx moves on to B; quickChainEligible records A+K.
    const state = makePlayingState({
      hands: [[card('K', 'spades')], [card('Q', 'clubs')]],
      pile: [card('5', 'hearts')],
      deck: [card('K', 'hearts')], // top of deck (popped first)
    });
    const r = unwrap(
      applyAction(state, {
        type: 'shi.play',
        playerId: 'a',
        source: 'hand',
        cards: [card('K', 'spades')],
      }),
    );
    expect(r.currentPlayerIdx).toBe(1);
    expect(r.quickChainEligible).toEqual({ playerId: 'a', rank: 'K' });
    expect(r.players[0]!.hand).toEqual([card('K', 'hearts')]);
  });

  it('lets the previous player chain the same rank even though the turn has moved on', () => {
    // Continue the previous scenario: A immediately plays the drawn K
    // before B gets a chance. Engine accepts it.
    const initial = makePlayingState({
      hands: [[card('K', 'spades')], [card('Q', 'clubs')]],
      pile: [card('5', 'hearts')],
      deck: [card('K', 'hearts')],
    });
    let s = unwrap(
      applyAction(initial, {
        type: 'shi.play',
        playerId: 'a',
        source: 'hand',
        cards: [card('K', 'spades')],
      }),
    );
    // A chains the drawn K.
    s = unwrap(
      applyAction(s, {
        type: 'shi.play',
        playerId: 'a',
        source: 'hand',
        cards: [card('K', 'hearts')],
      }),
    );
    expect(s.pile[s.pile.length - 1]).toEqual(card('K', 'hearts'));
    expect(s.players[0]!.hand).toHaveLength(0);
    // Deck was emptied by the first refill, no second refill happened.
    expect(s.quickChainEligible).toBeNull();
    // Turn still advances to B (the chain doesn't change whose turn it is).
    expect(s.currentPlayerIdx).toBe(1);
  });

  it('clears quickChainEligible when the next player acts first', () => {
    const initial = makePlayingState({
      hands: [[card('K', 'spades')], [card('A', 'clubs')]],
      pile: [card('5', 'hearts')],
      deck: [card('K', 'hearts')],
    });
    let s = unwrap(
      applyAction(initial, {
        type: 'shi.play',
        playerId: 'a',
        source: 'hand',
        cards: [card('K', 'spades')],
      }),
    );
    // B plays before A's chain — chain window closes.
    s = unwrap(
      applyAction(s, {
        type: 'shi.play',
        playerId: 'b',
        source: 'hand',
        cards: [card('A', 'clubs')],
      }),
    );
    expect(s.quickChainEligible).toBeNull();
    // Now A's chain attempt is rejected.
    const reject = applyAction(s, {
      type: 'shi.play',
      playerId: 'a',
      source: 'hand',
      cards: [card('K', 'hearts')],
    });
    expect(reject.ok).toBe(false);
  });

  it('arms the chain when the actor empties hand+deck and has the same rank in faceUp', () => {
    // A holds [3C] in hand, deck is empty, and a 3S waits face-up.
    // After playing the 3C, A is in faceUp phase. Same-rank 3 is in
    // face-up, so quickChainEligible arms and A can chain it before B
    // plays.
    const state = makePlayingState({
      hands: [[card('3', 'clubs')], [card('5', 'hearts')]],
      faceUp: [[card('3', 'spades')], []],
      pile: [card('K', 'hearts')],
      deck: [],
    });
    const r = unwrap(
      applyAction(state, {
        type: 'shi.play',
        playerId: 'a',
        source: 'hand',
        cards: [card('3', 'clubs')],
      }),
    );
    expect(r.players[0]!.hand).toHaveLength(0);
    expect(r.players[0]!.faceUp).toEqual([card('3', 'spades')]);
    expect(r.quickChainEligible).toEqual({ playerId: 'a', rank: '3' });
    // A chains the matching face-up 3 before B plays.
    const chained = unwrap(
      applyAction(r, {
        type: 'shi.play',
        playerId: 'a',
        source: 'faceUp',
        cards: [card('3', 'spades')],
      }),
    );
    expect(chained.pile[chained.pile.length - 1]).toEqual(card('3', 'spades'));
    expect(chained.players[0]!.faceUp).toHaveLength(0);
  });

  it('does not arm the chain when refill draws a different rank', () => {
    const state = makePlayingState({
      hands: [[card('K', 'spades')], [card('Q', 'clubs')]],
      pile: [card('5', 'hearts')],
      deck: [card('7', 'hearts')], // different rank
    });
    const r = unwrap(
      applyAction(state, {
        type: 'shi.play',
        playerId: 'a',
        source: 'hand',
        cards: [card('K', 'spades')],
      }),
    );
    expect(r.quickChainEligible).toBeNull();
  });
});

// ----- multi-card burst -------------------------------------------------

describe('Shithead: shi.burst with multiple 4s', () => {
  it('places all 4s in one burst and triggers a four-in-a-row burn', () => {
    // 3 players. B bursts with all four 4s out of turn on an empty pile.
    // Four-in-a-row triggers the burn — B keeps the turn.
    const state = makePlayingState({
      hands: [
        [card('K', 'clubs')],
        [
          card('4', 'spades'),
          card('4', 'hearts'),
          card('4', 'diamonds'),
          card('4', 'clubs'),
        ],
        [card('A', 'hearts')],
      ],
      pile: [],
      currentPlayerIdx: 0,
    });
    const r = unwrap(
      applyAction(state, {
        type: 'shi.burst',
        playerId: 'b',
        source: 'hand',
        cards: [
          card('4', 'spades'),
          card('4', 'hearts'),
          card('4', 'diamonds'),
          card('4', 'clubs'),
        ],
      }),
    );
    expect(r.pile).toHaveLength(0);
    expect(r.burnedPile.length).toBe(4);
    expect(r.players[1]!.hand).toHaveLength(0);
    expect(r.currentPlayerIdx).toBe(1); // burster keeps the turn (burn)
  });

  it('allows a second burst onto an all-4s pile (burst chain)', () => {
    // 3 players. A bursts a single 4 onto the empty pile (currentPlayerIdx
    // moves to B). C also has a 4 — and before B plays a non-4, C can
    // pile onto the same all-4s pile.
    const state = makePlayingState({
      hands: [
        [card('K', 'clubs')],
        [card('A', 'hearts')],
        [card('4', 'spades'), card('K', 'spades')],
      ],
      pile: [card('4', 'diamonds')], // A's earlier burst sits here
      currentPlayerIdx: 1, // turn already moved past A to B
    });
    const r = unwrap(
      applyAction(state, {
        type: 'shi.burst',
        playerId: 'c',
        source: 'hand',
        cards: [card('4', 'spades')],
      }),
    );
    expect(r.pile).toEqual([card('4', 'diamonds'), card('4', 'spades')]);
    // Turn passes to the player AFTER the new burster (C → A).
    expect(r.currentPlayerIdx).toBe(0);
  });

  it('rejects a chain burst once the pile has anything other than 4s', () => {
    const state = makePlayingState({
      hands: [
        [card('K', 'clubs')],
        [card('A', 'hearts')],
        [card('4', 'spades')],
      ],
      pile: [card('4', 'diamonds'), card('5', 'hearts')], // non-4 closed the window
    });
    const r = applyAction(state, {
      type: 'shi.burst',
      playerId: 'c',
      source: 'hand',
      cards: [card('4', 'spades')],
    });
    expect(r.ok).toBe(false);
  });

  it('accepts a 4-of-a-kind burn-burst from hand on any pile state', () => {
    // 3 players. B (not on turn) has all four 6s in hand. Pile top is a
    // Q (unrelated). B bursts → newPile = [...prevPile, 6,6,6,6] → top
    // 4 are 6s → burn → B keeps the turn.
    const state = makePlayingState({
      hands: [
        [card('K', 'clubs')],
        [
          card('6', 'spades'),
          card('6', 'hearts'),
          card('6', 'diamonds'),
          card('6', 'clubs'),
        ],
        [card('A', 'hearts')],
      ],
      pile: [card('J', 'spades'), card('Q', 'spades')],
      currentPlayerIdx: 0,
    });
    const r = unwrap(
      applyAction(state, {
        type: 'shi.burst',
        playerId: 'b',
        source: 'hand',
        cards: [
          card('6', 'spades'),
          card('6', 'hearts'),
          card('6', 'diamonds'),
          card('6', 'clubs'),
        ],
      }),
    );
    expect(r.pile).toHaveLength(0);
    expect(r.burnedPile.length).toBe(6); // 2 existing + 4 sixes
    expect(r.currentPlayerIdx).toBe(1); // burster keeps turn (burn)
  });

  it('accepts a complete-the-run burst (1×6 on pile + 3×6 in hand)', () => {
    const state = makePlayingState({
      hands: [
        [card('K', 'clubs')],
        [
          card('6', 'spades'),
          card('6', 'hearts'),
          card('6', 'diamonds'),
        ],
        [],
      ],
      pile: [card('6', 'clubs')], // single 6 sitting on top
      currentPlayerIdx: 0,
    });
    const r = unwrap(
      applyAction(state, {
        type: 'shi.burst',
        playerId: 'b',
        source: 'hand',
        cards: [
          card('6', 'spades'),
          card('6', 'hearts'),
          card('6', 'diamonds'),
        ],
      }),
    );
    expect(r.pile).toHaveLength(0);
    expect(r.burnedPile.length).toBe(4);
    expect(r.currentPlayerIdx).toBe(1);
  });

  it('accepts a complete-the-run burst (2×7 pile + 2×7 hand)', () => {
    const state = makePlayingState({
      hands: [
        [card('K', 'clubs')],
        [card('7', 'spades'), card('7', 'hearts')],
      ],
      pile: [card('7', 'clubs'), card('7', 'diamonds')],
      currentPlayerIdx: 0,
    });
    const r = unwrap(
      applyAction(state, {
        type: 'shi.burst',
        playerId: 'b',
        source: 'hand',
        cards: [card('7', 'spades'), card('7', 'hearts')],
      }),
    );
    expect(r.pile).toHaveLength(0);
    expect(r.burnedPile.length).toBe(4);
    expect(r.currentPlayerIdx).toBe(1);
  });

  it('accepts a complete-the-run burst (3×5 pile + 1×5 hand)', () => {
    const state = makePlayingState({
      hands: [
        [card('K', 'clubs')],
        [card('5', 'spades')],
      ],
      pile: [card('5', 'clubs'), card('5', 'diamonds'), card('5', 'hearts')],
      currentPlayerIdx: 0,
    });
    const r = unwrap(
      applyAction(state, {
        type: 'shi.burst',
        playerId: 'b',
        source: 'hand',
        cards: [card('5', 'spades')],
      }),
    );
    expect(r.pile).toHaveLength(0);
    expect(r.burnedPile.length).toBe(4);
    expect(r.currentPlayerIdx).toBe(1);
  });

  it('rejects a non-4 burst that would NOT complete a four-in-a-row', () => {
    // Pile has a 6 + a Q. Hand has 2×6 only — not enough.
    const state = makePlayingState({
      hands: [
        [card('K', 'clubs')],
        [card('6', 'spades'), card('6', 'hearts')],
      ],
      pile: [card('6', 'clubs'), card('Q', 'diamonds')],
    });
    const r = applyAction(state, {
      type: 'shi.burst',
      playerId: 'b',
      source: 'hand',
      cards: [card('6', 'spades'), card('6', 'hearts')],
    });
    expect(r.ok).toBe(false);
  });

  it('arms the chain after a non-burning burst when the refill draws another 4', () => {
    // 3 players. B (not on turn) bursts with one 4 on an empty pile.
    // The refill pops another 4 — B should now be able to chain that
    // drawn 4 via shi.play before C plays their next card.
    const state = makePlayingState({
      hands: [
        [card('K', 'clubs')],
        [card('4', 'spades')],
        [card('A', 'hearts')],
      ],
      pile: [],
      deck: [card('4', 'diamonds')], // pops first
      currentPlayerIdx: 0,
    });
    const r1 = unwrap(
      applyAction(state, {
        type: 'shi.burst',
        playerId: 'b',
        source: 'hand',
        cards: [card('4', 'spades')],
      }),
    );
    expect(r1.pile).toEqual([card('4', 'spades')]);
    expect(r1.currentPlayerIdx).toBe(2);
    expect(r1.quickChainEligible).toEqual({ playerId: 'b', rank: '4' });
    expect(r1.players[1]!.hand).toEqual([card('4', 'diamonds')]);

    // B chains the drawn 4 before C plays.
    const r2 = unwrap(
      applyAction(r1, {
        type: 'shi.play',
        playerId: 'b',
        source: 'hand',
        cards: [card('4', 'diamonds')],
      }),
    );
    expect(r2.pile).toEqual([
      card('4', 'spades'),
      card('4', 'diamonds'),
    ]);
    // Chain didn't change whose actual turn it is (still after-B = C).
    expect(r2.currentPlayerIdx).toBe(2);
  });

  it('rejects a burst that mixes 4s with another rank', () => {
    const state = makePlayingState({
      hands: [
        [card('K', 'clubs')],
        [card('4', 'spades'), card('5', 'hearts')],
      ],
      pile: [],
    });
    const r = applyAction(state, {
      type: 'shi.burst',
      playerId: 'b',
      source: 'hand',
      cards: [card('4', 'spades'), card('5', 'hearts')],
    });
    expect(r.ok).toBe(false);
  });
});

// ----- game-end + restart penalty --------------------------------------

describe('Shithead: game-end + restart penalty', () => {
  it('marks a player out when their last card is played and finishes when only one remains', () => {
    // A has a single K; B has K. Both empty faceUp + faceDown. A plays K
    // → A becomes out → only B left → game finishes with B as the loser.
    const state = makePlayingState({
      hands: [[card('K', 'spades')], [card('K', 'clubs')]],
      faceUp: [[], []],
      faceDown: [[], []],
      pile: [card('5', 'hearts')],
    });
    const r = unwrap(
      applyAction(state, {
        type: 'shi.play',
        playerId: 'a',
        source: 'hand',
        cards: [card('K', 'spades')],
      }),
    );
    expect(r.phase).toBe('finished');
    expect(r.loser).toBe('b');
    expect(r.outOrder).toEqual(['a']);
    expect(r.endReason).toBe('normal');
  });

  it('the previous game\'s shithead has their faceUp dealt randomly and is auto-confirmed', () => {
    // createGame already covered in 4a — this regression-checks the full
    // flow (createGame → startGame) end-to-end with the penalty.
    const initial = createGame(
      [
        { id: 'a', nickname: 'A' },
        { id: 'b', nickname: 'B' },
      ],
      { shitheadId: 'b' },
    );
    const after = unwrap(startGame(initial, deterministicDeck()));
    expect(after.players[1]!.forcedFaceUp).toBe(true);
    expect(after.players[1]!.setupConfirmed).toBe(true);
    expect(after.players[1]!.faceUp).toHaveLength(3);
    expect(after.players[0]!.setupConfirmed).toBe(false);
  });

  it('after the non-shithead confirms, the game enters the playing phase', () => {
    const initial = createGame(
      [
        { id: 'a', nickname: 'A' },
        { id: 'b', nickname: 'B' },
      ],
      { shitheadId: 'b' },
    );
    let state = unwrap(startGame(initial, deterministicDeck()));
    state = unwrap(
      applyAction(state, {
        type: 'shi.setup.confirm',
        playerId: 'a',
        faceUpIndexes: [0, 1, 2],
      }),
    );
    expect(state.phase).toBe('playing');
  });
});
