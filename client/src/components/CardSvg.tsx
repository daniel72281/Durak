// Renders a playing card by loading an individual SVG file from
// /cards/bicycle/. Artwork is Chris Aguilar's Vectorized Playing Cards
// (LGPL/GPL) — a Bicycle-style deck. See /cards/LICENSE.txt for credit.
//
// First render of each unique card fetches the file (~50 KB gzipped);
// the browser caches it for every subsequent render, across all games.

import type { Card, Suit } from '@shared/types';
import './CardSvg.css';

const SUIT_FILE: Record<Suit, string> = {
  clubs: 'C',
  diamonds: 'D',
  hearts: 'H',
  spades: 'S',
};

// Filenames follow {Rank}{Suit}.svg. Ranks 2–10 use their numeric label,
// face cards use J/Q/K, ace = A. Only 6+ are bundled (Durak uses 36 cards).
const RANK_FILE: Record<Card['rank'], string> = {
  '6': '6',
  '7': '7',
  '8': '8',
  '9': '9',
  '10': '10',
  J: 'J',
  Q: 'Q',
  K: 'K',
  A: 'A',
};

interface Props {
  card: Card;
  isTrump?: boolean;
  variant?: 'face' | 'small';
}

function CardSvg({ card, isTrump, variant = 'face' }: Props) {
  const file = `${RANK_FILE[card.rank]}${SUIT_FILE[card.suit]}.svg`;
  const className = [
    'card-svg',
    variant === 'small' ? 'small' : '',
    isTrump ? 'trump' : '',
  ].filter(Boolean).join(' ');

  return (
    <span className={className} aria-label={`${card.rank} of ${card.suit}`}>
      <img src={`/cards/bicycle/${file}`} alt="" draggable={false} />
    </span>
  );
}

export default CardSvg;
