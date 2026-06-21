// Shithead end-of-game dialog. Same shell as Durak's: ranking + cumulative
// scoreboard + Play Again (owner) / Back Home (everyone). Mirrors the
// Durak dialog's CSS so the two games feel like siblings.

import { useTranslation } from 'react-i18next';
import type { ShitheadClientGameState } from '@shared/games/shithead';
import '../durak/GameOverDialog.css';

interface Props {
  state: ShitheadClientGameState;
  isOwner: boolean;
  onPlayAgain: () => void;
  onBackHome: () => void;
}

function ShitheadGameOverDialog({
  state,
  isOwner,
  onPlayAgain,
  onBackHome,
}: Props) {
  const { t } = useTranslation();
  const myId = state.players[state.selfIndex]?.id ?? '';

  // outOrder is the finish order; the player NOT in it is the shithead.
  const ranking: { id: string; nickname: string; place: number; isShithead: boolean }[] = [];
  let place = 1;
  for (const pid of state.outOrder) {
    const p = state.players.find((q) => q.id === pid);
    if (!p) continue;
    ranking.push({ id: pid, nickname: p.nickname, place, isShithead: false });
    place += 1;
  }
  if (state.loser) {
    const p = state.players.find((q) => q.id === state.loser);
    if (p) ranking.push({ id: state.loser, nickname: p.nickname, place, isShithead: true });
  }

  return (
    <div className="game-over-backdrop">
      <div className="game-over-dialog">
        <h2>{t('games.shithead.ended_normal')}</h2>

        {state.endReason === 'player_disconnected' ? (
          <p className="game-over-result">{t('games.shithead.ended_disconnect')}</p>
        ) : state.loser ? (
          <p className="game-over-result">
            {state.loser === myId
              ? t('games.shithead.loser_label', { nickname: t('games.shithead.you') })
              : t('games.shithead.loser_label', {
                  nickname:
                    state.players.find((p) => p.id === state.loser)?.nickname ?? '?',
                })}
          </p>
        ) : null}

        {state.endReason !== 'player_disconnected' && ranking.length > 0 && (
          <section className="ranking">
            <ol className="ranking-list">
              {ranking.map((r) => (
                <li
                  key={r.id}
                  className={r.isShithead ? 'durak' : 'winner'}
                >
                  <span className="place">{r.place}</span>
                  <span className="name">{r.nickname}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="scoreboard">
          <table>
            <thead>
              <tr>
                <th>{t('games.durak.player')}</th>
                <th>{t('games.durak.points')}</th>
              </tr>
            </thead>
            <tbody>
              {state.players
                .slice()
                .sort((a, b) => {
                  const ap = state.scoreboard[a.id]?.points ?? 0;
                  const bp = state.scoreboard[b.id]?.points ?? 0;
                  return bp - ap;
                })
                .map((p) => {
                  const s = state.scoreboard[p.id] ?? { points: 0 };
                  return (
                    <tr key={p.id} className={p.id === myId ? 'me' : ''}>
                      <td>{p.nickname}</td>
                      <td>{s.points}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </section>

        <div className="game-over-actions">
          {isOwner ? (
            <button type="button" className="primary" onClick={onPlayAgain}>
              {t('games.shithead.play_again')}
            </button>
          ) : (
            <p className="waiting-restart">{t('games.shithead.waiting_for_restart')}</p>
          )}
          <button type="button" className="danger" onClick={onBackHome}>
            {t('room.back_home')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ShitheadGameOverDialog;
