// Renders a short trail of card-back "ghost" rectangles that fly from
// the centre of the table to a player chip — used to visualise the
// defender picking up the pile from the perspective of other players
// (the defender themselves sees the table cards naturally fly back to
// their hand via the layoutId animations on DraggableCard).

import { useEffect } from 'react';
import { motion } from 'framer-motion';

interface Props {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  count: number;
  onDone: () => void;
}

const GHOST_W = 70;
const GHOST_H = 102;

function TakeFlightOverlay({ fromX, fromY, toX, toY, count, onDone }: Props) {
  // Cap to 5 visible ghosts so a "took 8 cards" event doesn't flood the
  // screen — the visual conveys "many cards" regardless.
  const ghostCount = Math.min(Math.max(count, 2), 5);
  const stagger = 0.08;
  const flightDuration = 0.55;

  useEffect(() => {
    const totalMs = (ghostCount - 1) * stagger * 1000 + flightDuration * 1000 + 50;
    const t = window.setTimeout(onDone, totalMs);
    return () => window.clearTimeout(t);
  }, [ghostCount, onDone]);

  const ghosts = Array.from({ length: ghostCount });

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 100,
      }}
    >
      {ghosts.map((_, i) => (
        <motion.div
          key={i}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: GHOST_W,
            height: GHOST_H,
            borderRadius: 6,
            background: 'linear-gradient(135deg, #be1d1d 0%, #7a1010 100%)',
            border: '3px solid #f3e5c4',
            boxShadow:
              'inset 0 0 0 1px rgba(0,0,0,0.4), 0 4px 10px rgba(0,0,0,0.55)',
          }}
          initial={{
            x: fromX - GHOST_W / 2,
            y: fromY - GHOST_H / 2,
            scale: 1,
            opacity: 0,
            rotate: 0,
          }}
          animate={{
            x: toX - GHOST_W / 2,
            y: toY - GHOST_H / 2,
            scale: 0.35,
            opacity: [0, 1, 1, 0],
            rotate: (i % 2 === 0 ? 1 : -1) * (10 + i * 4),
          }}
          transition={{
            duration: flightDuration,
            delay: i * stagger,
            ease: [0.34, 0.05, 0.6, 1],
            opacity: {
              duration: flightDuration,
              delay: i * stagger,
              times: [0, 0.15, 0.7, 1],
            },
          }}
        />
      ))}
    </div>
  );
}

export default TakeFlightOverlay;
