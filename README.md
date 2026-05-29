# Durak Online

Browser-based real-time multiplayer implementation of the Russian card game **Durak** (variant *Переводной / Perevodnoy* — "with pass-on").

> Status: **early scaffold** — Hello-World handshake between client and server works. Game logic not yet implemented.

## Stack

| Layer    | Tech                                              | Hosting  |
| -------- | ------------------------------------------------- | -------- |
| Frontend | Vite + React 19 + TypeScript + react-i18next      | Vercel   |
| Backend  | Node + Express + Socket.IO + TypeScript           | Railway  |
| Shared   | Pure TS game engine, imported by both sides       | —        |

## Local development

### Prerequisites

- **Node.js 20+** and **npm**. If installed but missing from PATH (Windows), either fix PATH permanently or prepend in each PowerShell session:
  ```powershell
  $env:Path = "C:\Program Files\nodejs;" + $env:Path
  ```
- **Git** (any modern version).

### One-time setup

```powershell
cd client
npm install
cd ../server
npm install
```

### Run

Open **two terminals**:

```powershell
# Terminal 1 — backend (http://localhost:3001)
cd server
npm run dev

# Terminal 2 — frontend (http://localhost:5173)
cd client
npm run dev
```

Open <http://localhost:5173>. You should see a green "Connected" dot and a "Welcome to Durak server" message. Click the language button (top-right) to switch between English and Hebrew (RTL).

## Project layout

```
project - durak/
├── client/     Vite + React + TS — UI
├── server/     Node + Express + Socket.IO + TS — game server
├── shared/     Pure-TS types + game engine (imported by both)
├── CLAUDE.md   Guidance for Claude Code AI assistant
└── README.md   This file
```

## License

TBD.
