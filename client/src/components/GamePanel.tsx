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
import type { Action, Card, ClientGameState } from '@shared/types';
import { tableIsFullyDefended } from '@shared/rules';
import Hand, { type SortMode } from './Hand';
import Table from './Table';
import PlayerList from './PlayerList';
import ActionButtons from './ActionButtons';
import TurnTimer from './TurnTimer';
import TextCard from './TextCard';
import SortToggle from './SortToggle';
import { computeLegalMoves, cardKey } from '../utils/legalMoves';
import './GamePanel.css';

interface Props {
  state: ClientGameState;
  onAction: (action: Action) => void;
  onShowError: (message: string) => void;
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

  // Click fallback: send the FIRST legal target's action.
  const handleCardClick = (card: Card) => {
    const entry = legalMoves.byCard.get(cardKey(card));
    if (!entry || entry.targets.length === 0) {
      onShowError(t('game.no_legal_action_for_card'));
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
      onShowError(t('game.no_legal_action_for_card'));
      return;
    }

    if (overId === 'target:attack') {
      const t1 = entry.targets.find((tg) => tg.kind === 'attack');
      if (!t1) return onShowError(t('game.no_legal_action_for_card'));
      onAction({ type: 'attack', playerId: myId, card });
      return;
    }
    if (overId === 'target:transfer') {
      const t1 = entry.targets.find((tg) => tg.kind === 'transfer');
      if (!t1) return onShowError(t('game.no_legal_action_for_card'));
      onAction({ type: 'transfer', playerId: myId, card });
      return;
    }
    if (overId.startsWith('target:defend:')) {
      const pairIndex = Number(overId.slice('target:defend:'.length));
      const t1 = entry.targets.find(
        (tg) => tg.kind === 'defend' && tg.pairIndex === pairIndex,
      );
      if (!t1) return onShowError(t('game.no_legal_action_for_card'));
      onAction({ type: 'defend', playerId: myId, pairIndex, card });
      return;
    }
  };

  // Action button visibility
  const canTake = isDefender && state.table.length > 0 && !state.defenderTaking && !isOut;
  const fullyDefended = tableIsFullyDefended(state.table);
  const haveIPassed = state.passedPlayerIds.includes(myId);
  const canPass =
    !isDefender &&
    state.table.length > 0 &&
    !isOut &&
    !haveIPassed &&
    (state.defenderTaking || fullyDefended);

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
          <span>{t('game.deck_count', { count: state.deckCount })}</span>
          {state.trumpCard && (
            <span className="trump-pill">
              {t('game.trump_label')}
              <TextCard card={state.trumpCard} isTrump variant="small" />
            </span>
          )}
          <TurnTimer deadline={state.turnDeadline} />
        </div>

        {(isDefender || state.selfIndex === state.attackerIndex) && (
          <div className="role-banner">
            {isDefender
              ? t('game.you_are_defender')
              : t('game.you_are_attacker', { defender: defenderName })}
          </div>
        )}

        <Table
          pairs={state.table}
          trumpSuit={state.trumpSuit}
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
              <span className="hand-label">{t('game.your_hand')}</span>
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
