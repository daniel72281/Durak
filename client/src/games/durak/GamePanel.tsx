import { useMemo, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import type { Card } from '@shared/types';
import type { Action, ClientGameState } from '@shared/games/durak';
import { tableIsFullyDefended } from '@shared/games/durak';
import Hand, { type SortMode } from './Hand';
import Table from './Table';
import PlayerList from '../../components/PlayerList';
import ActionButtons from './ActionButtons';
import TurnTimer from '../../components/TurnTimer';
import SortToggle from './SortToggle';
import { computeLegalMoves, cardKey } from './legalMoves';
import './GamePanel.css';

interface Props {
  state: ClientGameState;
  onAction: (action: Action) => void;
  // Optional durationMs lets a caller pin the message on screen longer
  // than the default — used for the defend-vs-transfer disambiguation
  // hint where players need a moment to actually read the choice.
  onShowError: (message: string, durationMs?: number) => void;
}

function GamePanel({ state, onAction, onShowError }: Props) {
  const { t } = useTranslation();
  const [sortMode, setSortMode] = useState<SortMode>('rank');

  const self = state.players[state.selfIndex];
  const myId = self?.id ?? '';
  const isDefender = state.selfIndex === state.defenderIndex;
  const isOut = self?.isOut ?? false;

  const legalMoves = useMemo(() => computeLegalMoves(state), [state]);

  // dnd-kit sensors: small distance threshold so clicks still work alongside drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );

  // Click fallback: send the FIRST legal target's action — UNLESS the
  // card has both a defend and a transfer target, in which case clicking
  // would silently pick one for the player. Force them to drag in that
  // case so the choice (defend on the attack vs. transfer to next seat)
  // stays explicit.
  const handleCardClick = (card: Card) => {
    const entry = legalMoves.byCard.get(cardKey(card));
    if (!entry || entry.targets.length === 0) {
      onShowError(t('games.durak.no_legal_action_for_card'));
      return;
    }
    const canDefend = entry.targets.some((tg) => tg.kind === 'defend');
    const canTransfer = entry.targets.some((tg) => tg.kind === 'transfer');
    if (canDefend && canTransfer) {
      onShowError(t('games.durak.ambiguous_defend_transfer'), 6000);
      return;
    }
    onAction(actionForTarget(card, entry.targets[0]!));
  };

  function actionForTarget(card: Card, target: { kind: string; pairIndex?: number }): Action {
    if (target.kind === 'attack') return { type: 'attack', playerId: myId, card };
    if (target.kind === 'transfer') return { type: 'transfer', playerId: myId, card };
    return { type: 'defend', playerId: myId, pairIndex: target.pairIndex!, card };
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (!activeId.startsWith('card:')) return;
    const card = active.data.current?.card as Card | undefined;
    if (!card) return;

    const entry = legalMoves.byCard.get(cardKey(card));
    if (!entry) {
      onShowError(t('games.durak.no_legal_action_for_card'));
      return;
    }

    if (overId === 'target:attack') {
      const t1 = entry.targets.find((tg) => tg.kind === 'attack');
      if (!t1) return onShowError(t('games.durak.no_legal_action_for_card'));
      onAction({ type: 'attack', playerId: myId, card });
      return;
    }
    if (overId === 'target:transfer') {
      const t1 = entry.targets.find((tg) => tg.kind === 'transfer');
      if (!t1) return onShowError(t('games.durak.no_legal_action_for_card'));
      onAction({ type: 'transfer', playerId: myId, card });
      return;
    }
    if (overId.startsWith('target:defend:')) {
      const pairIndex = Number(overId.slice('target:defend:'.length));
      const t1 = entry.targets.find(
        (tg) => tg.kind === 'defend' && tg.pairIndex === pairIndex,
      );
      if (!t1) return onShowError(t('games.durak.no_legal_action_for_card'));
      onAction({ type: 'defend', playerId: myId, pairIndex, card });
      return;
    }
  };

  // Action button visibility
  const fullyDefended = tableIsFullyDefended(state.table);
  // Hide "take" once every attack has been answered — taking after a
  // successful defense isn't a real choice in the rules.
  const canTake =
    isDefender &&
    state.table.length > 0 &&
    !state.defenderTaking &&
    !fullyDefended &&
    !isOut;
  const haveIPassed = state.passedPlayerIds.includes(myId);
  // Hide "done attacking" for non-defenders whose hand can't throw in any
  // card — the server treats them as auto-passed, so showing the button
  // would be empty ceremony. (anyLegal in throw-in phase = has throw-in,
  // since defend/transfer aren't options for a non-defender.)
  const canPass =
    !isDefender &&
    state.table.length > 0 &&
    !isOut &&
    !haveIPassed &&
    (state.defenderTaking || fullyDefended) &&
    legalMoves.anyLegal;

  // Drop-zone visibility
  // Any card legal as attack/throw-in → show attack zone
  const showAttackZone = Array.from(legalMoves.byCard.values()).some((m) =>
    m.targets.some((tg) => tg.kind === 'attack'),
  );
  const showTransferZone = Array.from(legalMoves.byCard.values()).some((m) =>
    m.targets.some((tg) => tg.kind === 'transfer'),
  );
  const defendablePairIndices = new Set<number>();
  for (const m of legalMoves.byCard.values()) {
    for (const tg of m.targets) {
      if (tg.kind === 'defend') defendablePairIndices.add(tg.pairIndex);
    }
  }

  const defenderName = state.players[state.defenderIndex]?.nickname ?? '?';

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="game-panel">
        <PlayerList
          players={state.players}
          attackerIndex={state.attackerIndex}
          defenderIndex={state.defenderIndex}
          selfIndex={state.selfIndex}
          defenderTaking={state.defenderTaking}
          passedPlayerIds={state.passedPlayerIds}
        />

        <div className="game-meta">
          <TurnTimer deadline={state.turnDeadline} />
        </div>

        {(() => {
          // Banner priority — picked in order so the most actionable
          // message wins. The last branch is a spectator-style message
          // shown to everyone who isn't actively attacking/defending,
          // so the current attacker/defender pair is always visible
          // (also handles `isOut` and post-transfer states naturally,
          // since attackerIndex/defenderIndex update in the engine).
          if (isDefender) {
            return <div className="role-banner">{t('games.durak.you_are_defender')}</div>;
          }
          const isOfficialAttacker = state.selfIndex === state.attackerIndex;
          if (isOfficialAttacker && !isOut) {
            return (
              <div className="role-banner">
                {t('games.durak.you_are_attacker', { defender: defenderName })}
              </div>
            );
          }
          if (haveIPassed && state.table.length > 0) {
            return (
              <div className="role-banner role-banner--muted">
                {t('games.durak.waiting_for_others')}
              </div>
            );
          }
          if (!isOut && legalMoves.anyLegal && state.table.length > 0) {
            return (
              <div className="role-banner">
                {t('games.durak.you_can_throw_in', { defender: defenderName })}
              </div>
            );
          }
          // Spectator fallback — show who is currently attacking whom.
          const attackerName =
            state.players[state.attackerIndex]?.nickname ?? '?';
          return (
            <div className="role-banner role-banner--muted">
              {t('games.durak.spectator_attacks', {
                attacker: attackerName,
                defender: defenderName,
              })}
            </div>
          );
        })()}

        <Table
          pairs={state.table}
          trumpSuit={state.trumpSuit}
          deckCount={state.deckCount}
          trumpCard={state.trumpCard}
          showAttackZone={showAttackZone}
          showTransferZone={showTransferZone}
          defendablePairIndices={Array.from(defendablePairIndices)}
        />

        <ActionButtons
          canTake={canTake}
          canPass={canPass}
          onTake={() => onAction({ type: 'take', playerId: myId })}
          onPass={() => onAction({ type: 'pass', playerId: myId })}
        />

        {state.selfHand.length > 0 && (
          <div className="hand-section">
            <div className="hand-section-header">
              <span className="hand-label">{t('games.durak.your_hand')}</span>
              <SortToggle
                mode={sortMode}
                onToggle={() =>
                  setSortMode((m) => (m === 'rank' ? 'suit' : 'rank'))
                }
              />
            </div>
            <Hand
              cards={state.selfHand}
              trumpSuit={state.trumpSuit}
              legalMoves={legalMoves}
              sortMode={sortMode}
              onCardClick={handleCardClick}
            />
          </div>
        )}
      </div>
    </DndContext>
  );
}

export default GamePanel;
