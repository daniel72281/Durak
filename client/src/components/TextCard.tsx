import type { Card, Suit } from '@shared/types';
import './TextCard.css';

const SUIT_SYMBOLS: Record<Suit, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
};

const RED_SUITS: Suit[] = ['hearts', 'diamonds'];

interface Props {
  card: Card;
  onClick?: () => void;
  disabled?: boolean;
  isTrump?: boolean;
  // 'face' = normal upright card, 'back' = hidden (opponent's hand), 'small' = compact
  variant?: 'face' | 'back' | 'small';
}

function CornerIndex({ rank, suit }: { rank: string; suit: string }) {
  return (
    <span className="corner-index" aria-hidden="true">
      <span className="rank">{rank}</span>
      <span className="suit">{suit}</span>
    </span>
  );
}

function TextCard({ card, onClick, disabled, isTrump, variant = 'face' }: Props) {
  if (variant === 'back') {
    return <span className="text-card text-card-back" aria-hidden="true">🂠</span>;
  }
  const red = RED_SUITS.includes(card.suit);
  const symbol = SUIT_SYMBOLS[card.suit];
  const classes = [
    'text-card',
    red ? 'red' : 'black',
    isTrump ? 'trump' : '',
    variant === 'small' ? 'small' : '',
    onClick ? 'clickable' : '',
  ].filter(Boolean).join(' ');

  const inner = (
    <>
      <span className="corner top-left">
        <CornerIndex rank={card.rank} suit={symbol} />
      </span>
      <span className="corner bottom-right">
        <CornerIndex rank={card.rank} suit={symbol} />
      </span>
      <span className="center-suit" aria-label={`${card.rank} of ${card.suit}`}>
        {symbol}
      </span>
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick} disabled={disabled}>
        {inner}
      </button>
    );
  }
  return <span className={classes}>{inner}</span>;
}

export default TextCard;
