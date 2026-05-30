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
  // 0-based position in the deal — staggers the entrance so a fresh
  // hand visually arrives one card at a time. ~220 ms per step + a soft
  // spring makes the whole 6-card deal take roughly 2 seconds.
  dealIndex?: number;
  // True when this card just moved into the hand FROM the table (e.g.
  // the defender took the pile). In that case we skip the "fly from the
  // deck" initial so framer-motion's layoutId animation kicks in and
  // flies it from its table position instead.
  fromTable?: boolean;
}

// Outer motion.div owns both the deal-in (initial→animate) and the
// hand↔table shared transition (layoutId). Going back to framer-motion's
// built-in initial/animate props turned out to be the most reliable
// way to stagger; mixing in WAAPI / animation-controls broke the
// timing handshake with the layoutId animation.
//
// The -320 / -240 offset is roughly where the deck pile sits on a
// desktop viewport — not a measured value, but visually it reads as
// "card flicks off the top-left of the felt".
//
// dnd-kit's drag transform stays on a plain inner div so it doesn't
// clash with framer's own transform property.
function DraggableCard({
  card,
  isTrump,
  isLegal,
  disabled,
  onClick,
  dealIndex = 0,
  fromTable = false,
}: Props) {
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
      // fromTable=true means this card just appeared in the hand because
      // the defender took the pile — let framer's layoutId animate it
      // from its previous table position instead of forcing a deck deal.
      initial={
        fromTable
          ? false
          : { x: -320, y: -240, opacity: 0, scale: 0.5, rotate: -14 }
      }
      animate={{ x: 0, y: 0, opacity: 1, scale: 1, rotate: 0 }}
      transition={
        fromTable
          ? { layout: { type: 'spring', stiffness: 180, damping: 22 } }
          : {
              type: 'spring',
              stiffness: 100,
              damping: 18,
              delay: dealIndex * 0.22,
              opacity: { duration: 0.3, delay: dealIndex * 0.22 },
              layout: { type: 'spring', stiffness: 260, damping: 28 },
            }
      }
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
