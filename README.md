# reef-core 🦖

Minimal agent runtime for The Reef. Spawns coding agents via the **Pi SDK** (`@mariozechner/pi-coding-agent`) with tmux fallback, exposes **HTTP REST + WebSocket** API.

## Architecture

```
┌─────────────────────────────────────────────┐
│              reef-core (port 7777)          │
│                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │  api.ts   │  │  ws.ts   │  │ events.ts│  │
│  │  (HTTP)   │  │  (WS)    │  │ (EventBus│  │
│  └─────┬─────┘  └─────┬────┘  └─────┬────┘  │
│        │              │              │       │
│  ┌─────┴──────────────┴──────────────┴────┐  │
│  │            agent.ts                     │  │
│  │  Pi SDK (createAgentSession)            │  │
│  │  ↓ fallback                             │  │
│  │  tmux.ts (claude --print)               │  │
│  └─────────────┬───────────────────────────┘  │
│                │                             │
│  ┌─────────────┴───────────────────────────┐  │
│  │            db.ts (JSON file store)      │  │
│  └─────────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

### Source Files (6 files, Nanoclaw philosophy)

| File | Purpose |
|------|---------|
| `index.ts` | Entry point |
| `api.ts` | HTTP REST server + CORS |
| `ws.ts` | WebSocket server for real-time events |
| `events.ts` | Internal event bus (bridges agent → WS) |
| `agent.ts` | Pi SDK integration + tmux fallback |
| `tmux.ts` | Tmux session management (legacy/fallback) |
| `db.ts` | JSON file persistence |

## Setup

```bash
npm install
npm run build
npm start         # or: npm run dev (tsx hot-reload)
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REEF_PORT` | `7777` | HTTP + WebSocket port |
| `REEF_DATA_DIR` | `./data` | Session data directory |
| `REEF_CLAUDE_BIN` | `claude` | Claude CLI binary (tmux fallback) |
| `ANTHROPIC_API_KEY` | — | Required for Pi SDK |

## HTTP API

### `GET /status`
Health check + stats.
```json
{"ok": true, "version": "0.2.0", "sessions": 3, "running": {"sdk": 1, "tmux": 0}, "wsClients": 2, "uptime": 123.4}
```

### `POST /sessions`
Spawn a new agent session.
```json
{"task": "Fix the bug in auth.ts", "workdir": "/path/to/project", "model": "claude-sonnet-4-20250514", "backend": "sdk"}
```
- `task` (required): The task/prompt for the agent
- `workdir` (optional): Working directory
- `model` (optional): Model ID (default: claude-sonnet-4-20250514)
- `backend` (optional): Force `"sdk"` or `"tmux"` (default: auto-detect)

Response (201):
```json
{"session": {"id": "abc123", "task": "...", "status": "running", "backend": "sdk", ...}}
```

### `GET /sessions`
List all sessions.

### `GET /sessions/:id`
Get session details + liveness check.

### `GET /sessions/:id/output`
Get accumulated output for a session.

### `POST /sessions/:id/send`
Send a follow-up message to a running session.
```json
{"message": "Also fix the tests"}
```

### `DELETE /sessions/:id`
Kill and remove a session.

## WebSocket API

Connect to `ws://localhost:7777/ws`

### Server → Client Events

```json
{"type": "output",      "sessionId": "abc123", "data": {"text": "...", "streaming": true}, "timestamp": "..."}
{"type": "status",      "sessionId": "abc123", "data": {"status": "completed"}, "timestamp": "..."}
{"type": "session.new", "sessionId": "abc123", "data": {"task": "...", "backend": "sdk"}, "timestamp": "..."}
{"type": "session.end", "sessionId": "abc123", "data": {"reason": "completed"}, "timestamp": "..."}
{"type": "tool.start",  "sessionId": "abc123", "data": {"toolName": "bash", "args": {...}}, "timestamp": "..."}
{"type": "tool.end",    "sessionId": "abc123", "data": {"toolName": "bash", "isError": false}, "timestamp": "..."}
```

### Client → Server Messages

```json
{"type": "subscribe",     "sessionId": "abc123"}
{"type": "unsubscribe",   "sessionId": "abc123"}
{"type": "subscribe_all"}
{"type": "send",          "sessionId": "abc123", "message": "Do this next"}
```

By default, new clients receive ALL events. Use `subscribe` to filter to specific sessions.

## Agent Backends

### Pi SDK (Primary)
Uses `createAgentSession()` from `@mariozechner/pi-coding-agent`. Provides:
- Proper streaming with structured events
- Tool use visibility (see what tools the agent calls)
- Follow-up messages to running sessions
- Clean abort/cancel

### tmux (Fallback)
Shells out to `claude --print` in tmux sessions. Used when:
- Pi SDK packages aren't installed
- SDK spawn fails
- Explicitly requested via `backend: "tmux"`

## Development

```bash
npm run dev          # Start with tsx (auto-reload)
npm run typecheck    # Type check without building
npm run build        # Compile to dist/
```

## License

MIT
