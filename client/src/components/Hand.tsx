import { AnimatePresence } from 'framer-motion';
import type { Card, Suit } from '@shared/types';
import { rankValue } from '@shared/rules';
import DraggableCard from './DraggableCard';
import { cardKey, type LegalMoves } from '../utils/legalMoves';
import './Hand.css';

export type SortMode = 'rank' | 'suit';

interface Props {
  cards: readonly Card[];
  trumpSuit: Suit;
  legalMoves: LegalMoves;
  sortMode: SortMode;
  onCardClick: (card: Card) => void;
}

const SUIT_ORDER: Record<Suit, number> = {
  hearts: 0, diamonds: 1, clubs: 2, spades: 3,
};

function sortByRank(cards: readonly Card[], trumpSuit: Suit): Card[] {
  const cmp = (a: Card, b: Card): number => {
    const rd = rankValue(a.rank) - rankValue(b.rank);
    if (rd !== 0) return rd;
    return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
  };
  const trumps = cards.filter((c) => c.suit === trumpSuit).slice().sort(cmp);
  const others = cards.filter((c) => c.suit !== trumpSuit).slice().sort(cmp);
  return [...others, ...trumps];
}

function sortBySuit(cards: readonly Card[], trumpSuit: Suit): Card[] {
  // Non-trump suits grouped (each suit ascending), then trump on the right.
  const nonTrumpSuits = (['hearts', 'diamonds', 'clubs', 'spades'] as Suit[]).filter(
    (s) => s !== trumpSuit,
  );
  const grouped: Card[] = [];
  for (const suit of nonTrumpSuits) {
    const inSuit = cards
      .filter((c) => c.suit === suit)
      .slice()
      .sort((a, b) => rankValue(a.rank) - rankValue(b.rank));
    grouped.push(...inSuit);
  }
  const trumps = cards
    .filter((c) => c.suit === trumpSuit)
    .slice()
    .sort((a, b) => rankValue(a.rank) - rankValue(b.rank));
  return [...grouped, ...trumps];
}

function Hand({ cards, trumpSuit, legalMoves, sortMode, onCardClick }: Props) {
  const sorted = sortMode === 'suit'
    ? sortBySuit(cards, trumpSuit)
    : sortByRank(cards, trumpSuit);

  return (
    <div className="hand">
      {/* AnimatePresence keeps unmounting cards alive long enough for
          their layoutId animation to play out (e.g., when a card is
          played to the table and re-mounts there). */}
      <AnimatePresence>
        {sorted.map((card) => {
          const key = cardKey(card);
          const isLegal = legalMoves.byCard.has(key);
          return (
            <DraggableCard
              key={key}
              card={card}
              isTrump={card.suit === trumpSuit}
              isLegal={isLegal}
              onClick={() => onCardClick(card)}
            />
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export default Hand;
