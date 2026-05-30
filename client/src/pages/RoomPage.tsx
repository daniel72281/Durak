import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { RoomClosedReason, RoomStatePayload } from '@shared/wire';
import type { Action, ClientGameState } from '@shared/types';
import {
  socket,
  getLatestRoomState,
  getLatestRoomClosed,
  getLatestGameState,
  clearRoomCache,
} from '../socket';
import ConfirmDialog from '../components/ConfirmDialog';
import GamePanel from '../components/GamePanel';
import GameOverDialog from '../components/GameOverDialog';
import Toast from '../components/Toast';
import { clearSession, loadSession } from '../lib/session';
import './RoomPage.css';

interface NavState {
  nickname?: string;
  playerId?: string;
  isOwner?: boolean;
}

function RoomPage() {
  const { t } = useTranslation();
  const { roomId } = useParams<{ roomId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const navStateFromRouter = (location.state ?? null) as NavState | null;
  // Fall back to localStorage if navState is missing (e.g. user refreshed
  // the page or came back to a tab whose router state was lost).
  const navState: NavState | null = (() => {
    if (navStateFromRouter?.playerId) return navStateFromRouter;
    const saved = loadSession();
    if (saved && saved.roomId === roomId) {
      return {
        nickname: saved.nickname,
        playerId: saved.playerId,
        isOwner: saved.isOwner,
      };
    }
    return navStateFromRouter;
  })();

  const [roomState, setRoomState] = useState<RoomStatePayload | null>(() => {
    const cached = getLatestRoomState();
    return cached && cached.roomId === roomId ? cached : null;
  });
  const [gameState, setGameState] = useState<ClientGameState | null>(() => {
    const cached = getLatestGameState();
    return cached && cached.roomId === roomId ? cached : null;
  });
  const [closedReason, setClosedReason] = useState<RoomClosedReason | null>(
    () => getLatestRoomClosed()?.reason ?? null,
  );
  const [timedOut, setTimedOut] = useState(false);
  const [showLeave, setShowLeave] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const hasJoinedRef = useRef(false);

  useEffect(() => {
    if (!navState?.nickname || !navState.playerId || !roomId) {
      navigate('/', { replace: true });
    }
  }, [navState, navigate, roomId]);

  useEffect(() => {
    const onRoomState = (s: RoomStatePayload) => {
      if (s.roomId === roomId) setRoomState(s);
    };
    const onGameState = (s: ClientGameState) => {
      if (s.roomId === roomId) setGameState(s);
    };
    const onClosed = (p: { reason: RoomClosedReason }) => {
      clearSession();
      setClosedReason(p.reason);
    };
    socket.on('room:state', onRoomState);
    socket.on('game:state', onGameState);
    socket.on('room:closed', onClosed);
    return () => {
      socket.off('room:state', onRoomState);
      socket.off('game:state', onGameState);
      socket.off('room:closed', onClosed);
    };
  }, [roomId]);

  useEffect(() => {
    if (roomState) hasJoinedRef.current = true;
  }, [roomState]);

  useEffect(() => {
    if (roomState || closedReason) return;
    const tmr = setTimeout(() => setTimedOut(true), 5000);
    return () => clearTimeout(tmr);
  }, [roomState, closedReason]);

  useEffect(() => () => clearRoomCache(), []);

  // Show a one-off toast at the start of each game explaining who's the
  // first attacker and why (6 of trumps / previous winner / random).
  // Keyed by a counter that increments every time we see a fresh playing
  // phase + firstAttackerReason combination, so restarts also trigger it.
  const lastShownReasonRef = useRef<string | null>(null);
  useEffect(() => {
    if (!gameState || gameState.phase !== 'playing') {
      lastShownReasonRef.current = null;
      return;
    }
    const reason = gameState.firstAttackerReason;
    if (!reason) return;
    // Use a composite key (reason + attackerIndex + first player id) so the
    // toast appears once per game start, not once per state update.
    const key = `${reason}:${gameState.attackerIndex}:${gameState.players[gameState.attackerIndex]?.id ?? ''}`;
    if (lastShownReasonRef.current === key) return;
    lastShownReasonRef.current = key;
    const nickname = gameState.players[gameState.attackerIndex]?.nickname ?? '?';
    if (reason === 'six_of_trumps') {
      setToastMessage(t('game.first_attacker_six_of_trumps', { nickname }));
    } else if (reason === 'previous_winner') {
      setToastMessage(t('game.first_attacker_previous_winner', { nickname }));
    } else {
      setToastMessage(t('game.first_attacker_random'));
    }
  }, [gameState, t]);

  // On every (re)connect, try to rejoin the room using saved credentials.
  // This handles transient socket drops AND tab refreshes — the server
  // remembers our seat for up to 60s (grace period).
  useEffect(() => {
    const tryRejoin = () => {
      const saved = loadSession();
      if (!saved || saved.roomId !== roomId) return;
      socket.emit('room:rejoin', { roomId: saved.roomId, playerId: saved.playerId }, (ack) => {
        if (!ack.ok) {
          // The session is stale (grace expired or room closed). Wipe and
          // bounce home.
          clearSession();
          navigate('/', { replace: true });
        }
      });
    };
    if (socket.connected) tryRejoin();
    socket.on('connect', tryRejoin);
    return () => {
      socket.off('connect', tryRejoin);
    };
  }, [roomId, navigate]);

  const goHome = () => navigate('/', { replace: true });

  const confirmLeave = () => {
    socket.emit('room:leave', {}, () => {
      clearSession();
      setShowLeave(false);
      goHome();
    });
  };

  const confirmClose = () => {
    socket.emit('room:close', {}, () => {
      clearSession();
      setShowClose(false);
      goHome();
    });
  };

  const handleStartGame = () => {
    socket.emit('game:start', {}, (ack) => {
      if (!ack.ok) setToastMessage(`${t('room.start_failed')}: ${ack.error}`);
    });
  };

  const handleGameAction = (action: Action) => {
    socket.emit('game:action', action, (ack) => {
      if (!ack.ok) setToastMessage(translateGameError(ack.error));
    });
  };

  // Engine returns short codes like 'attack_round_1_limit' or
  // 'attack_defender_full:3'; translate to a localised toast. Falls back to
  // the raw error for anything we don't recognise.
  function translateGameError(raw: string): string {
    if (!raw.startsWith('attack_')) return raw;
    const [code, arg] = raw.split(':');
    const key = `game.error_${code}`;
    if (code === 'attack_defender_full' && arg !== undefined) {
      return t(key, { count: Number(arg), defaultValue: raw });
    }
    return t(key, { defaultValue: raw });
  }

  if (closedReason) {
    const reasonText: Record<RoomClosedReason, string> = {
      owner_closed: t('room.closed_owner_closed'),
      owner_left: t('room.closed_owner_left'),
      player_left_mid_game: t('room.closed_player_left'),
    };
    return (
      <div className="room-closed">
        <h2>{t('room.closed_title')}</h2>
        <p>{reasonText[closedReason]}</p>
        <button type="button" className="primary" onClick={goHome}>
          {t('room.back_home')}
        </button>
      </div>
    );
  }

  if (!roomState) {
    if (timedOut) {
      return (
        <div className="room-closed">
          <h2>{t('room.timeout_title')}</h2>
          <p>{t('room.timeout_message')}</p>
          <button type="button" className="primary" onClick={goHome}>
            {t('room.back_home')}
          </button>
        </div>
      );
    }
    return <div className="room-loading">{t('room.connecting')}</div>;
  }

  // --- In-game view ---
  if (roomState.isPlaying && gameState) {
    return (
      <>
        <GamePanel
          state={gameState}
          onAction={handleGameAction}
          onShowError={setToastMessage}
        />
        <div className="in-game-actions">
          <button
            type="button"
            className="danger"
            onClick={() => setShowLeave(true)}
          >
            {t('room.leave_room')}
          </button>
        </div>
        {gameState.phase === 'finished' && (
          <GameOverDialog
            state={gameState}
            isOwner={roomState.selfPlayerId === roomState.ownerId}
            onPlayAgain={() => {
              socket.emit('game:restart', {}, (ack) => {
                if (!ack.ok) setToastMessage(ack.error);
              });
            }}
            onBackHome={() => {
              socket.emit('room:leave', {}, () => {
                clearSession();
                goHome();
              });
            }}
          />
        )}
        <ConfirmDialog
          open={showLeave}
          title={t('room.leave_confirm_title')}
          message={t('room.leave_confirm_message')}
          confirmLabel={t('room.leave_confirm_yes')}
          cancelLabel={t('room.leave_confirm_no')}
          onConfirm={confirmLeave}
          onCancel={() => setShowLeave(false)}
        />
        <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
      </>
    );
  }

  // --- Waiting-room view ---
  const isOwner = roomState.selfPlayerId === roomState.ownerId;
  const canStart = isOwner && roomState.playerCount >= 2 && !roomState.isPlaying;

  return (
    <div className="room-page">
      <section className="room-code-display">
        <span className="room-code-label">{t('room.room_code')}</span>
        <span className="room-code">{roomState.roomId}</span>
      </section>

      <p className="room-meta">
        {t('room.max_players_label', { max: roomState.maxPlayers })}
      </p>
      <p className="room-meta">
        {t('room.players_joined', {
          count: roomState.playerCount,
          max: roomState.maxPlayers,
        })}
      </p>

      {isOwner && roomState.players && (
        <ul className="room-player-list">
          {roomState.players.map((p) => (
            <li key={p.id}>
              {p.nickname}
              {p.id === roomState.ownerId && (
                <span className="badge">{t('room.owner_badge')}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {!isOwner && (
        <p className="room-waiting-msg">{t('room.waiting_for_owner')}</p>
      )}

      <div className="room-actions">
        {isOwner ? (
          <>
            <button
              type="button"
              className="primary"
              onClick={handleStartGame}
              disabled={!canStart}
            >
              {t('room.start_game')}
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => setShowClose(true)}
            >
              {t('room.close_room')}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="danger"
            onClick={() => setShowLeave(true)}
          >
            {t('room.leave_room')}
          </button>
        )}
      </div>

      <ConfirmDialog
        open={showLeave}
        title={t('room.leave_confirm_title')}
        message={t('room.leave_confirm_message')}
        confirmLabel={t('room.leave_confirm_yes')}
        cancelLabel={t('room.leave_confirm_no')}
        onConfirm={confirmLeave}
        onCancel={() => setShowLeave(false)}
      />
      <ConfirmDialog
        open={showClose}
        title={t('room.close_confirm_title')}
        message={t('room.close_confirm_message')}
        confirmLabel={t('room.close_confirm_yes')}
        cancelLabel={t('room.close_confirm_no')}
        onConfirm={confirmClose}
        onCancel={() => setShowClose(false)}
      />
      <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
    </div>
  );
}

export default RoomPage;
