import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { socket } from '../socket';
import { saveSession } from '../lib/session';
import './HomePage.css';

function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [nickname, setNickname] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleCreate = () => {
    setError(null);
    const cleanNick = nickname.trim();
    if (!cleanNick) {
      setError(t('home.error_nickname_required'));
      return;
    }
    setBusy(true);
    socket.emit('room:create', { nickname: cleanNick, maxPlayers, gameType: 'durak' }, (ack) => {
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
      });
      navigate(`/room/${ack.roomId}`, {
        state: { nickname: cleanNick, playerId: ack.playerId, isOwner: true },
      });
    });
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
    socket.emit('room:join', { roomId: cleanCode, nickname: cleanNick }, (ack) => {
      setBusy(false);
      if (!ack.ok) {
        setError(ack.error);
        return;
      }
      saveSession({
        roomId: cleanCode,
        playerId: ack.playerId,
        nickname: cleanNick,
        isOwner: false,
      });
      navigate(`/room/${cleanCode}`, {
        state: { nickname: cleanNick, playerId: ack.playerId, isOwner: false },
      });
    });
  };

  return (
    <div className="home-page">
      <p className="home-subtitle">{t('app.subtitle')}</p>

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
    </div>
  );
}

export default HomePage;
