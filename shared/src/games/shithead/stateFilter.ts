// Converts the authoritative server-side ShitheadGameState into the
// per-player ShitheadClientGameState that's safe to broadcast. Hides:
//   - Other players' hand contents (collapsed to handCount via PublicPlayer)
//   - Every player's faceDown contents (collapsed to faceDownCount)
//   - The viewer's OWN faceDown is still hidden — Shithead's whole point is
//     that those bottom cards are blind reveals.
//   - The draw deck contents (collapsed to deckCount).
//
// faceUp piles are public — they sit visibly on top of each player's
// face-down stack — so they ship in full.

import type { PlayerScore, PublicPlayer } from '../../types';
import type {
  ShitheadClientGameState,
  ShitheadGameState,
  ShitheadPublicPlayer,
} from './types';

export function filterGameState(
  state: ShitheadGameState,
  viewerPlayerId: string,
  roomId: string,
  turnDeadline: number | null,
  scoreboard: ReadonlyMap<string, PlayerScore>,
  disconnectedIds: ReadonlySet<string>,
): ShitheadClientGameState {
  const selfIndex = state.players.findIndex((p) => p.id === viewerPlayerId);
  const self = selfIndex >= 0 ? state.players[selfIndex]! : null;
  const publicPlayers: ShitheadPublicPlayer[] = state.players.map((p) => {
    const base: PublicPlayer = {
      id: p.id,
      nickname: p.nickname,
      handCount: p.hand.length,
      isOut: p.isOut,
      disconnected: disconnectedIds.has(p.id),
    };
    return {
      ...base,
      faceUp: p.faceUp.map((c) => ({ ...c })),
      faceDownCount: p.faceDown.length,
    };
  });
  const scoreboardObj: { [playerId: string]: PlayerScore } = {};
  for (const [pid, score] of scoreboard) {
    scoreboardObj[pid] = { ...score };
  }
  return {
    roomId,
    phase: state.phase,
    selfHand: self ? [...self.hand] : [],
    selfFaceUp: self ? [...self.faceUp] : [],
    selfFaceDownCount: self ? self.faceDown.length : 0,
    selfIndex,
    players: publicPlayers,
    deckCount: state.deck.length,
    pile: state.pile.map((c) => ({ ...c })),
    burnedCount: state.burnedPile.length,
    currentPlayerIdx: state.currentPlayerIdx,
    pendingJokerChooserId: state.pendingJokerChooserId,
    quickChainEligible: state.quickChainEligible
      ? { ...state.quickChainEligible }
      : null,
    turnDeadline,
    outOrder: [...state.outOrder],
    loser: state.loser,
    endReason: state.endReason,
    scoreboard: scoreboardObj,
  };
}
