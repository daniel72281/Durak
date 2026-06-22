// The Shithead game panel. Splits its render across three phases:
//   - setup   pick 3 of your 6 hand cards to flip face-up; everybody
//             confirms before play starts
//   - playing the normal turn loop with hand / faceUp / faceDown phases
//             and the magic-card effects
//   - finished show the shithead (loser)
//
// We keep the rendering deliberately compact — Stage 5 is the minimum
// to make the game playable end-to-end. Polish (animations, sortable
// hand, drag-drop) can come after the first multiplayer playtest.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Card } from '@shared/types';
import type {
  ShitheadAction,
  ShitheadClientGameState,
  ShitheadPublicPlayer,
} from '@shared/games/shithead';
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

// Build the burn-burst option from a source of cards: find any rank
// where (cards of that rank you own) + (matching-rank run at the top of
// the pile) >= 4. With 4 cards per rank in the deck, there's never a
// "use only some" choice — the player either has exactly enough or not.
//
// Returns the cards to burst with, or null if no rank can complete the
// run. When multiple ranks qualify, prefers the lowest rank so the
// player spends the least valuable cards.
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
    const run = topRank === rank ? topRun : 0;
    if (group.length + run < 4) continue;
    if (best === null || RANK_ORDER[rank] < RANK_ORDER[best.rank]) {
      best = { rank, cards: group };
    }
  }
  return best?.cards ?? null;
}

// How many cards of the SAME literal rank sit at the top of the pile?
// Helps the UI flag two things at a glance:
//   - how many cards the previous actor just laid down together
//   - how close the pile is to a four-in-a-row burn (4 - runCount more
//     of the same rank ends the round)
// Strictly literal rank equality (K==K, 5==5, JOKER==JOKER) — 3s on top
// don't merge with the rank under them, they break the run.
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

function ShitheadGamePanel({ state, onAction, onShowError }: Props) {
  const { t } = useTranslation();
  const selfId = state.players[state.selfIndex]?.id ?? '';
  const isMyTurn = state.selfIndex === state.currentPlayerIdx;
  // Quick-chain rule: after you played a card from hand and the refill
  // drew another of the same rank, the engine lets you chain it in
  // before the next player acts. While the chain is armed for self,
  // we keep the hand interactive even though it's not technically our
  // turn — the player races against the next player's first action.
  const chainArmed =
    state.quickChainEligible?.playerId === selfId &&
    state.quickChainEligible !== null;
  const handInteractive = isMyTurn || chainArmed;
  const isChooser = state.pendingJokerChooserId === selfId;
  const pileTop = state.pile[state.pile.length - 1] ?? null;

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
      pileTop={pileTop}
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
  // Track picks by cardKey so the selection survives the sorted reorder.
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
    // Engine wants indexes into the AUTHORITATIVE hand (the server's
    // unsorted order). Map each picked cardKey back to its original
    // index.
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
    <div className="shi-panel">
      <h3 className="shi-heading">{t('games.shithead.setup_title')}</h3>
      {alreadyConfirmed ? (
        <p className="shi-status">{t('games.shithead.setup_waiting')}</p>
      ) : (
        <>
          <p className="shi-status">{t('games.shithead.setup_instruction')}</p>
          <div className="shi-hand">
            {sortedHand.map((c) => {
              const k = cardKey(c);
              return (
                <button
                  key={k}
                  type="button"
                  className={`shi-card-btn ${pickedKeys.includes(k) ? 'picked' : ''}`}
                  onClick={() => toggle(k)}
                  aria-label={`${c.rank} ${c.suit}`}
                >
                  <CardSvg card={c} />
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="primary"
            disabled={pickedKeys.length !== 3}
            onClick={confirm}
          >
            {t('games.shithead.setup_confirm', { picked: pickedKeys.length })}
          </button>
        </>
      )}
      <OthersList state={state} />
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
  pileTop: Card | null;
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
  pileTop,
  selfId,
  t,
  onAction,
  onShowError,
}: PlayingProps) {
  // Selected cards (by stable cardKey) for the next play. The action
  // shape requires same-rank cards, so toggling enforces single-rank
  // groups. Selection is by key — independent of the sorted display
  // order, so reorders don't fall apart.
  const [selectedHandKeys, setSelectedHandKeys] = useState<readonly string[]>([]);
  const [selectedFaceUpKeys, setSelectedFaceUpKeys] = useState<readonly string[]>([]);
  const sortedHand = useMemo(() => sortCards(state.selfHand), [state.selfHand]);
  const sortedFaceUp = useMemo(() => sortCards(state.selfFaceUp), [state.selfFaceUp]);

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

  // Burn-burst opportunity. Hand takes precedence; faceUp only counts
  // once the player is in faceUp phase (no hand, no deck). When it's
  // available the second "פרוץ ושרוף" button shows up and a toast pops
  // to nudge the player to race the next play.
  const burnBurst = useMemo<
    { cards: Card[]; source: 'hand' | 'faceUp' } | null
  >(() => {
    const fromHand = findBurnBurst(state.selfHand, state.pile);
    if (fromHand) return { cards: fromHand, source: 'hand' };
    if (state.selfHand.length === 0 && state.deckCount === 0) {
      const fromFaceUp = findBurnBurst(state.selfFaceUp, state.pile);
      if (fromFaceUp) return { cards: fromFaceUp, source: 'faceUp' };
    }
    return null;
  }, [state.selfHand, state.selfFaceUp, state.pile, state.deckCount]);

  // Fire a one-shot toast the moment a burn-burst becomes available so
  // the player notices before the next action closes the window.
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

  // Look up a Card by its cardKey from the actor's authoritative hand /
  // faceUp. Returns null when the key has gone stale (the card was
  // played in a prior action and the new state no longer contains it).
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
      // Enforce same-rank selection: drop any prior picks of a different
      // rank before adding the new one.
      const compatible = cur.filter((x) => handByKey(x)?.rank === c.rank);
      return [...compatible, k];
    });
  };

  const toggleFaceUp = (k: string) => {
    setSelectedHandKeys([]);
    const c = faceUpByKey(k);
    if (!c) return;
    setSelectedFaceUpKeys((cur) => {
      if (cur.includes(k)) return cur.filter((x) => x !== k);
      const compatible = cur.filter((x) => faceUpByKey(x)?.rank === c.rank);
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

  // Burst gathers every 4 the player owns and slams them in one shot.
  // Hand source takes precedence; the faceUp fallback covers the case
  // where the player has already emptied their hand AND the draw deck
  // has been exhausted (faceUp phase) — without this the button used
  // to grey out at exactly the moment a 4 from face-up could still
  // burn the pile.
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
    onAction({
      type: 'shi.playFaceDown',
      playerId: selfId,
      faceDownIndex: index,
    });
  };

  // Joker chooser overlay
  if (isChooser) {
    return (
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
    );
  }

  return (
    <div className="shi-panel">
      <OthersList state={state} highlight={state.currentPlayerIdx} />

      <div className="shi-board">
        <div className="shi-board-col">
          <p className="shi-board-label">{t('games.shithead.deck')}</p>
          <div className="shi-deck-count">{state.deckCount}</div>
        </div>
        <div className="shi-board-col shi-pile">
          <p className="shi-board-label">{t('games.shithead.pile')}</p>
          {pileTop ? (
            <div className="shi-pile-card-wrap">
              <CardSvg card={pileTop} />
              {topRunCount(state.pile) > 1 && (
                <span className="shi-pile-run" aria-label="same-rank run">
                  ×{topRunCount(state.pile)}
                </span>
              )}
            </div>
          ) : (
            <div className="shi-pile-empty">{t('games.shithead.pile_empty')}</div>
          )}
          <p className="shi-pile-count">
            {t('games.shithead.pile_count', { count: state.pile.length })}
          </p>
          {pileTop && topRunCount(state.pile) >= 2 && topRunCount(state.pile) < 4 && (
            <p className="shi-pile-burn-hint">
              {t('games.shithead.pile_burn_hint', {
                needed: 4 - topRunCount(state.pile),
                rank: pileTop.rank,
              })}
            </p>
          )}
        </div>
        <div className="shi-board-col">
          <p className="shi-board-label">{t('games.shithead.burned')}</p>
          <div className="shi-deck-count">{state.burnedCount}</div>
        </div>
      </div>

      <div className="shi-self">
        <p className="shi-board-label">
          {isMyTurn
            ? t('games.shithead.your_turn')
            : chainArmed
              ? t('games.shithead.quick_chain_open', {
                  rank: state.quickChainEligible?.rank ?? '',
                })
              : t('games.shithead.waiting_for_other')}
          {' · '}
          {t(`games.shithead.phase_${playerPhase}`)}
        </p>

        {playerPhase === 'hand' && (
          <div className="shi-hand">
            {sortedHand.map((c) => {
              const k = cardKey(c);
              return (
                <button
                  key={k}
                  type="button"
                  className={`shi-card-btn ${selectedHandKeys.includes(k) ? 'picked' : ''}`}
                  onClick={() => toggleHand(k)}
                  disabled={!handInteractive}
                  aria-label={`${c.rank} ${c.suit}`}
                >
                  <CardSvg card={c} />
                </button>
              );
            })}
          </div>
        )}

        {playerPhase === 'faceUp' && (
          <div className="shi-hand">
            {sortedFaceUp.map((c) => {
              const k = cardKey(c);
              return (
                <button
                  key={k}
                  type="button"
                  className={`shi-card-btn ${selectedFaceUpKeys.includes(k) ? 'picked' : ''}`}
                  onClick={() => toggleFaceUp(k)}
                  disabled={!handInteractive}
                  aria-label={`${c.rank} ${c.suit}`}
                >
                  <CardSvg card={c} />
                </button>
              );
            })}
          </div>
        )}

        {playerPhase === 'faceDown' && (
          <div className="shi-facedown-row">
            <p className="shi-status">{t('games.shithead.facedown_reveal_hint')}</p>
            <div className="shi-hand">
              {Array.from({ length: state.selfFaceDownCount }).map((_, i) => (
                <button
                  key={i}
                  type="button"
                  className="shi-card-btn shi-card-back"
                  onClick={() => isMyTurn && revealFaceDown(i)}
                  disabled={!isMyTurn}
                  aria-label={t('games.shithead.facedown_reveal')}
                >
                  ?
                </button>
              ))}
            </div>
          </div>
        )}

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
            disabled={
              (() => {
                const inFaceUpPhase =
                  state.selfHand.length === 0 && state.deckCount === 0;
                const hasFour =
                  state.selfHand.some((c) => c.rank === '4') ||
                  (inFaceUpPhase &&
                    state.selfFaceUp.some((c) => c.rank === '4'));
                const pileAllows =
                  state.pile.length === 0 ||
                  state.pile.every((c) => c.rank === '4');
                return !hasFour || !pileAllows;
              })()
            }
            title={t('games.shithead.burst_with_4_hint')}
          >
            {t('games.shithead.burst_with_4')}
          </button>
          {burnBurst && (
            <button
              type="button"
              className="primary burn-burst"
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
      </div>
    </div>
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
    <div className="shi-panel">
      <div className="shi-joker-overlay">
        <h3 className="shi-heading">{t('games.shithead.joker_pick_victim')}</h3>
        <div className="shi-joker-buttons">
          {victims.map((v) => (
            <button
              key={v.id}
              type="button"
              className="primary"
              onClick={() => onChoose(v.id)}
            >
              {v.nickname}
            </button>
          ))}
        </div>
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
    <div className="shi-panel shi-finished">
      <h2 className="shi-heading">
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
  );
}

// ---------------------------------------------------------------------------
// Other-players panel (shared by Setup + Playing).
// ---------------------------------------------------------------------------

function OthersList({
  state,
  highlight,
}: {
  state: ShitheadClientGameState;
  highlight?: number;
}) {
  const { t } = useTranslation();
  return (
    <ul className="shi-players">
      {state.players.map((p: ShitheadPublicPlayer, i) => {
        const isSelf = i === state.selfIndex;
        return (
          <li
            key={p.id}
            className={`shi-player ${i === highlight ? 'turn' : ''} ${p.isOut ? 'out' : ''}`}
          >
            <div className="shi-player-meta">
              <strong>
                {p.nickname}
                {isSelf && ' (' + t('games.shithead.you') + ')'}
              </strong>
              <span>
                {t('games.shithead.hand_count', { count: p.handCount })}
                {' · '}
                {t('games.shithead.facedown_count', { count: p.faceDownCount })}
              </span>
            </div>
            <div className="shi-player-faceup">
              {p.faceUp.map((c, k) => (
                <CardSvg key={cardKey(c) + k} card={c} variant="small" />
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default ShitheadGamePanel;
