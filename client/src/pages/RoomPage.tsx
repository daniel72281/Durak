import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { RoomClosedReason, RoomStatePayload } from '@shared/wire';
import {
  socket,
  getLatestRoomState,
  getLatestRoomClosed,
  clearRoomCache,
} from '../socket';
import ConfirmDialog from '../components/ConfirmDialog';
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
  const navState = (location.state ?? null) as NavState | null;

  // Initialise from the module-level cache so we don't miss the room:state
  // emitted right after room:create/join (race between server emit and
  // RoomPage mount).
  const [roomState, setRoomState] = useState<RoomStatePayload | null>(() => {
    const cached = getLatestRoomState();
    return cached && cached.roomId === roomId ? cached : null;
  });
  const [closedReason, setClosedReason] = useState<RoomClosedReason | null>(
    () => getLatestRoomClosed()?.reason ?? null,
  );
  const [timedOut, setTimedOut] = useState(false);
  const [showLeave, setShowLeave] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const hasJoinedRef = useRef(false);

  // Redirect to home if nav state is missing (e.g. browser refresh wiped it).
  useEffect(() => {
    if (!navState?.nickname || !navState.playerId || !roomId) {
      navigate('/', { replace: true });
    }
  }, [navState, navigate, roomId]);

  // Listen for room state + closed events.
  useEffect(() => {
    const onState = (s: RoomStatePayload) => {
      if (s.roomId === roomId) setRoomState(s);
    };
    const onClosed = (p: { reason: RoomClosedReason }) => setClosedReason(p.reason);
    socket.on('room:state', onState);
    socket.on('room:closed', onClosed);
    return () => {
      socket.off('room:state', onState);
      socket.off('room:closed', onClosed);
    };
  }, [roomId]);

  // Mark as joined once we've received our first room:state.
  useEffect(() => {
    if (roomState) hasJoinedRef.current = true;
  }, [roomState]);

  // Safety timeout: if we don't get a room:state within 5 seconds and aren't
  // already joined, something is wrong (server lost the room, network issue).
  // Surface a clear error rather than spinning forever.
  useEffect(() => {
    if (roomState || closedReason) return;
    const t = setTimeout(() => setTimedOut(true), 5000);
    return () => clearTimeout(t);
  }, [roomState, closedReason]);

  // Clear the cache when leaving the page so a future visit starts clean.
  useEffect(() => () => clearRoomCache(), []);

  const goHome = () => navigate('/', { replace: true });

  const confirmLeave = () => {
    socket.emit('room:leave', {}, () => {
      setShowLeave(false);
      goHome();
    });
  };

  const confirmClose = () => {
    socket.emit('room:close', {}, () => {
      setShowClose(false);
      goHome();
    });
  };

  const handleStartGame = () => {
    socket.emit('game:start', {}, (ack) => {
      if (!ack.ok) {
        // Stage 1 still returns "not implemented"; surface it for now.
        alert(`${t('room.start_failed')}: ${ack.error}`);
      }
    });
  };

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
              {p.id === roomState.ownerId && <span className="badge">{t('room.owner_badge')}</span>}
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
    </div>
  );
}

export default RoomPage;
