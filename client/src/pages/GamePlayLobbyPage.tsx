// Per-game lobby. Built from the old HomePage — same nickname / create
// / join layout, but the gameType comes from the URL (/play/:gameType)
// so the same component serves every game. The join form will navigate
// to /play/<actual-game>/room/<code>: even if the player joined from
// the Durak lobby, if they entered a Shithead room's code the server's
// ack tells us the real gameType and we route accordingly.

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { GameType } from '@shared/games/common';
import { socket } from '../socket';
import { saveSession } from '../lib/session';
import './HomePage.css';

const KNOWN_GAMES: ReadonlySet<GameType> = new Set(['durak', 'shithead']);

function GamePlayLobbyPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { gameType } = useParams<{ gameType: string }>();
  const [nickname, setNickname] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Unknown / mistyped gameType in the URL → bounce back to the picker
  // so we don't silently send a bogus value to the server.
  useEffect(() => {
    if (!gameType || !KNOWN_GAMES.has(gameType as GameType)) {
      navigate('/', { replace: true });
    }
  }, [gameType, navigate]);
  if (!gameType || !KNOWN_GAMES.has(gameType as GameType)) return null;
  const typedGameType = gameType as GameType;

  const handleCreate = () => {
    setError(null);
    const cleanNick = nickname.trim();
    if (!cleanNick) {
      setError(t('home.error_nickname_required'));
      return;
    }
    setBusy(true);
    socket.emit(
      'room:create',
      { nickname: cleanNick, maxPlayers, gameType: typedGameType },
      (ack) => {
        setBusy(false);
        if (!ack.ok) {
          setError(ack.error);
          return;
        }
        saveSession({
          roomId: ack.roomId,
          playerId: ack.playerId,
          nickname: cleanNick,
          isOwner: true,
          gameType: typedGameType,
        });
        navigate(`/play/${typedGameType}/room/${ack.roomId}`, {
          state: { nickname: cleanNick, playerId: ack.playerId, isOwner: true },
        });
      },
    );
  };

  const handleJoin = () => {
    setError(null);
    const cleanNick = nickname.trim();
    const cleanCode = joinCode.trim().toUpperCase();
    if (!cleanNick) {
      setError(t('home.error_nickname_required'));
      return;
    }
    if (cleanCode.length !== 4) {
      setError(t('home.error_code_format'));
      return;
    }
    setBusy(true);
    socket.emit(
      'room:join',
      { roomId: cleanCode, nickname: cleanNick },
      (ack) => {
        setBusy(false);
        if (!ack.ok) {
          setError(ack.error);
          return;
        }
        // The room's actual gameType might differ from the lobby the user
        // came from — route to the URL that matches the *real* game.
        saveSession({
          roomId: cleanCode,
          playerId: ack.playerId,
          nickname: cleanNick,
          isOwner: false,
          gameType: ack.gameType,
        });
        navigate(`/play/${ack.gameType}/room/${cleanCode}`, {
          state: { nickname: cleanNick, playerId: ack.playerId, isOwner: false },
        });
      },
    );
  };

  return (
    <div className="home-page">
      <p className="home-subtitle">
        {t(`gameSelect.${typedGameType}_name`)} · {t('app.subtitle')}
      </p>

      <label className="home-field">
        <span>{t('home.nickname')}</span>
        <input
          type="text"
          maxLength={24}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder={t('home.nickname_placeholder')}
          autoFocus
        />
      </label>

      <div className="home-actions">
        <section className="home-action-block">
          <h2>{t('home.create_room')}</h2>
          <label className="home-field-inline">
            <span>{t('home.max_players')}</span>
            <select
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(Number(e.target.value))}
            >
              {[2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <button type="button" className="primary" onClick={handleCreate} disabled={busy}>
            {t('home.create_button')}
          </button>
        </section>

        <section className="home-action-block">
          <h2>{t('home.join_room')}</h2>
          <label className="home-field-inline">
            <span>{t('home.room_code')}</span>
            <input
              type="text"
              maxLength={4}
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="WXYZ"
              className="code-input"
            />
          </label>
          <button type="button" className="primary" onClick={handleJoin} disabled={busy}>
            {t('home.join_button')}
          </button>
        </section>
      </div>

      {error && <p className="home-error">{error}</p>}

      <button
        type="button"
        className="back-link"
        onClick={() => navigate('/')}
      >
        {t('gameSelect.back_to_games')}
      </button>
    </div>
  );
}

export default GamePlayLobbyPage;
