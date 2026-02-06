# AGENTS.md — reef-core

## Commands

```bash
npm run dev          # Start with tsx (hot reload)
npm run build        # TypeScript → dist/
npm run start        # node dist/index.js
npm run typecheck    # tsc --noEmit (fast check)
```

No test framework yet. Run `npm run build` to validate.

## Project Structure

```
src/
├── index.ts         # Entry point — init DB, start server, handle signals
├── api.ts           # HTTP REST server (raw node http, port 7777)
├── ws.ts            # WebSocket server (real-time session events)
├── agent.ts         # Agent lifecycle — spawn/kill/output via Pi SDK or tmux
├── events.ts        # Event emitter for session state changes
├── db.ts            # SQLite via better-sqlite3 (WAL mode)
├── storage.ts       # JSON file persistence (legacy, being replaced by db)
├── tmux.ts          # Tmux-based agent backend (fallback)
├── shared-types.ts  # Source of truth for ALL shared types
└── providers/
    ├── openai.ts    # OpenAI Responses API agent runner
    └── google.ts    # Google Gemini agent runner
data/
└── reef.db          # SQLite database (gitignored)
```

## Architecture

- **Multi-provider**: Anthropic (Pi SDK), OpenAI (Responses API), Google (Gemini)
- **Multi-backend**: `sdk` (Pi SDK), `tmux` (fallback), `openai`, `google`
- **No framework**: Raw `node:http` server, no Express
- **Real-time**: WebSocket pushes session events to reef-app
- **DB**: better-sqlite3 with WAL mode, no ORM

### Data Flow

`HTTP POST /sessions` → `agent.spawn()` → provider runner → `db.insertSession()` → `events.emit()` → WebSocket broadcast

### Dependency Direction

`api.ts` → `agent.ts` → `providers/*` + `tmux.ts` → `db.ts`
`ws.ts` ← `events.ts` (listens for broadcasts)

## Code Style

- TypeScript strict mode, ESNext modules
- Files: kebab-case. Types: PascalCase. Functions: camelCase
- No `any` — use `unknown` and narrow
- Prettier: single quotes, 2-space indent, semicolons, 100 char width
- Pre-commit hook runs lint via Husky

## Where to Put New Code

- New provider? → `src/providers/<name>.ts`, wire into `agent.ts`
- New API endpoint? → `src/api.ts` (add route in the handler switch)
- New shared type? → `src/shared-types.ts` (then sync to reef-app)
- New DB operation? → `src/db.ts`

## Key Decisions

- **Raw http over Express**: Minimal deps, full control, tiny surface area
- **SQLite over Postgres**: Single-file DB, zero setup, perfect for desktop app
- **Pi SDK as primary**: Direct Claude API with streaming/tool use; tmux as fallback
- **shared-types.ts**: Single source of truth, manually synced to reef-app

## Gotchas

- Port 7777 is hardcoded (override with `REEF_PORT` env var)
- `shared-types.ts` must be manually copied to reef-app when changed
- Pi SDK import is dynamic (may not be installed) — tmux fallback kicks in
- DB lives in `data/reef.db` — don't delete during dev, it has WAL files
- Build before reporting done: `npm run build` must pass clean
