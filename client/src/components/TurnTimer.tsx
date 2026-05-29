import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './TurnTimer.css';

interface Props {
  deadline: number | null; // epoch ms
}

function TurnTimer({ deadline }: Props) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadline === null) return;
    const tick = () => setNow(Date.now());
    tick();
    const interval = setInterval(tick, 200);
    return () => clearInterval(interval);
  }, [deadline]);

  if (deadline === null) return null;
  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
  const urgent = remaining <= 10;
  return (
    <div
      className={`turn-timer ${urgent ? 'urgent' : ''}`}
      role="timer"
      aria-label={t('game.turn_timer_label', { seconds: remaining })}
    >
      ⏱ {remaining}s
    </div>
  );
}

export default TurnTimer;
