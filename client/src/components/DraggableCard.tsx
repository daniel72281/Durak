import { useDraggable } from '@dnd-kit/core';
import type { Card } from '@shared/types';
import { cardKey } from '../utils/cardKey';
import CardSvg from './CardSvg';
import './DraggableCard.css';

interface Props {
  card: Card;
  isTrump?: boolean;
  isLegal?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

function DraggableCard({ card, isTrump, isLegal, disabled, onClick }: Props) {
  const id = `card:${cardKey(card)}`;
  const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({
    id,
    disabled,
    data: { card },
  });
  const style: React.CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    opacity: isDragging ? 0.4 : undefined,
    cursor: disabled ? 'not-allowed' : 'grab',
    touchAction: 'none',
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`draggable-card-wrap ${isLegal ? 'legal' : ''}`}
      {...attributes}
      {...listeners}
      onClick={onClick}
    >
      <CardSvg card={card} isTrump={isTrump} />
    </div>
  );
}

export default DraggableCard;
