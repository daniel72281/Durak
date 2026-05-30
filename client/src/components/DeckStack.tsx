// Visual representation of the draw pile sitting on the felt. Shows a
// card back with the remaining count overlaid, plus the trump card
// peeking out from underneath at a slight angle (mirrors a physical
// Durak deal where the trump indicator is laid face-up under the deck).

import type { Card } from '@shared/types';
import CardSvg from './CardSvg';
import './DeckStack.css';

interface Props {
  deckCount: number;
  trumpCard: Card | null;
}

function DeckStack({ deckCount, trumpCard }: Props) {
  // Empty deck and no trump card left = nothing to show.
  if (deckCount === 0 && !trumpCard) return null;

  return (
    <div className="deck-stack" aria-label={`Deck: ${deckCount} cards remaining`}>
      {trumpCard && (
        <div className="deck-trump">
          {/* Intentionally NOT passing isTrump — the amber frame is
              reserved for trump cards in the player's hand. The deck
              trump is identified by position (sitting under the pile),
              not by chrome. */}
          <CardSvg card={trumpCard} />
        </div>
      )}
      {deckCount > 1 && (
        <div className="deck-pile">
          {/* Four real stacked layers (not pseudo-elements) so each
              has a visible dark edge — gives a "thick pile" look. */}
          <div className="deck-layer deck-layer--3" />
          <div className="deck-layer deck-layer--2" />
          <div className="deck-layer deck-layer--1" />
          <div className="deck-layer deck-layer--top">
            <span className="deck-count">{deckCount}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default DeckStack;
