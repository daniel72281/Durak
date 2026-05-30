import { useTranslation } from 'react-i18next';
import type { ClientGameState } from '@shared/types';
import './GameOverDialog.css';

interface Props {
  state: ClientGameState;
  isOwner: boolean;
  onPlayAgain: () => void;
  onBackHome: () => void;
}

function GameOverDialog({ state, isOwner, onPlayAgain, onBackHome }: Props) {
  const { t } = useTranslation();
  const myId = state.players[state.selfIndex]?.id ?? '';

  // Build full ranking: outOrder first (1st place → 2nd → …), then the durak
  // (`loser`) is appended last. If draw (loser = null), no one is appended.
  const ranking: { id: string; nickname: string; place: number; isDurak: boolean }[] = [];
  let place = 1;
  for (const pid of state.outOrder) {
    const p = state.players.find((q) => q.id === pid);
    if (!p) continue;
    ranking.push({ id: pid, nickname: p.nickname, place, isDurak: false });
    place += 1;
  }
  if (state.loser) {
    const p = state.players.find((q) => q.id === state.loser);
    if (p) ranking.push({ id: state.loser, nickname: p.nickname, place, isDurak: true });
  }

  return (
    <div className="game-over-backdrop">
      <div className="game-over-dialog">
        <h2>{t('game.game_over')}</h2>

        {state.endReason === 'player_disconnected' ? (
          <p className="game-over-result">{t('game.ended_player_disconnected')}</p>
        ) : state.loser ? (
          <p className="game-over-result">
            {state.loser === myId
              ? t('game.you_are_durak')
              : t('game.someone_is_durak', {
                  nickname:
                    state.players.find((p) => p.id === state.loser)?.nickname ?? '?',
                })}
          </p>
        ) : (
          <p className="game-over-result">{t('game.draw')}</p>
        )}

        {state.endReason !== 'player_disconnected' && ranking.length > 0 && (
          <section className="ranking">
            <h3>{t('game.this_game_ranking')}</h3>
            <ol className="ranking-list">
              {ranking.map((r) => (
                <li
                  key={r.id}
                  className={r.isDurak ? 'durak' : 'winner'}
                >
                  <span className="place">{r.place}</span>
                  <span className="name">{r.nickname}</span>
                  {r.isDurak && <span className="durak-tag">{t('game.durak_short')}</span>}
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="scoreboard">
          <h3>{t('game.cumulative_scores')}</h3>
          <table>
            <thead>
              <tr>
                <th>{t('game.player')}</th>
                <th>{t('game.wins')}</th>
                <th>{t('game.duraks_count')}</th>
              </tr>
            </thead>
            <tbody>
              {state.players.map((p) => {
                const s = state.scoreboard[p.id] ?? { wins: 0, duraks: 0 };
                return (
                  <tr key={p.id} className={p.id === myId ? 'me' : ''}>
                    <td>{p.nickname}</td>
                    <td>{s.wins}</td>
                    <td>{s.duraks}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <div className="game-over-actions">
          {isOwner && (
            <button type="button" className="primary" onClick={onPlayAgain}>
              {t('game.play_again')}
            </button>
          )}
          {!isOwner && (
            <p className="waiting-restart">{t('game.waiting_for_restart')}</p>
          )}
          <button type="button" className="danger" onClick={onBackHome}>
            {t('room.back_home')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default GameOverDialog;
