// Renders a playing card. First tries to load the matching artwork from
// /cards/bicycle/{rank}{suit}.svg (Chris Aguilar's Vectorized Playing
// Cards, LGPL/GPL); if the file is missing (the bundled deck only ships
// 6..A for Durak, not 2..5 or Jokers), falls back to a text-based card.
//
// First render of each unique card fetches the file (~50 KB gzipped);
// the browser caches it for every subsequent render, across all games.

import { useState } from 'react';
import type { Card, Suit } from '@shared/types';
import './CardSvg.css';

const SUIT_FILE: Record<Suit, string> = {
  clubs: 'C',
  diamonds: 'D',
  hearts: 'H',
  spades: 'S',
};

const SUIT_GLYPH: Record<Suit, string> = {
  clubs: '♣',
  diamonds: '♦',
  hearts: '♥',
  spades: '♠',
};

// Filenames follow {Rank}{Suit}.svg. 2..5 SVGs + joker artwork aren't
// in the bundled Bicycle deck — the text fallback covers those.
const RANK_FILE: Record<Card['rank'], string> = {
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  '6': '6',
  '7': '7',
  '8': '8',
  '9': '9',
  '10': '10',
  J: 'J',
  Q: 'Q',
  K: 'K',
  A: 'A',
  JOKER: 'JOKER',
};

interface Props {
  card: Card;
  isTrump?: boolean;
  variant?: 'face' | 'small';
}

function CardSvg({ card, isTrump, variant = 'face' }: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const isJoker = card.rank === 'JOKER';
  // Joker has no real SVG in the bundled deck — go straight to the text
  // fallback instead of triggering a 404.
  const useFallback = imgFailed || isJoker;

  const file = `${RANK_FILE[card.rank]}${SUIT_FILE[card.suit]}.svg`;
  const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
  const className = [
    'card-svg',
    variant === 'small' ? 'small' : '',
    isTrump ? 'trump' : '',
    useFallback ? `fallback ${isRed ? 'red' : 'black'}` : '',
  ].filter(Boolean).join(' ');

  return (
    <span className={className} aria-label={`${card.rank} of ${card.suit}`}>
      {useFallback ? (
        isJoker ? (
          <span className="card-fallback joker">
            <span className="card-fallback-joker-mark">★</span>
            <span className="card-fallback-joker-text">JOKER</span>
            <span className="card-fallback-joker-mark inverted">★</span>
          </span>
        ) : (
          <span className="card-fallback">
            <span className="card-fallback-corner top">
              <span>{card.rank}</span>
              <span>{SUIT_GLYPH[card.suit]}</span>
            </span>
            <span className="card-fallback-center">
              {SUIT_GLYPH[card.suit]}
            </span>
            <span className="card-fallback-corner bottom">
              <span>{card.rank}</span>
              <span>{SUIT_GLYPH[card.suit]}</span>
            </span>
          </span>
        )
      ) : (
        <img
          src={`/cards/bicycle/${file}`}
          alt=""
          draggable={false}
          onError={() => setImgFailed(true)}
        />
      )}
    </span>
  );
}

export default CardSvg;
