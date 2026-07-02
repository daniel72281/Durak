// The Shithead game panel. Splits its render across three phases:
//   - setup   pick 3 of your 6 hand cards to flip face-up; everybody
//             confirms before play starts
//   - playing the normal turn loop with hand / faceUp / faceDown phases
//             and the magic-card effects
//   - finished show the shithead (loser)
//
// Visual model: a casino-green "felt table". Each opponent occupies a
// spot around the rim with their face-down stack (always visible) and
// face-up cards layered on top. The communal piles (deck / pile /
// burned) sit in the center. The self area at the bottom mirrors the
// opponent tableau — face-down + face-up stacks on the table, hand
// fanned below as the interactive row.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { Card } from '@shared/types';
import type {
  ShitheadAction,
  ShitheadClientGameState,
  ShitheadPublicPlayer,
} from '@shared/games/shithead';
import { pileHasFourInARow } from '@shared/games/shithead/rules';
import CardSvg from '../../components/CardSvg';
import './GamePanel.css';

interface Props {
  state: ShitheadClientGameState;
  onAction: (action: ShitheadAction) => void;
  onShowError: (text: string) => void;
}

// Stable identifier for a card so React keys behave under reorders.
function cardKey(c: Card): string {
  return `${c.rank}-${c.suit}`;
}

// Sort order shared by hand + faceUp displays: low-to-high by rank,
// with Joker placed at the very end. Suits break ties deterministically.
const RANK_ORDER: Record<Card['rank'], number> = {
  '2': 0, '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6,
  '9': 7, '10': 8, J: 9, Q: 10, K: 11, A: 12, JOKER: 13,
};
const SUIT_ORDER: Record<Card['suit'], number> = {
  clubs: 0, diamonds: 1, hearts: 2, spades: 3,
};
function sortCards(cards: readonly Card[]): Card[] {
  return cards.slice().sort((a, b) => {
    const r = RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
    if (r !== 0) return r;
    return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
  });
}

// Build the auto burn-burst option from a source of cards: find any
// rank where (cards of that rank you own) + (matching-rank run at the
// top of the pile) >= 4. Ranks '2' and '3' are skipped on purpose —
// they're "magic" cards (reset + mirror) that players almost always
// want to keep for their effects, and auto-burning them was a common
// regret. Among the remaining ranks, prefers the lowest so the player
// spends the least valuable cards. Returns null when no rank can
// complete a four-in-a-row without using 2s or 3s — in that case the
// player can still burn via the manual-selection override
// (selectionWouldBurn).
function findBurnBurst(
  source: readonly Card[],
  pile: readonly Card[],
): Card[] | null {
  if (source.length === 0) return null;
  const topRank = pile.length > 0 ? pile[pile.length - 1]!.rank : null;
  let topRun = 0;
  if (topRank) {
    for (let i = pile.length - 1; i >= 0; i--) {
      if (pile[i]!.rank === topRank) topRun++;
      else break;
    }
  }
  const groups = new Map<Card['rank'], Card[]>();
  for (const c of source) {
    const g = groups.get(c.rank);
    if (g) g.push(c);
    else groups.set(c.rank, [c]);
  }
  let best: { rank: Card['rank']; cards: Card[] } | null = null;
  for (const [rank, group] of groups) {
    if (rank === '2' || rank === '3') continue;
    const run = topRank === rank ? topRun : 0;
    if (group.length + run < 4) continue;
    if (best === null || RANK_ORDER[rank] < RANK_ORDER[best.rank]) {
      best = { rank, cards: group };
    }
  }
  return best?.cards ?? null;
}

// Manual-selection override for burn-burst. When the player explicitly
// picks cards (via the existing toggleHand/toggleFaceUp UI), the burn
// button uses THIS check instead of the auto picker — letting them
// burn ranks the auto path skips on purpose (e.g. deliberately burning
// 2s/3s) or high-value ranks they prefer over the auto choice.
function selectionWouldBurn(
  selected: readonly Card[],
  pile: readonly Card[],
): boolean {
  if (selected.length === 0) return false;
  const rank = selected[0]!.rank;
  for (const c of selected) {
    if (c.rank !== rank) return false;
  }
  return pileHasFourInARow([...pile, ...selected]);
}

// How many cards of the SAME literal rank sit at the top of the pile?
function topRunCount(pile: readonly Card[]): number {
  if (pile.length === 0) return 0;
  const topRank = pile[pile.length - 1]!.rank;
  let count = 1;
  for (let i = pile.length - 2; i >= 0; i--) {
    if (pile[i]!.rank !== topRank) break;
    count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Visual primitives: card back + the four kinds of card piles.
// ---------------------------------------------------------------------------

function CardBack({ size = 'normal' }: { size?: 'normal' | 'small' | 'tiny' }) {
  const cls = size === 'normal' ? 'shi-cardback' : `shi-cardback ${size}`;
  return <span className={cls} aria-hidden="true" />;
}

// Visual stack representing the deck draw pile. Renders up to 3 layered
// card backs (depth illusion) with the live count badge in the corner.
function DeckStack({ count }: { count: number }) {
  if (count === 0) {
    return (
      <div className="shi-deck-empty">
        <span>—</span>
      </div>
    );
  }
  const layers = Math.min(3, count);
  return (
    <div className="shi-deck-stack">
      {Array.from({ length: layers }).map((_, i) => (
        <CardBack key={i} />
      ))}
      <span className="shi-count-badge">{count}</span>
    </div>
  );
}

// Pile stack: top card shown face-up, with offset "edges" peeking from
// underneath to convey depth (capped at 2 visible edges).
function PileStack({ pile }: { pile: readonly Card[] }) {
  if (pile.length === 0) return null;
  const top = pile[pile.length - 1]!;
  // Use the cardKey of the top card as a stable React key so the
  // cardLand animation only fires when the top actually changes.
  const edges = Math.min(2, pile.length - 1);
  return (
    <div className="shi-pile-stack">
      {Array.from({ length: edges }).map((_, i) => (
        <div
          key={`edge-${i}`}
          className="shi-pile-edge"
          style={{ transform: `translate(${-(i + 1) * 2}px, ${(i + 1) * 2}px)` }}
        />
      ))}
      <div key={cardKey(top)} className="shi-pile-top">
        <CardSvg card={top} />
      </div>
      {topRunCount(pile) > 1 && (
        <span className="shi-pile-run" aria-label="same-rank run">
          ×{topRunCount(pile)}
        </span>
      )}
    </div>
  );
}

// Burned pile — darkened card silhouettes with a flame mark. Pile is
// out of play forever; only the count matters.
function BurnedStack({ count }: { count: number }) {
  if (count === 0) return <div className="shi-burned-empty" />;
  const layers = Math.min(3, count);
  return (
    <div className="shi-burned-stack">
      {Array.from({ length: layers }).map((_, i) => (
        <div key={i} className="shi-burned-card" />
      ))}
      <span className="shi-count-badge">{count}</span>
    </div>
  );
}

// Per-player tableau: a row of slots, each containing a face-down card
// back at the bottom and a face-up card overlaid on top. The face-down
// always renders if the player still owns a face-down at that index, so
// the slot stays visually anchored on the table even after the face-up
// above it has been played.
//
// Layout: max(faceUp.length, faceDownCount) slots side by side. The
// face-up array indices map 1:1 to the leftmost slots (we don't know
// which face-down the engine paired them with, but visually showing
// face-up over face-down at the same position is the natural Shithead
// convention).
function PlayerTableau({
  faceUp,
  faceDownCount,
  faceUpVariant,
  facedownClass,
  faceupClass,
  onFaceUpClick,
  onFaceDownClick,
  selectedKeys,
}: {
  faceUp: readonly Card[];
  faceDownCount: number;
  faceUpVariant?: 'face' | 'small';
  facedownClass?: (i: number) => string;
  faceupClass?: (c: Card) => string;
  onFaceUpClick?: (c: Card) => void;
  onFaceDownClick?: (i: number) => void;
  selectedKeys?: readonly string[];
}) {
  const slots = Math.max(faceUp.length, faceDownCount);
  if (slots === 0) return null;
  return (
    <div className="shi-tableau">
      {Array.from({ length: slots }).map((_, i) => {
        const faceUpCard = i < faceUp.length ? faceUp[i] : null;
        const showFaceDown = i < faceDownCount;
        const fdCls = `shi-slot-facedown ${facedownClass ? facedownClass(i) : ''}`;
        const fuPicked = faceUpCard && selectedKeys?.includes(cardKey(faceUpCard));
        const fuCls = `shi-slot-faceup ${fuPicked ? 'picked' : ''} ${faceUpCard && faceupClass ? faceupClass(faceUpCard) : ''}`;
        return (
          <div className="shi-slot" key={i}>
            {showFaceDown && (
              <div
                className={fdCls}
                onClick={onFaceDownClick ? () => onFaceDownClick(i) : undefined}
              >
                <CardBack />
              </div>
            )}
            {faceUpCard && (
              <div
                className={fuCls}
                onClick={onFaceUpClick ? () => onFaceUpClick(faceUpCard) : undefined}
              >
                <CardSvg card={faceUpCard} variant={faceUpVariant} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Opponent's "hand": small fanned card backs to show count at a glance.
// Capped at 5 visible — beyond that we just show the number.
function OpponentHand({ count }: { count: number }) {
  const visible = Math.min(5, count);
  return (
    <div className="shi-opponent-hand">
      {Array.from({ length: visible }).map((_, i) => (
        <CardBack key={i} size="tiny" />
      ))}
      {count > 5 && <span className="shi-opponent-hand-count">×{count}</span>}
      {count === 0 && (
        <span className="shi-opponent-hand-count">—</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top-level dispatcher: chooses Setup / Playing / Finished.
// ---------------------------------------------------------------------------

function ShitheadGamePanel({ state, onAction, onShowError }: Props) {
  const { t } = useTranslation();
  const selfId = state.players[state.selfIndex]?.id ?? '';
  const isMyTurn = state.selfIndex === state.currentPlayerIdx;
  const chainArmed =
    state.quickChainEligible?.playerId === selfId &&
    state.quickChainEligible !== null;
  const handInteractive = isMyTurn || chainArmed;
  const isChooser = state.pendingJokerChooserId === selfId;

  if (state.phase === 'setup') {
    return (
      <SetupView
        state={state}
        onAction={onAction}
        onShowError={onShowError}
      />
    );
  }

  if (state.phase === 'finished') {
    return <FinishedView state={state} />;
  }

  return (
    <PlayingView
      state={state}
      isMyTurn={isMyTurn}
      handInteractive={handInteractive}
      chainArmed={chainArmed}
      isChooser={isChooser}
      selfId={selfId}
      t={t}
      onAction={onAction}
      onShowError={onShowError}
    />
  );
}

// ---------------------------------------------------------------------------
// Setup phase: pick 3 of 6 to flip face-up.
// ---------------------------------------------------------------------------

function SetupView({
  state,
  onAction,
  onShowError,
}: Pick<Props, 'state' | 'onAction' | 'onShowError'>) {
  const { t } = useTranslation();
  const [pickedKeys, setPickedKeys] = useState<readonly string[]>([]);
  const selfPlayer = state.players[state.selfIndex];
  const myFaceUp = state.selfFaceUp;
  const sortedHand = useMemo(() => sortCards(state.selfHand), [state.selfHand]);
  const alreadyConfirmed = myFaceUp.length === 3;

  const toggle = (key: string) => {
    setPickedKeys((cur) => {
      if (cur.includes(key)) return cur.filter((k) => k !== key);
      if (cur.length === 3) return cur;
      return [...cur, key];
    });
  };

  const confirm = () => {
    if (pickedKeys.length !== 3) {
      onShowError(t('games.shithead.setup_pick_three'));
      return;
    }
    const indexes: number[] = [];
    for (const key of pickedKeys) {
      const idx = state.selfHand.findIndex((c) => cardKey(c) === key);
      if (idx !== -1) indexes.push(idx);
    }
    onAction({
      type: 'shi.setup.confirm',
      playerId: selfPlayer?.id ?? '',
      faceUpIndexes: indexes,
    });
  };

  return (
    <div className="shi-table">
      <OpponentsRow state={state} />

      <div className="shi-setup-wrap">
        <h3 className="shi-setup-title">{t('games.shithead.setup_title')}</h3>
        {alreadyConfirmed ? (
          <p className="shi-setup-instruction">
            {t('games.shithead.setup_waiting')}
          </p>
        ) : (
          <>
            <p className="shi-setup-instruction">
              {t('games.shithead.setup_instruction')}
            </p>
            <div className="shi-setup-hand">
              {sortedHand.map((c) => {
                const k = cardKey(c);
                const picked = pickedKeys.includes(k);
                return (
                  <button
                    key={k}
                    type="button"
                    className={`shi-hand-card ${picked ? 'picked' : ''}`}
                    onClick={() => toggle(k)}
                    aria-label={`${c.rank} ${c.suit}`}
                    style={{ marginInlineStart: 0 }}
                  >
                    <CardSvg card={c} />
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="shi-setup-confirm"
              disabled={pickedKeys.length !== 3}
              onClick={confirm}
            >
              {t('games.shithead.setup_confirm', { picked: pickedKeys.length })}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Playing phase.
// ---------------------------------------------------------------------------

interface PlayingProps {
  state: ShitheadClientGameState;
  isMyTurn: boolean;
  handInteractive: boolean;
  chainArmed: boolean;
  isChooser: boolean;
  selfId: string;
  t: ReturnType<typeof useTranslation>['t'];
  onAction: (action: ShitheadAction) => void;
  onShowError: (text: string) => void;
}

function PlayingView({
  state,
  isMyTurn,
  handInteractive,
  chainArmed,
  isChooser,
  selfId,
  t,
  onAction,
  onShowError,
}: PlayingProps) {
  const [selectedHandKeys, setSelectedHandKeys] = useState<readonly string[]>([]);
  const [selectedFaceUpKeys, setSelectedFaceUpKeys] = useState<readonly string[]>([]);
  const sortedHand = useMemo(() => sortCards(state.selfHand), [state.selfHand]);

  // What phase is THIS player in? Drives which set of cards is interactive.
  const playerPhase = useMemo(() => {
    if (state.selfHand.length > 0) return 'hand' as const;
    if (state.deckCount > 0) return 'hand' as const;
    if (state.selfFaceUp.length > 0) return 'faceUp' as const;
    if (state.selfFaceDownCount > 0) return 'faceDown' as const;
    return 'out' as const;
  }, [
    state.selfHand.length,
    state.deckCount,
    state.selfFaceUp.length,
    state.selfFaceDownCount,
  ]);

  const burnBurst = useMemo<
    { cards: Card[]; source: 'hand' | 'faceUp' } | null
  >(() => {
    if (selectedHandKeys.length > 0) {
      const cards = selectedHandKeys
        .map((k) => state.selfHand.find((c) => cardKey(c) === k))
        .filter((c): c is Card => c !== undefined);
      if (selectionWouldBurn(cards, state.pile)) {
        return { cards, source: 'hand' };
      }
    }
    if (selectedFaceUpKeys.length > 0) {
      const cards = selectedFaceUpKeys
        .map((k) => state.selfFaceUp.find((c) => cardKey(c) === k))
        .filter((c): c is Card => c !== undefined);
      if (selectionWouldBurn(cards, state.pile)) {
        return { cards, source: 'faceUp' };
      }
    }
    const fromHand = findBurnBurst(state.selfHand, state.pile);
    if (fromHand) return { cards: fromHand, source: 'hand' };
    if (state.selfHand.length === 0 && state.deckCount === 0) {
      const fromFaceUp = findBurnBurst(state.selfFaceUp, state.pile);
      if (fromFaceUp) return { cards: fromFaceUp, source: 'faceUp' };
    }
    return null;
  }, [
    state.selfHand,
    state.selfFaceUp,
    state.pile,
    state.deckCount,
    selectedHandKeys,
    selectedFaceUpKeys,
  ]);

  // Fire a one-shot toast the moment a burn-burst becomes available.
  const prevBurnAvailable = useRef(false);
  useEffect(() => {
    const nowAvailable = burnBurst !== null;
    if (nowAvailable && !prevBurnAvailable.current) {
      onShowError(
        t('games.shithead.burn_burst_hint', {
          rank: burnBurst!.cards[0]!.rank,
        }),
      );
    }
    prevBurnAvailable.current = nowAvailable;
  }, [burnBurst, onShowError, t]);

  const handByKey = (k: string) =>
    state.selfHand.find((c) => cardKey(c) === k) ?? null;
  const faceUpByKey = (k: string) =>
    state.selfFaceUp.find((c) => cardKey(c) === k) ?? null;

  const toggleHand = (k: string) => {
    setSelectedFaceUpKeys([]);
    const c = handByKey(k);
    if (!c) return;
    setSelectedHandKeys((cur) => {
      if (cur.includes(k)) return cur.filter((x) => x !== k);
      const compatible = cur.filter((x) => handByKey(x)?.rank === c.rank);
      return [...compatible, k];
    });
  };

  const toggleFaceUpCard = (card: Card) => {
    const k = cardKey(card);
    setSelectedHandKeys([]);
    setSelectedFaceUpKeys((cur) => {
      if (cur.includes(k)) return cur.filter((x) => x !== k);
      const compatible = cur.filter((x) => faceUpByKey(x)?.rank === card.rank);
      return [...compatible, k];
    });
  };

  const clearSelection = () => {
    setSelectedHandKeys([]);
    setSelectedFaceUpKeys([]);
  };

  const playSelected = () => {
    if (selectedHandKeys.length > 0) {
      const cards = selectedHandKeys
        .map((k) => handByKey(k))
        .filter((c): c is Card => c !== null);
      if (cards.length === 0) {
        onShowError(t('games.shithead.play_select_first'));
        return;
      }
      onAction({
        type: 'shi.play',
        playerId: selfId,
        source: 'hand',
        cards,
      });
      clearSelection();
      return;
    }
    if (selectedFaceUpKeys.length > 0) {
      const cards = selectedFaceUpKeys
        .map((k) => faceUpByKey(k))
        .filter((c): c is Card => c !== null);
      if (cards.length === 0) {
        onShowError(t('games.shithead.play_select_first'));
        return;
      }
      onAction({
        type: 'shi.play',
        playerId: selfId,
        source: 'faceUp',
        cards,
      });
      clearSelection();
      return;
    }
    onShowError(t('games.shithead.play_select_first'));
  };

  const takePile = () => {
    if (state.pile.length === 0) {
      onShowError(t('games.shithead.take_pile_empty'));
      return;
    }
    onAction({ type: 'shi.takePile', playerId: selfId });
  };

  const burst = () => {
    const handFours = state.selfHand.filter((c) => c.rank === '4');
    if (handFours.length > 0) {
      onAction({
        type: 'shi.burst',
        playerId: selfId,
        source: 'hand',
        cards: handFours,
      });
      return;
    }
    const inFaceUpPhase = state.selfHand.length === 0 && state.deckCount === 0;
    if (inFaceUpPhase) {
      const faceUpFours = state.selfFaceUp.filter((c) => c.rank === '4');
      if (faceUpFours.length > 0) {
        onAction({
          type: 'shi.burst',
          playerId: selfId,
          source: 'faceUp',
          cards: faceUpFours,
        });
        return;
      }
    }
    onShowError(t('games.shithead.burst_no_four'));
  };

  const revealFaceDown = (index: number) => {
    if (!isMyTurn) return;
    onAction({
      type: 'shi.playFaceDown',
      playerId: selfId,
      faceDownIndex: index,
    });
  };

  // Joker chooser overlay
  if (isChooser) {
    return (
      <div className="shi-table">
        <OpponentsRow state={state} />
        <JokerChooser
          state={state}
          selfId={selfId}
          onChoose={(victimId) =>
            onAction({
              type: 'shi.joker.choose',
              playerId: selfId,
              victimId,
            })
          }
        />
      </div>
    );
  }

  const inFaceUpPhase = state.selfHand.length === 0 && state.deckCount === 0;
  const burstEnabled = (() => {
    const hasFour =
      state.selfHand.some((c) => c.rank === '4') ||
      (inFaceUpPhase && state.selfFaceUp.some((c) => c.rank === '4'));
    const pileAllows =
      state.pile.length === 0 || state.pile.every((c) => c.rank === '4');
    return hasFour && pileAllows;
  })();

  return (
    <div className="shi-table">
      <OpponentsRow state={state} highlight={state.currentPlayerIdx} />

      <div className="shi-center">
        <div className="shi-center-col">
          <p className="shi-center-label">{t('games.shithead.deck')}</p>
          <DeckStack count={state.deckCount} />
        </div>
        <div className="shi-center-col">
          <p className="shi-center-label">{t('games.shithead.pile')}</p>
          {state.pile.length === 0 ? (
            <div className="shi-pile-empty">{t('games.shithead.pile_empty')}</div>
          ) : (
            <PileStack pile={state.pile} />
          )}
          {state.pile.length > 0 &&
            topRunCount(state.pile) >= 2 &&
            topRunCount(state.pile) < 4 && (
              <p className="shi-pile-burn-hint">
                {t('games.shithead.pile_burn_hint', {
                  needed: 4 - topRunCount(state.pile),
                  rank: state.pile[state.pile.length - 1]!.rank,
                })}
              </p>
            )}
        </div>
        <div className="shi-center-col">
          <p className="shi-center-label">{t('games.shithead.burned')}</p>
          <BurnedStack count={state.burnedCount} />
        </div>
      </div>

      <div className="shi-self">
        <p
          className={`shi-turn-indicator ${isMyTurn || chainArmed ? 'your-turn' : ''}`}
        >
          {isMyTurn
            ? t('games.shithead.your_turn')
            : chainArmed
              ? t('games.shithead.quick_chain_open', {
                  rank: state.quickChainEligible?.rank ?? '',
                })
              : t('games.shithead.turn_of', {
                  nickname:
                    state.players[state.currentPlayerIdx]?.nickname ?? '?',
                })}
        </p>

        <div className="shi-actions">
          <button
            type="button"
            className="primary"
            onClick={playSelected}
            disabled={
              !handInteractive ||
              (selectedHandKeys.length === 0 && selectedFaceUpKeys.length === 0)
            }
          >
            {t('games.shithead.play_button')}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={takePile}
            disabled={!isMyTurn || state.pile.length === 0}
          >
            {t('games.shithead.take_pile')}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={burst}
            disabled={!burstEnabled}
            title={t('games.shithead.burst_with_4_hint')}
          >
            {t('games.shithead.burst_with_4')}
          </button>
          {burnBurst && (
            <button
              type="button"
              className="burn-burst"
              onClick={() => {
                onAction({
                  type: 'shi.burst',
                  playerId: selfId,
                  source: burnBurst.source,
                  cards: burnBurst.cards,
                });
              }}
              title={t('games.shithead.burn_burst_hint', {
                rank: burnBurst.cards[0]!.rank,
              })}
            >
              {t('games.shithead.burn_burst_button', {
                rank: burnBurst.cards[0]!.rank,
              })}
            </button>
          )}
        </div>

        {/* Self tableau: face-down + face-up on the table. The face-down
            stays visible even after its face-up neighbour is played so
            the player can see how many blind reveals remain. */}
        <div
          className={`shi-self-tableau ${playerPhase === 'faceUp' && handInteractive ? 'faceup-active' : ''}`}
        >
          <PlayerTableau
            faceUp={state.selfFaceUp}
            faceDownCount={state.selfFaceDownCount}
            facedownClass={() =>
              playerPhase === 'faceDown' && isMyTurn ? 'revealable' : ''
            }
            onFaceUpClick={
              playerPhase === 'faceUp' && handInteractive
                ? toggleFaceUpCard
                : undefined
            }
            onFaceDownClick={
              playerPhase === 'faceDown' && isMyTurn
                ? revealFaceDown
                : undefined
            }
            selectedKeys={selectedFaceUpKeys}
          />
        </div>

        {/* Own hand fanned at the bottom — only shown while the player
            is actually in 'hand' phase (still has hand cards or the
            deck is alive). After hand+deck are empty, the face-up
            tableau above takes over the interactive role. The
            SelfHand subcomponent handles the viewport-aware spread
            math so cards use the full available width instead of
            being crammed into the center on wide screens. */}
        {playerPhase === 'hand' && (
          <SelfHand
            sortedHand={sortedHand}
            selectedHandKeys={selectedHandKeys}
            handInteractive={handInteractive}
            onToggle={toggleHand}
          />
        )}

        {playerPhase === 'faceDown' && (
          <p className="shi-setup-instruction">
            {t('games.shithead.facedown_reveal_hint')}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Self hand — viewport-aware spacing so a modest hand doesn't stay
// crammed into the middle of a wide screen. On mobile the cards start
// overlapping only when they'd otherwise overflow the viewport; on
// desktop the cards get a comfortable 4px gap and sit centered.
// ---------------------------------------------------------------------------

function useViewportWidth(): number {
  const [w, setW] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 800,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return w;
}

function SelfHand({
  sortedHand,
  selectedHandKeys,
  handInteractive,
  onToggle,
}: {
  sortedHand: readonly Card[];
  selectedHandKeys: readonly string[];
  handInteractive: boolean;
  onToggle: (key: string) => void;
}) {
  const viewportWidth = useViewportWidth();

  // Match the CSS clamp(56px, 10vw, 88px) for hand-card width so the
  // math stays in sync with what the browser actually renders.
  const cardWidth = Math.max(56, Math.min(88, viewportWidth * 0.10));

  // Leave a small left/right buffer for the .shi-table padding.
  const availableWidth = Math.max(200, viewportWidth - 24);

  const cardCount = sortedHand.length;
  const gapWhenFits = 4; // px between cards when the hand fits comfortably
  const naturalWithGap =
    cardCount * cardWidth + Math.max(0, cardCount - 1) * gapWhenFits;

  // Positive value = space between cards, negative value = overlap.
  // Cards only overlap when the natural row would overflow.
  const cardMargin =
    cardCount <= 1
      ? 0
      : naturalWithGap > availableWidth
        ? -((naturalWithGap - availableWidth) / (cardCount - 1))
        : gapWhenFits;

  return (
    <div
      className="shi-hand"
      style={{ ['--card-margin']: `${cardMargin}px` } as CSSProperties}
    >
      {sortedHand.map((c) => {
        const k = cardKey(c);
        return (
          <button
            key={k}
            type="button"
            className={`shi-hand-card ${selectedHandKeys.includes(k) ? 'picked' : ''}`}
            onClick={() => onToggle(k)}
            disabled={!handInteractive}
            aria-label={`${c.rank} ${c.suit}`}
          >
            <CardSvg card={c} />
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Opponents row: name + face-up/face-down tableau + small hand-count fan.
// ---------------------------------------------------------------------------

function OpponentsRow({
  state,
  highlight,
}: {
  state: ShitheadClientGameState;
  highlight?: number;
}) {
  const opponentCount = state.players.length - 1;
  return (
    <ul className="shi-opponents" data-count={opponentCount}>
      {state.players.map((p: ShitheadPublicPlayer, i) => {
        if (i === state.selfIndex) return null;
        return (
          <li
            key={p.id}
            className={`shi-opponent ${i === highlight ? 'turn' : ''} ${p.isOut ? 'out' : ''}`}
          >
            <span className="shi-opponent-name">{p.nickname}</span>
            <OpponentHand count={p.handCount} />
            <PlayerTableau
              faceUp={p.faceUp}
              faceDownCount={p.faceDownCount}
              faceUpVariant="small"
            />
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Joker chooser.
// ---------------------------------------------------------------------------

function JokerChooser({
  state,
  selfId,
  onChoose,
}: {
  state: ShitheadClientGameState;
  selfId: string;
  onChoose: (victimId: string) => void;
}) {
  const { t } = useTranslation();
  const victims = state.players.filter(
    (p) => p.id !== selfId && !p.isOut,
  );
  return (
    <div className="shi-joker-overlay">
      <h3>{t('games.shithead.joker_pick_victim')}</h3>
      <div className="shi-joker-buttons">
        {victims.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => onChoose(v.id)}
          >
            {v.nickname}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Finished phase.
// ---------------------------------------------------------------------------

function FinishedView({ state }: { state: ShitheadClientGameState }) {
  const { t } = useTranslation();
  const loser = state.players.find((p) => p.id === state.loser);
  const winner = state.players.find((p) => p.id === state.outOrder[0]);
  return (
    <div className="shi-table">
      <div className="shi-finished">
        <h2>
          {state.endReason === 'player_disconnected'
            ? t('games.shithead.ended_disconnect')
            : t('games.shithead.ended_normal')}
        </h2>
        {winner && (
          <p>
            {t('games.shithead.winner_label', { nickname: winner.nickname })}
          </p>
        )}
        {loser && (
          <p>
            {t('games.shithead.loser_label', { nickname: loser.nickname })}
          </p>
        )}
      </div>
    </div>
  );
}

export default ShitheadGamePanel;
