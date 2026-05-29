# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Durak Online** — browser-based real-time multiplayer implementation of the Russian card game **Durak** (variant *Переводной / Perevodnoy*, "with pass-on": the defender can pass an attack to the next player by playing a card of the same rank).

The full plan and design decisions live in `C:\Users\daska\.claude\plans\eager-stargazing-waterfall.md`.

## Repository layout

Three sibling directories under the project root — **no monorepo tooling (no npm workspaces, no pnpm)**, kept simple intentionally. Each has its own `package.json`:

- `client/` — Vite + React + TypeScript frontend (deployed to **Vercel**)
- `server/` — Node + Express + Socket.IO + TypeScript backend (deployed to **Railway**)
- `shared/` — Pure TS game types + engine, imported by both sides via the `@shared/*` path alias

The `shared/` folder has no runtime — its `.ts` files are consumed directly:
- Client: through a Vite alias defined in `client/vite.config.ts` and TS `paths` in `client/tsconfig.app.json`
- Server: through `tsx` (which runs TS directly); imports use relative paths from `server/src/`

## Common commands

> **Note:** Node.js is installed at `C:\Program Files\nodejs` but **not on PATH** in PowerShell. Every shell needs `$env:Path = "C:\Program Files\nodejs;" + $env:Path` prepended, or fix PATH permanently in Windows env vars.

Run client and server in **two separate terminals**:

```powershell
# Terminal 1 — backend on http://localhost:3001
cd "C:\Users\daska\Desktop\project - durak\server"
npm run dev

# Terminal 2 — frontend on http://localhost:5173
cd "C:\Users\daska\Desktop\project - durak\client"
npm run dev
```

Other:
- `cd client && npm run build` — production build (outputs to `client/dist/`)
- `cd client && npm run lint` — ESLint
- `cd server && npm run typecheck` — type-check server + shared without emitting
- `cd client && npx tsc -b` — type-check client + shared

## Architecture

**Server-authoritative.** The client sends `Action` messages over Socket.IO and just renders the `GameState` it receives back. The server runs the game engine (`shared/engine.applyAction`) as the single source of truth — this prevents cheating and sync bugs.

**Filtered state per player.** The server sends each player a `GameState` where they see only their own hand; other players' cards are represented by counts.

**No DB in MVP.** Rooms live in an in-memory `Map<roomId, GameState>` on the server. If the server restarts, in-flight games are lost — acceptable for the learning-project MVP.

**No accounts in MVP.** Players pick a nickname when joining a room; identity is just a socket session.

## Key conventions

- **Strict TS everywhere.** Client uses `verbatimModuleSyntax` — type-only imports must use `import type { … }`.
- **i18n from day one.** All user-visible strings go through `t('key')` (react-i18next). Locale files at `client/src/locales/{en,he}.json`. RTL/LTR is set automatically on `<html dir>` when language changes — components should use CSS logical properties (`margin-inline-start`, not `margin-left`) so layout flips correctly.
- **CSS Modules / plain CSS** — no Tailwind in this project (kept minimal for learning).
- **Game engine is pure functions** in `shared/src/` — easy to unit-test, no side effects. Server calls it from socket handlers; client may call it for optimistic UI later (not in MVP).

## Out of scope (MVP)

Do not implement these without an explicit ask: AI/single-player, accounts, chat, spectators, persistence (DB/Redis), PWA, fancy animations.

## Deployment (planned, not yet wired)

- **Frontend → Vercel**: root `client/`, set `VITE_SERVER_URL` env var to Railway URL.
- **Backend → Railway**: root `server/`, start command `npm start` (runs `tsx src/index.ts`). Set `CLIENT_ORIGIN` env var to the Vercel URL.
