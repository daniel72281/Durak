import { useDraggable } from '@dnd-kit/core';
import { motion } from 'framer-motion';
import type { Card } from '@shared/types';
import { cardKey } from '../utils/legalMoves';
import CardSvg from './CardSvg';
import './DraggableCard.css';

interface Props {
  card: Card;
  isTrump?: boolean;
  isLegal?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

// Outer wrapper is a motion.div — owns layout/layoutId transitions so
// the same card flying from the deck-stack origin into the hand, or
// from the hand onto the table, gets a smooth animation. dnd-kit's
// drag transform lives on the inner div to avoid clashing with
// framer's own transform property.
function DraggableCard({ card, isTrump, isLegal, disabled, onClick }: Props) {
  const id = `card:${cardKey(card)}`;
  const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({
    id,
    disabled,
    data: { card },
  });
  const dragStyle: React.CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    opacity: isDragging ? 0.4 : undefined,
    cursor: disabled ? 'not-allowed' : 'grab',
    touchAction: 'none',
  };
  return (
    <motion.div
      layoutId={id}
      layout
      // On mount: slide in from roughly where the deck pile sits (top-
      // left of the felt) — looks like a dealer flicking the card over.
      initial={{ x: -260, y: -180, opacity: 0, scale: 0.55, rotate: -14 }}
      animate={{ x: 0, y: 0, opacity: 1, scale: 1, rotate: 0 }}
      transition={{
        type: 'spring',
        stiffness: 220,
        damping: 26,
        opacity: { duration: 0.18 },
        layout: { type: 'spring', stiffness: 260, damping: 28 },
      }}
    >
      <div
        ref={setNodeRef}
        style={dragStyle}
        className={`draggable-card-wrap ${isLegal ? 'legal' : ''}`}
        {...attributes}
        {...listeners}
        onClick={onClick}
      >
        <CardSvg card={card} isTrump={isTrump} />
      </div>
    </motion.div>
  );
}

export default DraggableCard;
