// Renders a playing card by referencing a symbol from the bundled SVG
// sprite at /cards/svg-cards.svg. The sprite is the public-domain David
// Bellot / Huub de Beer set — see /cards/LICENSE.txt for attribution.
//
// One round-trip fetch (~250 KB gzipped) on first render of any card;
// the browser caches the sprite and reuses it for every subsequent card,
// across all games and refreshes.

import type { Card, Suit } from '@shared/types';
import './CardSvg.css';

// Card aspect ratio in the source sprite (≈ 0.7:1, standard poker dim).
const W = 169.075;
const H = 244.640;

const SPRITE_URL = '/cards/svg-cards.svg';

const SUIT_NAME: Record<Suit, string> = {
  hearts: 'heart',
  diamonds: 'diamond',
  clubs: 'club',
  spades: 'spade',
};

// In the source sprite, ace = 1, jack/queen/king have textual names,
// and 2–10 use their numeric label. We pre-build a small map so the
// rest of the code reads the source data verbatim.
const RANK_NAME: Record<Card['rank'], string> = {
  '6': '6',
  '7': '7',
  '8': '8',
  '9': '9',
  '10': '10',
  J: 'jack',
  Q: 'queen',
  K: 'king',
  A: '1',
};

interface Props {
  card: Card;
  isTrump?: boolean;
  variant?: 'face' | 'small';
}

function CardSvg({ card, isTrump, variant = 'face' }: Props) {
  const symbolId = `${SUIT_NAME[card.suit]}_${RANK_NAME[card.rank]}`;
  const className = [
    'card-svg',
    variant === 'small' ? 'small' : '',
    isTrump ? 'trump' : '',
  ].filter(Boolean).join(' ');

  return (
    <svg
      className={className}
      viewBox={`0 0 ${W} ${H}`}
      xmlns="http://www.w3.org/2000/svg"
      aria-label={`${card.rank} of ${card.suit}`}
    >
      {/* Trump highlight: drawn under the card so it shows as a thick
          coloured frame around the white card border. */}
      {isTrump && (
        <rect
          x={2}
          y={2}
          width={W - 4}
          height={H - 4}
          rx={12}
          ry={12}
          className="trump-frame"
        />
      )}
      <use href={`${SPRITE_URL}#${symbolId}`} xlinkHref={`${SPRITE_URL}#${symbolId}`} />
    </svg>
  );
}

export default CardSvg;
