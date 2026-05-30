import { useDroppable } from '@dnd-kit/core';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { Card, Suit, TablePair } from '@shared/types';
import { cardKey } from '../utils/legalMoves';
import CardSvg from './CardSvg';
import DeckStack from './DeckStack';
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
      {/* layoutId matches the one DraggableCard uses in the hand so
          framer-motion animates the same card flying from hand→table
          (and back, if the defender takes the pile). */}
      <motion.div
        className="attack-slot"
        layoutId={`card:${cardKey(pair.attack)}`}
      >
        <CardSvg card={pair.attack} isTrump={pair.attack.suit === trumpSuit} />
      </motion.div>
      <AnimatePresence>
        {pair.defense && (
          <motion.div
            className="defense-overlay"
            layoutId={`card:${cardKey(pair.defense)}`}
          >
            <CardSvg card={pair.defense} isTrump={pair.defense.suit === trumpSuit} />
          </motion.div>
        )}
      </AnimatePresence>
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
