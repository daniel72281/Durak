import { useDroppable } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import type { Suit, TablePair } from '@shared/types';
import TextCard from './TextCard';
import './Table.css';

interface Props {
  pairs: readonly TablePair[];
  trumpSuit: Suit;
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
        <TextCard card={pair.attack} isTrump={pair.attack.suit === trumpSuit} />
      </div>
      {pair.defense && (
        <div className="defense-overlay">
          <TextCard card={pair.defense} isTrump={pair.defense.suit === trumpSuit} />
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
      {t('game.attack_drop_zone')}
    </div>
  );
}

function TransferZone() {
  const { t } = useTranslation();
  const { isOver, setNodeRef } = useDroppable({ id: 'target:transfer' });
  return (
    <div ref={setNodeRef} className={`transfer-zone ${isOver ? 'active' : ''}`}>
      {t('game.transfer_drop_zone')}
    </div>
  );
}

function Table({
  pairs,
  trumpSuit,
  showAttackZone,
  showTransferZone,
  defendablePairIndices,
}: Props) {
  const defendableSet = new Set(defendablePairIndices);
  if (pairs.length === 0 && !showAttackZone) {
    return <div className="table table-empty" aria-label="empty table" />;
  }
  return (
    <div className="table">
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
