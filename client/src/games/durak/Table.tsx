import { useDroppable } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import type { Card, Suit } from '@shared/types';
import type { TablePair } from '@shared/games/durak';
import CardSvg from '../../components/CardSvg';
import DeckStack from '../../components/DeckStack';
import './Table.css';

interface Props {
  pairs: readonly TablePair[];
  trumpSuit: Suit;
  deckCount: number;
  trumpCard: Card | null;
  // Which drop targets to enable
  showAttackZone: boolean;
  showTransferZone: boolean;
  defendablePairIndices: readonly number[]; // pair indices the viewer can drop a defense on
}

function PairDroppable({
  pair,
  pairIndex,
  trumpSuit,
  canDefend,
}: {
  pair: TablePair;
  pairIndex: number;
  trumpSuit: Suit;
  canDefend: boolean;
}) {
  const id = `target:defend:${pairIndex}`;
  const { isOver, setNodeRef } = useDroppable({ id, disabled: !canDefend });
  return (
    <div
      ref={setNodeRef}
      className={`pair ${canDefend ? 'droppable' : ''} ${isOver ? 'drop-target-active' : ''}`}
    >
      <div className="attack-slot">
        <CardSvg card={pair.attack} isTrump={pair.attack.suit === trumpSuit} />
      </div>
      {pair.defense && (
        <div className="defense-overlay">
          <CardSvg card={pair.defense} isTrump={pair.defense.suit === trumpSuit} />
        </div>
      )}
    </div>
  );
}

function AttackZone() {
  const { t } = useTranslation();
  const { isOver, setNodeRef } = useDroppable({ id: 'target:attack' });
  return (
    <div ref={setNodeRef} className={`attack-zone ${isOver ? 'active' : ''}`}>
      {t('games.durak.attack_drop_zone')}
    </div>
  );
}

function TransferZone() {
  const { t } = useTranslation();
  const { isOver, setNodeRef } = useDroppable({ id: 'target:transfer' });
  return (
    <div ref={setNodeRef} className={`transfer-zone ${isOver ? 'active' : ''}`}>
      {t('games.durak.transfer_drop_zone')}
    </div>
  );
}

function Table({
  pairs,
  trumpSuit,
  deckCount,
  trumpCard,
  showAttackZone,
  showTransferZone,
  defendablePairIndices,
}: Props) {
  const defendableSet = new Set(defendablePairIndices);
  if (pairs.length === 0 && !showAttackZone) {
    return (
      <div className="table table-empty" aria-label="empty table">
        <DeckStack deckCount={deckCount} trumpCard={trumpCard} />
      </div>
    );
  }
  return (
    <div className="table">
      <DeckStack deckCount={deckCount} trumpCard={trumpCard} />
      {pairs.map((pair, i) => (
        <PairDroppable
          key={i}
          pair={pair}
          pairIndex={i}
          trumpSuit={trumpSuit}
          canDefend={defendableSet.has(i)}
        />
      ))}
      {showAttackZone && <AttackZone />}
      {showTransferZone && <TransferZone />}
    </div>
  );
}

export default Table;
