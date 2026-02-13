# CLAUDE.md

Repository-level guidance for working in this codebase.

## Scope

Lobby is a self-hosted Discord-like app with:

- Desktop client: Electron + Solid.js + TypeScript
- Server: Go + chi + SQLite + WebSocket + WebRTC SFU

Product model note: each server has exactly one text channel and one voice channel.

## Environment

- Windows with Git Bash.
- Use POSIX-style shell paths (for example `/c/Users/...`) when running commands.

## Component Docs

- Client guide: `src-client-desktop/CLAUDE.md`
- Server guide: `src-server/CLAUDE.md`

## Sync Rules

When changes touch auth/session flow, WebSocket contracts, or database schema/query shape:

1. Update the relevant component `CLAUDE.md` file(s).
2. Keep WebSocket contract types in sync:
   - `src-server/internal/ws/types.go`
   - `src-client-desktop/src/renderer/src/lib/ws/types.ts`
3. If SQL schema/query changes were made, keep migration/query/generated layers aligned in `src-server/internal/db/`.
