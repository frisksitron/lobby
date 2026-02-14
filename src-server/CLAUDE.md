# CLAUDE.md

Component-level guidance for `src-server`.

## Scope

Go server for Lobby (REST + WebSocket + WebRTC SFU) with SQLite persistence.

## Commands

```bash
# Build / run
go build -o lobby ./cmd/server
go run ./cmd/server -config config.dev.yaml

# Validation
go test ./...
go vet ./...

# Regenerate typed SQL layer after SQL edits
go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.30.0 generate -f sqlc.yaml
```

## Architecture Map

- `cmd/server/main.go` - startup, config load, DB open, cleanup service, HTTP server lifecycle.
- `internal/api/` - REST handlers, middleware, router wiring.
- `internal/ws/` - WS protocol types, hub/client lifecycle, SFU signaling bridge.
- `internal/sfu/` - WebRTC SFU and screen-share pipeline.
- `internal/blob/` - local filesystem blob storage + orphan cleanup service.
- `internal/db/` - SQLite open/migrations, query definitions, generated sqlc layer.

Data layer paths:

- Migrations: `internal/db/migrations/*.sql`
- Query definitions: `internal/db/queries/*.sql`
- Generated sqlc: `internal/db/sqlc/*.go`

## Data Layer Rules

- Schema source of truth is migrations, not inline SQL in Go.
- Runtime query API comes from `database.Queries()` (`*sqldb.Queries`).
- Keep migrations, query files, and generated sqlc output aligned in the same change.
- Blob schema/query changes must keep these layers in sync:
  - `blobs`
  - `server_settings`
- Blob baseline schema lives in `internal/db/migrations/00002_blob_storage.sql` (including preview columns).

## Auth and Session Invariants

- Magic codes, registration tokens, and refresh tokens are stored hashed.
- Refresh tokens are single-use and rotated transactionally.
- Access JWT `sessionVersion` is enforced in both:
  - REST auth middleware (`internal/api/middleware.go`)
  - WS `IDENTIFY` validation (`internal/ws/client.go`)
- Logout/deactivation flows revoke refresh tokens and bump `sessionVersion`.

## WebSocket Contract Rules

- Wire contract source of truth: `internal/ws/types.go`.
- Client mirror must stay in sync: `../src-client-desktop/src/renderer/src/lib/ws/types.ts`.
- Handshake flow is `HELLO -> IDENTIFY -> READY`.
- Re-`IDENTIFY` is allowed for token refresh only when the token resolves to the same user.
- `MESSAGE_SEND` / `MESSAGE_CREATE` attachment fields must stay mirrored server/client.
- `SERVER_UPDATE` payloads (for server metadata like icon changes) must stay mirrored server/client.

## Before Finishing

- Run `go test ./...` and `go vet ./...`.
- If SQL changed, regenerate sqlc output and include generated files.
