import { useEffect, useMemo, useRef, useState } from 'react';
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
import SortToggle from './SortToggle';
import TakeFlightOverlay from './TakeFlightOverlay';
import { computeLegalMoves, cardKey } from '../utils/legalMoves';
import './GamePanel.css';

interface TakeFlightSpec {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  count: number;
  id: number;
}

interface Props {
  state: ClientGameState;
  onAction: (action: Action) => void;
  onShowError: (message: string) => void;
}

function GamePanel({ state, onAction, onShowError }: Props) {
  const { t } = useTranslation();
  const [sortMode, setSortMode] = useState<SortMode>('rank');

  // Track previous state so we can detect "defender just took the pile"
  // and play a ghost-card trail flying from the table to their chip.
  // We only fire this for OTHER players' takes — when the local player
  // takes, the existing layoutId animation on each card already shows
  // the cards flying back to their hand.
  const prevStateRef = useRef<ClientGameState | null>(null);
  const [takeFlight, setTakeFlight] = useState<TakeFlightSpec | null>(null);

  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    if (!prev) return;

    const tookPile =
      prev.table.length > 0 &&
      state.table.length === 0 &&
      prev.defenderTaking;
    if (!tookPile) return;

    const taker = state.players[prev.defenderIndex];
    if (!taker) return;
    const selfId = state.players[state.selfIndex]?.id;
    if (taker.id === selfId) return; // local defender → layoutId handles it

    const tableEl = document.querySelector('.table');
    const chipEl = document.querySelector(
      `[data-player-id="${taker.id}"]`,
    );
    if (!tableEl || !chipEl) return;

    const tableRect = tableEl.getBoundingClientRect();
    const chipRect = chipEl.getBoundingClientRect();
    const cardCount = prev.table.reduce(
      (n, p) => n + (p.defense ? 2 : 1),
      0,
    );

    setTakeFlight({
      fromX: tableRect.left + tableRect.width / 2,
      fromY: tableRect.top + tableRect.height / 2,
      toX: chipRect.left + chipRect.width / 2,
      toY: chipRect.top + chipRect.height / 2,
      count: cardCount,
      id: Date.now(),
    });
  }, [state]);

  // Synchronously detect "I just took the pile" so the freshly-added
  // hand cards mount with fromTable=true → their layoutId animation flies
  // them from the table position instead of dealing them from the deck.
  // Must happen during render (not useEffect) so the cards' very first
  // mount sees the correct prop. prevStateRef is still the previous
  // render's state until the useEffect above commits.
  const prevForTakeSync = prevStateRef.current;
  let justTakenKeys: ReadonlySet<string> | undefined;
  if (
    prevForTakeSync &&
    prevForTakeSync !== state &&
    prevForTakeSync.table.length > 0 &&
    state.table.length === 0 &&
    prevForTakeSync.defenderTaking
  ) {
    const taker = state.players[prevForTakeSync.defenderIndex];
    const selfId = state.players[state.selfIndex]?.id;
    if (taker && taker.id === selfId) {
      justTakenKeys = new Set(
        prevForTakeSync.table.flatMap((p) =>
          p.defense
            ? [cardKey(p.attack), cardKey(p.defense)]
            : [cardKey(p.attack)],
        ),
      );
    }
  }

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
          <TurnTimer deadline={state.turnDeadline} />
        </div>

        {!isOut && (() => {
          // Banner priority:
          //   1. defender → "Defend!"
          //   2. official attacker on an empty table → "Attack X"
          //   3. any non-defender who already passed but the round is still
          //      open → "Waiting for other players…"
          //   4. any non-defender with a legal card → "You can throw in on X"
          //   (otherwise no banner — nothing useful to say)
          if (isDefender) {
            return <div className="role-banner">{t('game.you_are_defender')}</div>;
          }
          const isOfficialAttacker = state.selfIndex === state.attackerIndex;
          if (isOfficialAttacker && state.table.length === 0) {
            return (
              <div className="role-banner">
                {t('game.you_are_attacker', { defender: defenderName })}
              </div>
            );
          }
          if (haveIPassed && state.table.length > 0) {
            return (
              <div className="role-banner role-banner--muted">
                {t('game.waiting_for_others')}
              </div>
            );
          }
          if (legalMoves.anyLegal && state.table.length > 0) {
            return (
              <div className="role-banner">
                {t('game.you_can_throw_in', { defender: defenderName })}
              </div>
            );
          }
          return null;
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
              fromTableKeys={justTakenKeys}
            />
          </div>
        )}
      </div>
      {takeFlight && (
        <TakeFlightOverlay
          key={takeFlight.id}
          fromX={takeFlight.fromX}
          fromY={takeFlight.fromY}
          toX={takeFlight.toX}
          toY={takeFlight.toY}
          count={takeFlight.count}
          onDone={() => setTakeFlight(null)}
        />
      )}
    </DndContext>
  );
}

export default GamePanel;
