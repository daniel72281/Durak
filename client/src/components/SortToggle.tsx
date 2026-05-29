import { useTranslation } from 'react-i18next';
import type { SortMode } from './Hand';
import './SortToggle.css';

interface Props {
  mode: SortMode;
  onToggle: () => void;
}

function SortToggle({ mode, onToggle }: Props) {
  const { t } = useTranslation();
  return (
    <button type="button" className="sort-toggle" onClick={onToggle}>
      {mode === 'rank' ? t('game.sort_by_rank') : t('game.sort_by_suit')}
    </button>
  );
}

export default SortToggle;
