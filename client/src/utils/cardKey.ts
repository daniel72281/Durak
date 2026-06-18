// Stable string id for a Card, used as the dnd-kit draggable/droppable id
// and as the key in maps like LegalMoves.byCard. Generic — works for any
// card game's deck so it can live outside games/<game>/.

import type { Card } from '@shared/types';

export function cardKey(card: Card): string {
  return `${card.suit}-${card.rank}`;
}
