import { useEffect, useRef } from 'react';
import type { PublicPlayer } from '@shared/types';
import './PlayerList.css';

interface Props {
  players: readonly PublicPlayer[];
  attackerIndex: number;
  defenderIndex: number;
  selfIndex: number;
  defenderTaking: boolean;
  passedPlayerIds: readonly string[];
}

interface RowProps {
  player: PublicPlayer;
  isSelf: boolean;
  isAttacker: boolean;
  isDefender: boolean;
  defenderTaking: boolean;
  hasPassed: boolean;
}

// Each row tracks its previous hand count via a ref so it can fire a
// short scale/glow pulse when a card is dealt to that player. If the
// count jumped by N (e.g. 0→6 at game start, or 3→6 after a round)
// the pulse fires N times back-to-back, giving the feel of cards being
// dealt one by one.
function PlayerRow({
  player,
  isSelf,
  isAttacker,
  isDefender,
  defenderTaking,
  hasPassed,
}: RowProps) {
  const rowRef = useRef<HTMLLIElement | null>(null);
  const prevCount = useRef(player.handCount);

  useEffect(() => {
    const delta = player.handCount - prevCount.current;
    prevCount.current = player.handCount;
    if (delta <= 0 || !rowRef.current) return;

    // Cap pulses to keep the deal sequence from running absurdly long
    // on edge cases (e.g., taking a huge pile).
    const pulses = Math.min(delta, 6);
    const timers: number[] = [];
    for (let i = 0; i < pulses; i++) {
      const t = window.setTimeout(() => {
        rowRef.current?.animate(
          [
            { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(245, 158, 11, 0)' },
            {
              transform: 'scale(1.08)',
              boxShadow: '0 0 0 5px rgba(245, 158, 11, 0.35)',
            },
            { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(245, 158, 11, 0)' },
          ],
          { duration: 320, easing: 'ease-out' },
        );
      }, i * 130);
      timers.push(t);
    }
    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
  }, [player.handCount]);

  return (
    <li
      ref={rowRef}
      data-player-id={player.id}
      className={`player-row ${isSelf ? 'self' : ''} ${player.isOut ? 'out' : ''} ${player.disconnected ? 'disconnected' : ''}`}
    >
      <span className="role-icon" aria-hidden="true">
        {isAttacker && '✦'}
        {isDefender && (defenderTaking ? '🫳' : '🛡')}
      </span>
      <span className="player-name">
        {player.nickname}
        {isSelf && ' (you)'}
      </span>
      <span className="hand-count">🂠 {player.handCount}</span>
      {hasPassed && <span className="pass-badge">passed</span>}
      {player.disconnected && (
        <span className="disconnect-badge" aria-label="disconnected">
          🔌
        </span>
      )}
      {player.isOut && <span className="out-badge">out</span>}
    </li>
  );
}

function PlayerList({
  players,
  attackerIndex,
  defenderIndex,
  selfIndex,
  defenderTaking,
  passedPlayerIds,
}: Props) {
  const passedSet = new Set(passedPlayerIds);
  return (
    <ul className="player-list">
      {players.map((p, i) => (
        <PlayerRow
          key={p.id}
          player={p}
          isSelf={i === selfIndex}
          isAttacker={i === attackerIndex}
          isDefender={i === defenderIndex}
          defenderTaking={defenderTaking}
          hasPassed={passedSet.has(p.id)}
        />
      ))}
    </ul>
  );
}

export default PlayerList;
