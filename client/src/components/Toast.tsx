import { useEffect } from 'react';
import './Toast.css';

interface Props {
  message: string | null;
  onDismiss: () => void;
  durationMs?: number;
}

// Minimal auto-dismissing toast for ephemeral errors. Replaces alert().
function Toast({ message, onDismiss, durationMs = 3000 }: Props) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(t);
  }, [message, onDismiss, durationMs]);

  if (!message) return null;
  return (
    <div className="toast" role="alert">
      {message}
    </div>
  );
}

export default Toast;
