import { describe, it, expect } from 'vitest';
import {
  createGame,
  startGame,
  applyAction,
  findFirstAttackerForNewGame,
  type EngineSuccess,
  type EngineResult,
} from '../src/engine';
import type { Card, GameState, Player, Suit, TablePair } from '../src/types';
import { createDeck, shuffle } from '../src/deck';

const card = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });
const pair = (attack: Card, defense?: Card): TablePair => ({ attack, defense });

const player = (id: string, hand: Card[] = [], isOut = false): Player => ({
  id,
  nickname: id,
  hand,
  isOut,
});

// Helper: construct a playing GameState for handler unit tests.
function makeState(overrides: Partial<GameState> = {}): GameState {
  const base: GameState = {
    phase: 'playing',
    players: [player('p0'), player('p1')],
    deck: [],
    trumpSuit: 'hearts',
    discard: [],
    table: [],
    attackerIndex: 0,
    defenderIndex: 1,
    roundNumber: 1,
    roundAttackLimit: 5,
    passedPlayerIds: [],
    defenderTaking: false,
    outOrder: [],
    loser: null,
    endReason: null,
    firstAttackerReason: null,
  };
  return { ...base, ...overrides };
}

// Type helper: narrow EngineResult to success and unwrap state.
function unwrap(r: EngineResult): GameState {
  if (!r.ok) throw new Error(`expected success, got error: ${r.error}`);
  return (r as EngineSuccess).state;
}

// Seeded RNG for deterministic shuffles in scenario tests.
const seededRng = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
};

// ---------------------------------------------------------------------------
// createGame
// ---------------------------------------------------------------------------

describe('createGame', () => {
  it('builds a waiting state with empty hands', () => {
    const state = createGame([
      { id: 'a', nickname: 'Alice' },
      { id: 'b', nickname: 'Bob' },
    ]);
    expect(state.phase).toBe('waiting');
    expect(state.players).toHaveLength(2);
    expect(state.players.every((p) => p.hand.length === 0 && !p.isOut)).toBe(true);
    expect(state.deck).toEqual([]);
    expect(state.table).toEqual([]);
    expect(state.loser).toBe(null);
  });

  it('rejects fewer than 2 players', () => {
    expect(() => createGame([{ id: 'a', nickname: 'A' }])).toThrow();
  });

  it('rejects more than 5 players', () => {
    expect(() =>
      createGame(
        Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, nickname: `P${i}` })),
      ),
    ).toThrow();
  });

  it('rejects duplicate player ids', () => {
    expect(() =>
      createGame([
        { id: 'a', nickname: 'A' },
        { id: 'a', nickname: 'A2' },
      ]),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// startGame
// ---------------------------------------------------------------------------

describe('startGame', () => {
  it('deals 6 cards each and transitions to playing', () => {
    const state = createGame([
      { id: 'a', nickname: 'A' },
      { id: 'b', nickname: 'B' },
      { id: 'c', nickname: 'C' },
    ]);
    const shuffled = shuffle(createDeck(), seededRng(1));
    const result = unwrap(startGame(state, shuffled));
    expect(result.phase).toBe('playing');
    expect(result.players.every((p) => p.hand.length === 6)).toBe(true);
    expect(result.deck).toHaveLength(36 - 3 * 6);
    expect(result.roundNumber).toBe(1);
    expect(result.trumpSuit).toBe(result.deck[0]!.suit);
  });

  it('first attacker holds the 6 of trumps when someone has it', () => {
    const state = createGame([
      { id: 'a', nickname: 'A' },
      { id: 'b', nickname: 'B' },
    ]);
    // Try several seeds — most will produce a deal where one player holds
    // the 6 of trumps. If so, that player must be the first attacker.
    for (let seed = 1; seed < 30; seed++) {
      const shuffled = shuffle(createDeck(), seededRng(seed));
      const result = unwrap(startGame(state, shuffled));
      const trump = result.trumpSuit;
      const holder = result.players.findIndex((p) =>
        p.hand.some((c) => c.rank === '6' && c.suit === trump),
      );
      if (holder >= 0) {
        expect(result.attackerIndex).toBe(holder);
        expect(result.firstAttackerReason).toBe('six_of_trumps');
        return; // one demonstration is enough
      }
    }
    throw new Error('no seed in 1..30 produced a 6-of-trumps deal');
  });

  it('records firstAttackerReason=random when no player has the 6 of trumps', () => {
    // Hand-craft a state where no player holds the 6 of trumps — easy here
    // because we bypass the deck and call findFirstAttackerForNewGame directly.
    const players: Player[] = [
      player('a', [card('K', 'hearts'), card('A', 'spades')]),
      player('b', [card('Q', 'hearts'), card('J', 'clubs')]),
    ];
    // Use injected RNG → deterministic "random" pick.
    const pick = findFirstAttackerForNewGame(players, 'hearts', {
      random: () => 0.9, // → Math.floor(0.9 * 2) = 1 → player b
    });
    expect(pick.reason).toBe('random');
    expect(pick.index).toBe(1);
  });

  it('honours startPlayerId (previous_winner) when provided', () => {
    const players: Player[] = [
      player('a', [card('6', 'hearts')]), // would normally win on six_of_trumps
      player('b', [card('K', 'hearts')]),
    ];
    const pick = findFirstAttackerForNewGame(players, 'hearts', {
      startPlayerId: 'b',
    });
    expect(pick.reason).toBe('previous_winner');
    expect(pick.index).toBe(1);
  });

  it('falls back to six_of_trumps when startPlayerId is unknown', () => {
    const players: Player[] = [
      player('a', [card('K', 'hearts')]),
      player('b', [card('6', 'hearts')]),
    ];
    const pick = findFirstAttackerForNewGame(players, 'hearts', {
      startPlayerId: 'missing-id',
    });
    expect(pick.reason).toBe('six_of_trumps');
    expect(pick.index).toBe(1);
  });

  it('rejects starting an already-started game', () => {
    const state = createGame([
      { id: 'a', nickname: 'A' },
      { id: 'b', nickname: 'B' },
    ]);
    const shuffled = shuffle(createDeck(), seededRng(3));
    const started = unwrap(startGame(state, shuffled));
    const second = startGame(started, shuffled);
    expect(second.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// attack
// ---------------------------------------------------------------------------

describe('applyAction: attack', () => {
  it('accepts a legal opening attack from the attacker', () => {
    const seven = card('7', 'spades');
    const state = makeState({
      players: [player('p0', [seven]), player('p1', [card('K', 'spades')])],
    });
    const result = unwrap(applyAction(state, { type: 'attack', playerId: 'p0', card: seven }));
    expect(result.table).toEqual([{ attack: seven }]);
    expect(result.players[0]!.hand).toEqual([]);
  });

  it('rejects opening attack from non-attacker', () => {
    const seven = card('7', 'spades');
    const state = makeState({
      players: [player('p0'), player('p1', [seven])],
    });
    const r = applyAction(state, { type: 'attack', playerId: 'p1', card: seven });
    expect(r.ok).toBe(false);
  });

  it('rejects card not in hand', () => {
    const state = makeState({
      players: [player('p0', []), player('p1')],
    });
    const r = applyAction(state, { type: 'attack', playerId: 'p0', card: card('A', 'spades') });
    expect(r.ok).toBe(false);
  });

  it('rejects defender attacking', () => {
    const c = card('A', 'spades');
    const state = makeState({
      players: [player('p0'), player('p1', [c])],
    });
    const r = applyAction(state, { type: 'attack', playerId: 'p1', card: c });
    expect(r.ok).toBe(false);
  });

  it('accepts throw-in matching rank on table', () => {
    // 3-player setup: p0 attacker, p1 defender, p2 free to throw in
    const sevenS = card('7', 'spades');
    const sevenH = card('7', 'hearts');
    const state = makeState({
      players: [
        player('p0'),
        player('p1', [card('K', 'spades'), card('K', 'hearts')]),
        player('p2', [sevenH]),
      ],
      table: [pair(sevenS)],
      attackerIndex: 0,
      defenderIndex: 1,
    });
    const result = unwrap(applyAction(state, { type: 'attack', playerId: 'p2', card: sevenH }));
    expect(result.table).toHaveLength(2);
  });

  it('rejects throw-in of non-matching rank', () => {
    const sevenS = card('7', 'spades');
    const eightH = card('8', 'hearts');
    const state = makeState({
      players: [
        player('p0'),
        player('p1', [card('K', 'spades'), card('K', 'hearts')]),
        player('p2', [eightH]),
      ],
      table: [pair(sevenS)],
      attackerIndex: 0,
      defenderIndex: 1,
    });
    const r = applyAction(state, { type: 'attack', playerId: 'p2', card: eightH });
    expect(r.ok).toBe(false);
    expect(r.ok || r.error).toBe('attack_rank_mismatch');
  });

  // Granular error codes — the client maps these to localised toasts.
  it('returns attack_round_1_limit when the table is at the round-1 cap of 5', () => {
    const table: TablePair[] = Array.from({ length: 5 }, () =>
      pair(card('7', 'spades'), card('K', 'spades')),
    );
    const sevenH = card('7', 'hearts');
    const state = makeState({
      players: [
        player('p0', [sevenH]),
        player('p1', [card('A', 'spades'), card('A', 'hearts')]),
      ],
      table,
      roundNumber: 1,
      roundAttackLimit: 5,
    });
    const r = applyAction(state, { type: 'attack', playerId: 'p0', card: sevenH });
    expect(r.ok).toBe(false);
    expect(r.ok || r.error).toBe('attack_round_1_limit');
  });

  it('returns attack_round_limit when the table is at the round-2+ cap of 6', () => {
    const table: TablePair[] = Array.from({ length: 6 }, () =>
      pair(card('7', 'spades'), card('K', 'spades')),
    );
    const sevenH = card('7', 'hearts');
    const state = makeState({
      players: [
        player('p0', [sevenH]),
        player('p1', [card('A', 'spades'), card('A', 'hearts')]),
      ],
      table,
      roundNumber: 2,
      roundAttackLimit: 6,
    });
    const r = applyAction(state, { type: 'attack', playerId: 'p0', card: sevenH });
    expect(r.ok).toBe(false);
    expect(r.ok || r.error).toBe('attack_round_limit');
  });

  it('returns attack_defender_empty when defender has no cards (not taking)', () => {
    const sevenH = card('7', 'hearts');
    const state = makeState({
      players: [player('p0', [sevenH]), player('p1', [])],
      table: [pair(card('7', 'spades'), card('K', 'spades'))],
      defenderTaking: false,
    });
    const r = applyAction(state, { type: 'attack', playerId: 'p0', card: sevenH });
    expect(r.ok).toBe(false);
    expect(r.ok || r.error).toBe('attack_defender_empty');
  });

  it('returns attack_defender_full:N when undefended count would exceed defender hand', () => {
    // 3 attacks, 1 defended → 2 undefended already. Defender has 2 cards.
    // A throw-in would make 3 undefended for 2 cards → blocked.
    const sevenH = card('7', 'hearts');
    const state = makeState({
      players: [
        player('p0', [sevenH]),
        player('p1', [card('K', 'spades'), card('A', 'spades')]),
      ],
      table: [
        pair(card('7', 'spades'), card('Q', 'spades')),
        pair(card('7', 'clubs')),
        pair(card('7', 'diamonds')),
      ],
      roundNumber: 2,
      roundAttackLimit: 6,
    });
    const r = applyAction(state, { type: 'attack', playerId: 'p0', card: sevenH });
    expect(r.ok).toBe(false);
    expect(r.ok || r.error).toBe('attack_defender_full:2');
  });

  it('allows throw-in when all current attacks are defended (real-game bug 2026-05-30)', () => {
    // Reproduces user-reported scenario: 5 defended pairs, defender holds 1
    // card, round 2+. Adding a matching-rank throw-in is legal because the
    // defender will have exactly enough cards to defend the new undefended
    // attack. The earlier rule wrongly counted the defended pairs against
    // the defender's current hand and blocked this move.
    const kingD = card('K', 'diamonds');
    const state = makeState({
      players: [
        player('p0', [kingD]),
        player('p1', [card('A', 'hearts')]), // defender, 1 card
      ],
      table: [
        pair(card('6', 'hearts'), card('Q', 'hearts')),
        pair(card('6', 'clubs'), card('8', 'diamonds')),
        pair(card('6', 'spades'), card('9', 'diamonds')),
        pair(card('Q', 'clubs'), card('K', 'clubs')),
        pair(card('Q', 'spades'), card('J', 'diamonds')),
      ],
      roundNumber: 2,
      roundAttackLimit: 6,
    });
    const r = applyAction(state, { type: 'attack', playerId: 'p0', card: kingD });
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// defend
// ---------------------------------------------------------------------------

describe('applyAction: defend', () => {
  it('accepts higher same-suit defense', () => {
    const attack = card('7', 'spades');
    const defense = card('K', 'spades');
    const state = makeState({
      players: [player('p0'), player('p1', [defense])],
      table: [pair(attack)],
    });
    const result = unwrap(
      applyAction(state, { type: 'defend', playerId: 'p1', pairIndex: 0, card: defense }),
    );
    expect(result.table[0]!.defense).toEqual(defense);
    expect(result.players[1]!.hand).toEqual([]);
  });

  it('accepts trump against non-trump attack', () => {
    const attack = card('A', 'spades');
    const trump = card('6', 'hearts');
    const state = makeState({
      players: [player('p0'), player('p1', [trump])],
      table: [pair(attack)],
      trumpSuit: 'hearts',
    });
    const r = unwrap(
      applyAction(state, { type: 'defend', playerId: 'p1', pairIndex: 0, card: trump }),
    );
    expect(r.table[0]!.defense).toEqual(trump);
  });

  it('rejects when card does not beat', () => {
    const attack = card('K', 'spades');
    const weak = card('7', 'spades');
    const state = makeState({
      players: [player('p0'), player('p1', [weak])],
      table: [pair(attack)],
    });
    const r = applyAction(state, { type: 'defend', playerId: 'p1', pairIndex: 0, card: weak });
    expect(r.ok).toBe(false);
  });

  it('rejects non-defender', () => {
    const r = applyAction(
      makeState({ table: [pair(card('7', 'spades'))] }),
      { type: 'defend', playerId: 'p0', pairIndex: 0, card: card('K', 'spades') },
    );
    expect(r.ok).toBe(false);
  });

  it('rejects when defender is taking', () => {
    const state = makeState({
      players: [player('p0'), player('p1', [card('K', 'spades')])],
      table: [pair(card('7', 'spades'))],
      defenderTaking: true,
    });
    const r = applyAction(state, {
      type: 'defend',
      playerId: 'p1',
      pairIndex: 0,
      card: card('K', 'spades'),
    });
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// transfer
// ---------------------------------------------------------------------------

describe('applyAction: transfer', () => {
  it('allows defender to transfer with matching rank; advances defenderIndex', () => {
    const sevenS = card('7', 'spades');
    const sevenH = card('7', 'hearts');
    const state = makeState({
      players: [
        player('p0'),
        player('p1', [sevenH, card('K', 'clubs')]),
        player('p2', [card('A', 'clubs'), card('A', 'spades')]),
      ],
      table: [pair(sevenS)],
      attackerIndex: 0,
      defenderIndex: 1,
      trumpSuit: 'diamonds', // hearts is NOT trump here
    });
    const result = unwrap(
      applyAction(state, { type: 'transfer', playerId: 'p1', card: sevenH }),
    );
    expect(result.defenderIndex).toBe(2);
    expect(result.table).toHaveLength(2);
    expect(result.players[1]!.hand).toEqual([card('K', 'clubs')]);
  });

  it('rejects when a defense already exists', () => {
    const state = makeState({
      players: [
        player('p0'),
        player('p1', [card('7', 'hearts')]),
        player('p2', [card('A', 'clubs')]),
      ],
      table: [pair(card('7', 'spades'), card('K', 'spades'))],
      defenderIndex: 1,
    });
    const r = applyAction(state, {
      type: 'transfer',
      playerId: 'p1',
      card: card('7', 'hearts'),
    });
    expect(r.ok).toBe(false);
  });

  it('rejects when new defender does not have enough cards', () => {
    const state = makeState({
      players: [
        player('p0'),
        player('p1', [card('7', 'hearts')]),
        player('p2', [card('A', 'clubs')]), // hand size 1; table will be 2 after transfer
      ],
      table: [pair(card('7', 'spades'))],
      defenderIndex: 1,
    });
    const r = applyAction(state, {
      type: 'transfer',
      playerId: 'p1',
      card: card('7', 'hearts'),
    });
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// take
// ---------------------------------------------------------------------------

describe('applyAction: take', () => {
  it('sets defenderTaking on success', () => {
    const state = makeState({
      players: [player('p0'), player('p1')],
      table: [pair(card('7', 'spades'))],
    });
    const r = unwrap(applyAction(state, { type: 'take', playerId: 'p1' }));
    expect(r.defenderTaking).toBe(true);
    expect(r.table).toHaveLength(1); // cards NOT yet moved
  });

  it('rejects non-defender', () => {
    const r = applyAction(
      makeState({ table: [pair(card('7', 'spades'))] }),
      { type: 'take', playerId: 'p0' },
    );
    expect(r.ok).toBe(false);
  });

  it('rejects on empty table', () => {
    const r = applyAction(makeState(), { type: 'take', playerId: 'p1' });
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// pass + round completion
// ---------------------------------------------------------------------------

describe('applyAction: pass + round transition', () => {
  it('rejects pass when defender owes an undefended attack and is not taking', () => {
    const state = makeState({
      players: [player('p0'), player('p1')],
      table: [pair(card('7', 'spades'))],
    });
    const r = applyAction(state, { type: 'pass', playerId: 'p0' });
    expect(r.ok).toBe(false);
  });

  it('after successful defense, attacker passing ends round and discards cards', () => {
    // 2-player: p0 attacker, p1 defender. Table fully defended. p0 passes.
    const state = makeState({
      players: [
        // p0 will replenish from deck; p1 also (deck has plenty)
        player('p0', []),
        player('p1', []),
      ],
      deck: Array.from({ length: 12 }, (_, i) => card(((i % 9) === 0 ? '6' : (['6','7','8','9','10','J','Q','K','A'] as const)[i%9])!, (['hearts','diamonds','clubs','spades'] as const)[i%4]!)),
      table: [pair(card('7', 'spades'), card('K', 'spades'))],
    });
    const r = unwrap(applyAction(state, { type: 'pass', playerId: 'p0' }));
    expect(r.table).toEqual([]);
    expect(r.discard).toHaveLength(2);
    // Defender becomes next attacker
    expect(r.attackerIndex).toBe(1);
    expect(r.defenderIndex).toBe(0);
    expect(r.roundNumber).toBe(2);
    expect(r.roundAttackLimit).toBe(6); // round 2+
    // Hands replenished up to 6
    expect(r.players[0]!.hand.length).toBe(6);
    expect(r.players[1]!.hand.length).toBe(6);
  });

  it('after take, attacker advances 2 (defender skips); cards go to defender', () => {
    // 3-player: p0 attacks p1; p1 takes; p2 passes.
    const attack1 = card('7', 'spades');
    const attack2 = card('7', 'hearts');
    const state = makeState({
      players: [
        player('p0', []),
        player('p1', []),
        player('p2', []),
      ],
      deck: Array.from({ length: 30 }, (_, i) => card(
        (['6','7','8','9','10','J','Q','K','A'] as const)[i % 9]!,
        (['hearts','diamonds','clubs','spades'] as const)[i % 4]!,
      )),
      table: [pair(attack1), pair(attack2)],
      attackerIndex: 0,
      defenderIndex: 1,
      defenderTaking: true,
    });
    // p0 passes, then p2 passes → round completes
    const afterP0 = unwrap(applyAction(state, { type: 'pass', playerId: 'p0' }));
    expect(afterP0.passedPlayerIds).toEqual(['p0']);
    expect(afterP0.table).toHaveLength(2); // not completed yet (p2 hasn't passed)

    const final = unwrap(applyAction(afterP0, { type: 'pass', playerId: 'p2' }));
    expect(final.table).toEqual([]);
    // Defender hand gained the 2 table cards (then replenished to 6)
    expect(final.players[1]!.hand.length).toBe(6);
    expect(final.players[1]!.hand).toEqual(
      expect.arrayContaining([attack1, attack2]),
    );
    // Attacker advances past defender: p1 -> p2
    expect(final.attackerIndex).toBe(2);
    expect(final.defenderIndex).toBe(0);
    expect(final.defenderTaking).toBe(false);
  });

  it('one non-defender passing is not enough in a 3-player game', () => {
    const state = makeState({
      players: [
        player('p0'),
        player('p1'),
        player('p2'),
      ],
      table: [pair(card('7', 'spades'), card('K', 'spades'))],
      attackerIndex: 0,
      defenderIndex: 1,
    });
    const r = unwrap(applyAction(state, { type: 'pass', playerId: 'p0' }));
    expect(r.table).toHaveLength(1); // p2 hasn't passed yet
    expect(r.passedPlayerIds).toEqual(['p0']);
  });
});

// ---------------------------------------------------------------------------
// Game-ending: durak detection
// ---------------------------------------------------------------------------

describe('game over', () => {
  it('finishes with loser set when only one player has cards and deck is empty', () => {
    // Setup: empty deck, p0 has no cards (just emptied last round), p1 still has cards.
    // We simulate by having p0 successfully defend their last card and the round closing.
    const lastAttack = card('K', 'spades');
    const lastDefense = card('A', 'spades');
    const state = makeState({
      players: [
        // p0 attacker — has the attack card still to-play? No, attack already on table.
        // After the round, hands replenish from deck (empty), so:
        //   - p0 has 0 cards after this round (and deck empty) → isOut
        //   - p1 has remaining cards → durak
        player('p0', []),
        player('p1', [card('6', 'diamonds')]), // has cards left
      ],
      deck: [],
      table: [pair(lastAttack, lastDefense)],
      attackerIndex: 0,
      defenderIndex: 1,
    });
    const final = unwrap(applyAction(state, { type: 'pass', playerId: 'p0' }));
    expect(final.phase).toBe('finished');
    expect(final.loser).toBe('p1');
  });

  it('records a draw (loser = null) when everyone empties simultaneously', () => {
    const state = makeState({
      players: [player('p0', []), player('p1', [])],
      deck: [],
      table: [pair(card('7', 'spades'), card('K', 'spades'))],
    });
    const final = unwrap(applyAction(state, { type: 'pass', playerId: 'p0' }));
    expect(final.phase).toBe('finished');
    expect(final.loser).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Full game scenario (smoke test)
// ---------------------------------------------------------------------------

describe('full game scenario', () => {
  it('plays a 2-player game to completion with deterministic shuffle', () => {
    const initial = createGame([
      { id: 'a', nickname: 'Alice' },
      { id: 'b', nickname: 'Bob' },
    ]);
    const shuffled = shuffle(createDeck(), seededRng(123));
    let state = unwrap(startGame(initial, shuffled));
    expect(state.phase).toBe('playing');

    // Play a deterministic "always take" strategy: defender always takes,
    // attacker always plays their lowest card. This guarantees forward progress.
    const maxIterations = 2000;
    let i = 0;
    while (state.phase === 'playing' && i < maxIterations) {
      i++;
      const attacker = state.players[state.attackerIndex]!;
      const defender = state.players[state.defenderIndex]!;

      if (state.table.length === 0) {
        // Attacker opens with their first card
        if (attacker.hand.length === 0) break; // shouldn't happen, but safety
        const r = applyAction(state, {
          type: 'attack',
          playerId: attacker.id,
          card: attacker.hand[0]!,
        });
        if (!r.ok) throw new Error(`attack failed: ${r.error}`);
        state = r.state;
        continue;
      }

      // If table has an undefended attack and defender hasn't said take, defender takes.
      const undefended = state.table.findIndex((p) => p.defense === undefined);
      if (undefended !== -1 && !state.defenderTaking) {
        const r = applyAction(state, { type: 'take', playerId: defender.id });
        if (!r.ok) throw new Error(`take failed: ${r.error}`);
        state = r.state;
        continue;
      }

      // Otherwise the non-defender passes (in 2-player, that's the attacker).
      const nonDefenderId = state.players.find((_, idx) => idx !== state.defenderIndex)!.id;
      const r = applyAction(state, { type: 'pass', playerId: nonDefenderId });
      if (!r.ok) throw new Error(`pass failed: ${r.error}`);
      state = r.state;
    }

    expect(state.phase).toBe('finished');
    expect(state.loser).not.toBe(undefined);
    // Total cards across hands + discard + deck + table should equal 36
    const total =
      state.players.reduce((sum, p) => sum + p.hand.length, 0) +
      state.discard.length +
      state.deck.length +
      state.table.length;
    expect(total).toBe(36);
  });
});
