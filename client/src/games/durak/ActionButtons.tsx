import { useTranslation } from 'react-i18next';
import './ActionButtons.css';

interface Props {
  canTake: boolean;
  canPass: boolean;
  onTake: () => void;
  onPass: () => void;
}

function ActionButtons({ canTake, canPass, onTake, onPass }: Props) {
  const { t } = useTranslation();
  if (!canTake && !canPass) return null;
  return (
    <div className="action-buttons">
      {canTake && (
        <button type="button" className="primary" onClick={onTake}>
          {t('games.durak.take')}
        </button>
      )}
      {canPass && (
        <button type="button" className="primary" onClick={onPass}>
          {t('games.durak.pass')}
        </button>
      )}
    </div>
  );
}

export default ActionButtons;
