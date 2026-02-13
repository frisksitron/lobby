# CLAUDE.md

Component-level guidance for `src-client-desktop`.

## Scope

Electron desktop client for Lobby (Solid.js + TypeScript + electron-vite).

## Commands

```bash
# Development
npm run dev
npm run dev:instance1
npm run dev:instance2

# Quality
npm run fix
npm run typecheck

# Build
npm run build
```

## Architecture Map

- `src/main/` - Electron main process (window lifecycle, secure storage IPC, settings).
- `src/preload/` - context bridge APIs exposed to renderer.
- `src/renderer/` - Solid app UI and runtime state.

Renderer hot spots:

- `src/renderer/src/lib/auth/token-manager.ts` - access/refresh token lifecycle.
- `src/renderer/src/lib/connection/ConnectionService.ts` - connection phases and retry orchestration.
- `src/renderer/src/lib/ws/manager.ts` - WebSocket handshake, dispatch routing, token re-identify.
- `src/renderer/src/stores/connection.ts` - app-level session/server state.
- `src/renderer/src/stores/voice.ts` - voice UI state and WS/RTC integration.
- `src/renderer/src/lib/webrtc/` - SFU signaling and media pipeline.

## Auth and Connection Invariants

- Tokens are stored via main/preload APIs; renderer does not own raw secure storage.
- `token-manager` schedules proactive refresh and retries transient failures.
- `ConnectionService` starts token auto-refresh on WS connect and stops it on disconnect/auth-invalid paths.
- After refresh, `wsManager` re-sends `IDENTIFY` on the live socket (no reconnect).
- Voice state is server-authoritative; prefer WS-confirmed state over local assumptions.

## Contract Sync

When WebSocket payloads change, update both sides together:

- Server: `../src-server/internal/ws/types.go`
- Client: `src/renderer/src/lib/ws/types.ts`

## After Editing

Run:

```bash
npm run fix
npm run typecheck
```
