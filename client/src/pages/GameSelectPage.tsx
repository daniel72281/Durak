// Landing page: pick a game. Clicking a tile navigates to that game's
// lobby (/play/<gameType>) where the user enters a nickname and creates
// or joins a room. Each game gets its own tile so future additions are
// just one entry in this list.

import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { GameType } from '@shared/games/common';
import './GameSelectPage.css';

interface GameTile {
  gameType: GameType;
  available: boolean;
  nameKey: string;
  descKey: string;
}

// Update Shithead's English/Hebrew description now that the game is live.

const TILES: GameTile[] = [
  {
    gameType: 'durak',
    available: true,
    nameKey: 'gameSelect.durak_name',
    descKey: 'gameSelect.durak_description',
  },
  {
    gameType: 'shithead',
    available: true,
    nameKey: 'gameSelect.shithead_name',
    descKey: 'gameSelect.shithead_description',
  },
];

function GameSelectPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="game-select-page">
      <h2 className="game-select-title">{t('gameSelect.title')}</h2>
      <div className="game-select-grid">
        {TILES.map((tile) => (
          <button
            type="button"
            key={tile.gameType}
            className={`game-tile ${tile.available ? '' : 'unavailable'}`}
            onClick={() =>
              tile.available && navigate(`/play/${tile.gameType}`)
            }
            disabled={!tile.available}
          >
            <span className="game-tile-name">{t(tile.nameKey)}</span>
            <span className="game-tile-desc">{t(tile.descKey)}</span>
            {!tile.available && (
              <span className="game-tile-soon">{t('gameSelect.coming_soon')}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export default GameSelectPage;
