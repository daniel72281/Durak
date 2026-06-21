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

import { useMemo, useState } from 'react';
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

// How many cards of the SAME rank sit at the top of the pile? Helps the
// UI flag two things at a glance:
//   - how many cards the previous actor just laid down together
//   - how close the pile is to a four-in-a-row burn (4 - runCount more
//     of the same rank ends the round)
// 3s on top break the run since they're a different rank literally.
function topRunCount(pile: readonly Card[]): number {
  if (pile.length === 0) return 0;
  const topRank = pile[pile.length - 1]!.rank;
  let count = 1;
  for (let i = pile.length - 2; i >= 0; i--) {
    if (pile[i]!.rank === topRank) count++;
    else break;
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
  const [picked, setPicked] = useState<readonly number[]>([]);
  const selfPlayer = state.players[state.selfIndex];
  const myFaceUp = state.selfFaceUp;
  const myHand = state.selfHand;
  const alreadyConfirmed = myFaceUp.length === 3;

  const toggle = (idx: number) => {
    setPicked((cur) => {
      if (cur.includes(idx)) return cur.filter((i) => i !== idx);
      if (cur.length === 3) return cur;
      return [...cur, idx];
    });
  };

  const confirm = () => {
    if (picked.length !== 3) {
      onShowError(t('games.shithead.setup_pick_three'));
      return;
    }
    onAction({
      type: 'shi.setup.confirm',
      playerId: selfPlayer?.id ?? '',
      faceUpIndexes: picked,
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
            {myHand.map((c, i) => (
              <button
                key={cardKey(c) + i}
                type="button"
                className={`shi-card-btn ${picked.includes(i) ? 'picked' : ''}`}
                onClick={() => toggle(i)}
                aria-label={`${c.rank} ${c.suit}`}
              >
                <CardSvg card={c} />
              </button>
            ))}
          </div>
          <button
            type="button"
            className="primary"
            disabled={picked.length !== 3}
            onClick={confirm}
          >
            {t('games.shithead.setup_confirm', { picked: picked.length })}
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
  // Selected hand / faceUp indexes for the next play. The action shape
  // requires same-rank cards, so the panel groups selection by rank.
  const [selectedHand, setSelectedHand] = useState<readonly number[]>([]);
  const [selectedFaceUp, setSelectedFaceUp] = useState<readonly number[]>([]);

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

  const toggleHand = (i: number) => {
    setSelectedFaceUp([]);
    const c = state.selfHand[i]!;
    setSelectedHand((cur) => {
      if (cur.includes(i)) return cur.filter((x) => x !== i);
      // Enforce same-rank selection: clear any non-matching picks first.
      const compatible = cur.filter(
        (x) => state.selfHand[x]?.rank === c.rank,
      );
      return [...compatible, i];
    });
  };

  const toggleFaceUp = (i: number) => {
    setSelectedHand([]);
    const c = state.selfFaceUp[i]!;
    setSelectedFaceUp((cur) => {
      if (cur.includes(i)) return cur.filter((x) => x !== i);
      const compatible = cur.filter(
        (x) => state.selfFaceUp[x]?.rank === c.rank,
      );
      return [...compatible, i];
    });
  };

  const clearSelection = () => {
    setSelectedHand([]);
    setSelectedFaceUp([]);
  };

  const playSelected = () => {
    if (selectedHand.length > 0) {
      const cards = selectedHand.map((i) => state.selfHand[i]!);
      onAction({
        type: 'shi.play',
        playerId: selfId,
        source: 'hand',
        cards,
      });
      clearSelection();
      return;
    }
    if (selectedFaceUp.length > 0) {
      const cards = selectedFaceUp.map((i) => state.selfFaceUp[i]!);
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

  const burstFromHand = () => {
    // Grab every 4 the player owns — Shithead lets you slam them all
    // down in a single burst. With four 4s the engine triggers a
    // four-in-a-row burn and the burster keeps their turn.
    const fours = state.selfHand.filter((c) => c.rank === '4');
    if (fours.length === 0) {
      onShowError(t('games.shithead.burst_no_four'));
      return;
    }
    onAction({
      type: 'shi.burst',
      playerId: selfId,
      source: 'hand',
      cards: fours,
    });
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
            {state.selfHand.map((c, i) => (
              <button
                key={cardKey(c) + i}
                type="button"
                className={`shi-card-btn ${selectedHand.includes(i) ? 'picked' : ''}`}
                onClick={() => toggleHand(i)}
                disabled={!handInteractive}
                aria-label={`${c.rank} ${c.suit}`}
              >
                <CardSvg card={c} />
              </button>
            ))}
          </div>
        )}

        {playerPhase === 'faceUp' && (
          <div className="shi-hand">
            {state.selfFaceUp.map((c, i) => (
              <button
                key={cardKey(c) + i}
                type="button"
                className={`shi-card-btn ${selectedFaceUp.includes(i) ? 'picked' : ''}`}
                onClick={() => toggleFaceUp(i)}
                disabled={!isMyTurn}
                aria-label={`${c.rank} ${c.suit}`}
              >
                <CardSvg card={c} />
              </button>
            ))}
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
              (selectedHand.length === 0 && selectedFaceUp.length === 0)
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
            onClick={burstFromHand}
            disabled={
              !state.selfHand.some((c) => c.rank === '4') ||
              (state.pile.length > 0 &&
                state.pile.some((c) => c.rank !== '4'))
            }
            title={t('games.shithead.burst_with_4_hint')}
          >
            {t('games.shithead.burst_with_4')}
          </button>
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
