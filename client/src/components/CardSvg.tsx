// Inline-SVG playing card. Renders a clean, crisp card face with rank+suit
// corner indices (top-left + bottom-right rotated, like real cards) and a
// central content area: pip pattern for number cards (6–10), a large letter
// over the suit for face cards (J/Q/K), and a single big suit for the Ace.
//
// Visual-only — interactions (click, drag) are handled by the wrapper
// component (DraggableCard / Table). All sizing is driven by CSS via
// `width` / `height` on the .card-svg element; the viewBox stays fixed so
// the layout scales cleanly.

import type { Card, Suit } from '@shared/types';
import './CardSvg.css';

const W = 60;
const H = 84;

const SUIT_CHAR: Record<Suit, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
};
const RED_SUITS: ReadonlySet<Suit> = new Set(['hearts', 'diamonds']);

// Pip positions as (fx, fy) fractions of the inner pip area. The standard
// "real card" layouts: 6 = 3 rows of 2; 7 = 6 + center; 8 = 4 rows of 2;
// 9 = 8 + center; 10 = 4 rows of 2 + 2 middle stagger.
const PIP_AREA = {
  x0: 8,
  x1: W - 8,
  y0: 14,
  y1: H - 14,
};
const PIPS: Record<string, [number, number][]> = {
  '6': [
    [0.0, 0.0], [1.0, 0.0],
    [0.0, 0.5], [1.0, 0.5],
    [0.0, 1.0], [1.0, 1.0],
  ],
  '7': [
    [0.0, 0.0], [1.0, 0.0],
    [0.5, 0.25],
    [0.0, 0.5], [1.0, 0.5],
    [0.0, 1.0], [1.0, 1.0],
  ],
  '8': [
    [0.0, 0.0], [1.0, 0.0],
    [0.0, 0.34], [1.0, 0.34],
    [0.0, 0.66], [1.0, 0.66],
    [0.0, 1.0], [1.0, 1.0],
  ],
  '9': [
    [0.0, 0.0], [1.0, 0.0],
    [0.0, 0.33], [1.0, 0.33],
    [0.5, 0.5],
    [0.0, 0.67], [1.0, 0.67],
    [0.0, 1.0], [1.0, 1.0],
  ],
  '10': [
    [0.0, 0.0], [1.0, 0.0],
    [0.5, 0.18],
    [0.0, 0.34], [1.0, 0.34],
    [0.0, 0.66], [1.0, 0.66],
    [0.5, 0.82],
    [0.0, 1.0], [1.0, 1.0],
  ],
};

interface Props {
  card: Card;
  isTrump?: boolean;
  variant?: 'face' | 'small';
}

function CardSvg({ card, isTrump, variant = 'face' }: Props) {
  const red = RED_SUITS.has(card.suit);
  const symbol = SUIT_CHAR[card.suit];
  const className = [
    'card-svg',
    red ? 'red' : 'black',
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
      {/* Card body */}
      <rect
        x={0.5}
        y={0.5}
        width={W - 1}
        height={H - 1}
        rx={5}
        ry={5}
        className="card-body"
      />

      {/* Top-left corner index */}
      <g className="corner-index">
        <text x={6} y={13} fontSize={11} fontWeight="700" textAnchor="middle">{card.rank}</text>
        <text x={6} y={23} fontSize={9} textAnchor="middle">{symbol}</text>
      </g>

      {/* Bottom-right corner index (rotated 180° so it reads upright when
          another player picks the card up — matches real playing cards) */}
      <g className="corner-index" transform={`rotate(180 ${W - 6} ${H - 13})`}>
        <text x={W - 6} y={H - 13} fontSize={11} fontWeight="700" textAnchor="middle">{card.rank}</text>
        <text x={W - 6} y={H - 23} fontSize={9} textAnchor="middle">{symbol}</text>
      </g>

      {/* Center */}
      {renderCenter(card, symbol)}
    </svg>
  );
}

function renderCenter(card: Card, symbol: string) {
  const rank = card.rank;
  if (rank === 'A') {
    return (
      <text
        x={W / 2}
        y={H / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={32}
        className="center-suit"
      >
        {symbol}
      </text>
    );
  }
  if (rank === 'J' || rank === 'Q' || rank === 'K') {
    return (
      <g>
        <text
          x={W / 2}
          y={H / 2 - 4}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={24}
          fontWeight="700"
          fontFamily="serif"
          className="face-letter"
        >
          {rank}
        </text>
        <text
          x={W / 2}
          y={H / 2 + 14}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={14}
          className="center-suit"
        >
          {symbol}
        </text>
      </g>
    );
  }

  const pips = PIPS[rank];
  if (!pips) return null;
  const innerW = PIP_AREA.x1 - PIP_AREA.x0;
  const innerH = PIP_AREA.y1 - PIP_AREA.y0;
  return pips.map(([fx, fy], i) => {
    const x = PIP_AREA.x0 + fx * innerW;
    const y = PIP_AREA.y0 + fy * innerH;
    // Pips in the lower half are flipped 180° on real playing cards.
    const transform = fy > 0.5 ? `rotate(180 ${x} ${y})` : undefined;
    return (
      <text
        key={i}
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={13}
        transform={transform}
        className="pip"
      >
        {symbol}
      </text>
    );
  });
}

export default CardSvg;
