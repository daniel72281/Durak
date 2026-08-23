// Shithead game state + actions. Pure types only — no runtime imports of
// DOM- or Node-specific modules. See rules.ts for predicates and engine.ts
// for the reducer.

import type { Card, PlayerScore, PublicPlayer } from '../../types';

// Ranks Shithead uses (the standard 52-card deck). Joker is handled
// separately (rank === 'JOKER'), since it has no numeric value.
export const SHITHEAD_RANKS_IN_ORDER = [
  '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A',
] as const satisfies readonly string[];

// Three discrete game phases:
//   - 'setup'    each player has been dealt 3 face-down + 6 hand cards
//                and must confirm 3 of the 6 to flip face-up. When every
//                player has confirmed, the engine moves to 'playing'.
//   - 'playing'  normal turn loop. Cards travel hand → pile.
//   - 'finished' last player with cards is the shithead (loser).
export type ShitheadPhase = 'setup' | 'playing' | 'finished';

export interface ShitheadPlayer {
  id: string;
  nickname: string;
  // Cards in hand. After setup, drawn from deck to maintain a 3-card hand
  // until the deck empties.
  hand: Card[];
  // Three cards facing up on top of the face-down stack. Visible to all
  // players. Played from once hand AND deck are both empty.
  faceUp: Card[];
  // Three cards facing down, played blindly once faceUp is empty. The
  // server hides their values; clients only see the count.
  faceDown: Card[];
  // True once this player has no cards anywhere (hand, faceUp, faceDown).
  isOut: boolean;
  // During 'setup' phase: has this player confirmed their face-up choice?
  setupConfirmed: boolean;
  // Restart penalty: when true, the engine deals the face-up cards
  // randomly instead of letting the player pick — the shithead of the
  // previous game starts the new one without a choice.
  forcedFaceUp: boolean;
}

export interface ShitheadGameState {
  phase: ShitheadPhase;
  players: ShitheadPlayer[];

  // Draw pile. drawFromTop() pops from the END (deck[deck.length-1]).
  // Same convention as Durak's deck.
  deck: Card[];

  // The communal play pile. pile[pile.length-1] is the visible top card.
  pile: Card[];

  // Burned cards (10, four-of-a-kind, four-in-a-row). Out of the game
  // forever — only the count is meaningful to anyone.
  burnedPile: Card[];

  // Whose turn it is. Index into `players`. Skips isOut players.
  currentPlayerIdx: number;

  // When non-null, that player just played a Joker and must choose who
  // takes the pile. The engine refuses any action other than
  // 'shi.joker.choose' from that player until they make the choice.
  pendingJokerChooserId: string | null;

  // Players in the order they emptied their cards. The shithead is the
  // one player NOT in this list when the game ends.
  outOrder: string[];

  // Quick-chain rule: when a player plays a card from hand and the
  // refill draws another card of the SAME rank, they're given a short
  // window to chain that drawn card onto the pile — even though the
  // turn has already passed to the next player. The race against the
  // next player is resolved naturally by socket arrival order.
  //
  // The chain stays open until ANY other action runs (which sets this
  // field back to null). A successful chain may re-arm it if the next
  // refill also drew the rank.
  quickChainEligible: {
    playerId: string;
    rank: Card['rank'];
  } | null;

  // Running total of 8s one player has laid down in an unbroken streak —
  // their own play plus any quick-chained follow-ups that land before the
  // next player acts. The skip is resolved from the PARITY of this total
  // (two 8s cancel and hand the turn back; an odd one behaves like a lone
  // 8), so 2-then-1 and 1-1-1 resolve identically. Cleared by any other
  // action, by a different player acting, or by a non-8 play.
  eightChain: {
    playerId: string;
    count: number;
  } | null;

  loser: string | null;

  // Mirrors Durak's endReason so disconnect aborts route through the
  // same scoring path (empty deltas — scoreboard unchanged).
  endReason: 'normal' | 'player_disconnected' | null;
}

// Player actions over the wire. Type strings are prefixed 'shi.' so the
// server's discriminated-union dispatcher cleanly separates them from
// Durak actions (which keep the original 'attack' / 'defend' / etc.).
export type ShitheadAction =
  // During setup: confirm which 3 of the 6 hand cards go face-up. Indexes
  // are into the player's current hand (3 distinct indexes).
  | {
      type: 'shi.setup.confirm';
      playerId: string;
      faceUpIndexes: readonly number[];
    }
  // Play 1+ cards of the same rank from hand or faceUp. Multiple-card
  // play is how 2× / 3× / 4× same-rank moves are expressed.
  | {
      type: 'shi.play';
      playerId: string;
      source: 'hand' | 'faceUp';
      cards: readonly Card[];
    }
  // Reveal and play a single face-down card. The player picks blind by
  // index (0, 1 or 2). If it's a legal play it lands on the pile;
  // otherwise the player picks up pile + that revealed card.
  | {
      type: 'shi.playFaceDown';
      playerId: string;
      faceDownIndex: number;
    }
  // 4-burst: any player can interrupt out of turn when the pile is empty
  // by laying down 1+ 4s from hand or faceUp. Multi-card bursts are
  // allowed so a player with all four 4s slams them down at once — the
  // engine then triggers the four-in-a-row burn and keeps their turn.
  //
  // 'handAndFaceUp' spends cards from BOTH piles in one move. It is only
  // legal once the draw deck is empty and only when the move actually
  // completes a burn — otherwise a player could dip into their face-up
  // cards while still holding a hand, which the normal rules forbid.
  | {
      type: 'shi.burst';
      playerId: string;
      source: 'hand' | 'faceUp' | 'handAndFaceUp';
      cards: readonly Card[];
    }
  // After playing a Joker, the player picks which other player swallows
  // the pile.
  | {
      type: 'shi.joker.choose';
      playerId: string;
      victimId: string;
    }
  // Manual take. Normally the engine auto-takes when the current player
  // holds no legal card; this action exists so the turn-timer fallback
  // and an eventual "give up" UI can force the same effect.
  | {
      type: 'shi.takePile';
      playerId: string;
    };

// What a single player sees over the wire. Other players' hands and
// faceDown stacks collapse to counts so we never leak hidden info.
export interface ShitheadPublicPlayer extends PublicPlayer {
  faceUp: Card[];
  faceDownCount: number;
}

export interface ShitheadClientGameState {
  roomId: string;
  phase: ShitheadPhase;
  selfHand: Card[];
  selfFaceUp: Card[];
  // Self's own face-down is hidden even from the owner until played.
  selfFaceDownCount: number;
  selfIndex: number;
  players: ShitheadPublicPlayer[];
  deckCount: number;
  pile: Card[];
  burnedCount: number;
  currentPlayerIdx: number;
  pendingJokerChooserId: string | null;
  quickChainEligible: {
    playerId: string;
    rank: Card['rank'];
  } | null;
  turnDeadline: number | null;
  outOrder: string[];
  loser: string | null;
  endReason: 'normal' | 'player_disconnected' | null;
  scoreboard: { [playerId: string]: PlayerScore };
}
