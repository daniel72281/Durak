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
      {players.map((p, i) => {
        const isSelf = i === selfIndex;
        const isAttacker = i === attackerIndex;
        const isDefender = i === defenderIndex;
        const hasPassed = passedSet.has(p.id);
        return (
          <li
            key={p.id}
            className={`player-row ${isSelf ? 'self' : ''} ${p.isOut ? 'out' : ''} ${p.disconnected ? 'disconnected' : ''}`}
          >
            <span className="role-icon" aria-hidden="true">
              {isAttacker && '✦'}
              {isDefender && (defenderTaking ? '🫳' : '🛡')}
            </span>
            <span className="player-name">{p.nickname}{isSelf && ' (you)'}</span>
            <span className="hand-count">🂠 {p.handCount}</span>
            {hasPassed && <span className="pass-badge">passed</span>}
            {p.disconnected && <span className="disconnect-badge" aria-label="disconnected">🔌</span>}
            {p.isOut && <span className="out-badge">out</span>}
          </li>
        );
      })}
    </ul>
  );
}

export default PlayerList;
