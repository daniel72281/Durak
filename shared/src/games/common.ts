// Game registry — declares which games the platform supports. Stage 1 only
// knows about Durak; Stage 2 will define the GameEngine<S, A, C> interface
// each game module must conform to. Adding a new game = adding a new entry
// here + writing a games/<name>/ directory that exports the engine.

export type GameType = 'durak';
