// Durak-specific game types — split out from shared/src/types.ts when the
// codebase grew to support multiple games. Only types that are meaningful
// to Durak's rules live here; generic primitives (Card, Suit, Player, etc.)
// stay in shared/src/types.ts because Shithead and other games reuse them.

import type { Card, Player, PlayerScore, PublicPlayer, Suit } from '../../types';

// A single attack on the table, with an optional defense card.
export interface TablePair {
  attack: Card;
  defense?: Card;
}

export type GamePhase = 'waiting' | 'playing' | 'finished';

// Authoritative state held on the server.
export interface GameState {
  phase: GamePhase;
  players: Player[];        // seat order (clockwise from index 0)
  deck: Card[];             // remaining draw pile; deck[0] is the bottom = trump card
  trumpSuit: Suit;
  discard: Card[];          // "bito" — successfully defended cards live here
  table: TablePair[];       // pairs currently in play for this round
  attackerIndex: number;    // index into players[] — opens the round
  defenderIndex: number;    // index into players[] — currently being attacked
  roundNumber: number;      // 1-indexed; round 1 caps attacks at 5, round 2+ at 6
  roundAttackLimit: number; // max attacks this round (computed at round start)
  passedPlayerIds: string[]; // non-defenders who have declared "pass" this round
  defenderTaking: boolean;  // true once defender declared 'take' (more throw-ins allowed)
  // Number of cards the defender held at the START of the current round (or
  // at the moment a transfer made them the defender). The total attacks
  // this round can never exceed this number — even if the defender has
  // declared `take`. Refreshed in startGame / completeRound / handleTransfer.
  defenderRoundStartHandSize: number;
  // Order in which players emptied their hand (with deck also empty) — the
  // first id is 1st place, last is 2nd-to-last. The durak is the one NOT in
  // this list (set as `loser` once game ends).
  outOrder: string[];
  loser: string | null;     // player id of the durak once phase === 'finished'
  // Why the game ended. 'normal' = standard durak finish; 'player_disconnected'
  // = a player's reconnect-grace expired mid-game, so the round ends with no
  // winner (loser stays null) and the scoreboard isn't updated.
  endReason: 'normal' | 'player_disconnected' | null;
  // Reason the first attacker was chosen. Used by the client to show a one-
  // off banner at the start of each game. null after the first action.
  firstAttackerReason: 'six_of_trumps' | 'random' | 'previous_winner' | null;
}

// Actions a player can send over the wire. (Game lifecycle actions like
// startGame are server-internal — see startGame() in engine.ts.)
export type Action =
  | { type: 'attack'; playerId: string; card: Card }
  | { type: 'defend'; playerId: string; pairIndex: number; card: Card }
  | { type: 'transfer'; playerId: string; card: Card }   // Перевод pass-on
  | { type: 'take'; playerId: string }                   // defender picks up
  | { type: 'pass'; playerId: string };                  // attackers concede the round

// Per-player filtered view sent over the wire. Other players' hands collapse
// to counts so the server never leaks hidden information.
export interface ClientGameState {
  roomId: string;
  phase: GamePhase;
  selfHand: Card[];
  selfIndex: number;
  players: PublicPlayer[];
  deckCount: number;
  trumpCard: Card | null;
  trumpSuit: Suit;
  discardCount: number;
  table: TablePair[];
  attackerIndex: number;
  defenderIndex: number;
  defenderTaking: boolean;
  defenderRoundStartHandSize: number;
  passedPlayerIds: string[];
  turnDeadline: number | null;
  outOrder: string[];
  loser: string | null;
  endReason: 'normal' | 'player_disconnected' | null;
  firstAttackerReason: 'six_of_trumps' | 'random' | 'previous_winner' | null;
  scoreboard: { [playerId: string]: PlayerScore };
}
