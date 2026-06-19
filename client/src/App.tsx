import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import GameSelectPage from './pages/GameSelectPage';
import GamePlayLobbyPage from './pages/GamePlayLobbyPage';
import RoomPage from './pages/RoomPage';
import LanguageToggle from './components/LanguageToggle';
import { loadSession } from './lib/session';
import './App.css';

// Backward-compat for pre-Stage-3 /room/:roomId URLs. If the user's
// localStorage session still matches the room id, hop them straight into
// the correct /play/<gameType>/room/<id>; otherwise bounce them to the
// home picker so they don't land on an empty page.
function LegacyRoomRedirect() {
  const { roomId } = useParams<{ roomId: string }>();
  const saved = loadSession();
  if (saved && saved.roomId === roomId) {
    return <Navigate to={`/play/${saved.gameType}/room/${roomId}`} replace />;
  }
  return <Navigate to="/" replace />;
}

function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <header className="app-header">
          <h1 className="app-title">Card Games</h1>
          <LanguageToggle />
        </header>
        <main className="app-main">
          <Routes>
            <Route path="/" element={<GameSelectPage />} />
            <Route path="/play/:gameType" element={<GamePlayLobbyPage />} />
            <Route
              path="/play/:gameType/room/:roomId"
              element={<RoomPage />}
            />
            <Route path="/room/:roomId" element={<LegacyRoomRedirect />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
