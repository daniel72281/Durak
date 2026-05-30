// Converts the authoritative server-side GameState into the per-player
// ClientGameState that's safe to broadcast. Hides other players' hands
// (they're collapsed to handCount) so secrets never leak over the socket.

import type {
  ClientGameState,
  GameState,
  PlayerScore,
  PublicPlayer,
} from '../../shared/src/types';

export function filterGameState(
  state: GameState,
  viewerPlayerId: string,
  roomId: string,
  turnDeadline: number | null,
  scoreboard: ReadonlyMap<string, PlayerScore>,
  disconnectedIds: ReadonlySet<string>,
): ClientGameState {
  const selfIndex = state.players.findIndex((p) => p.id === viewerPlayerId);
  // -1 selfIndex is unusual (caller should have validated) but we still build
  // a sensible state — selfHand becomes empty.
  const selfHand = selfIndex >= 0 ? [...state.players[selfIndex]!.hand] : [];
  const publicPlayers: PublicPlayer[] = state.players.map((p) => ({
    id: p.id,
    nickname: p.nickname,
    handCount: p.hand.length,
    isOut: p.isOut,
    disconnected: disconnectedIds.has(p.id),
  }));
  const trumpCard = state.deck.length > 0 ? state.deck[0]! : null;
  const scoreboardObj: { [playerId: string]: PlayerScore } = {};
  for (const [pid, score] of scoreboard) {
    scoreboardObj[pid] = { ...score };
  }
  return {
    roomId,
    phase: state.phase,
    selfHand,
    selfIndex,
    players: publicPlayers,
    deckCount: state.deck.length,
    trumpCard,
    trumpSuit: state.trumpSuit,
    discardCount: state.discard.length,
    table: state.table.map((p) => ({ ...p })),
    attackerIndex: state.attackerIndex,
    defenderIndex: state.defenderIndex,
    defenderTaking: state.defenderTaking,
    defenderRoundStartHandSize: state.defenderRoundStartHandSize,
    passedPlayerIds: [...state.passedPlayerIds],
    turnDeadline,
    outOrder: [...state.outOrder],
    loser: state.loser,
    endReason: state.endReason,
    firstAttackerReason: state.firstAttackerReason,
    scoreboard: scoreboardObj,
  };
}
