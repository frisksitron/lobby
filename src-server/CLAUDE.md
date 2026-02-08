# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lobby is a real-time voice and text chat server (Discord-like) written in Go 1.24. It provides REST API, WebSocket, and WebRTC (SFU) capabilities. Uses SQLite for storage, chi for routing, and Pion for WebRTC.

## Build & Run

```bash
# Build
go build -o lobby ./cmd/server

# Run (development)
go run ./cmd/server -config config.dev.yaml

# Cross-compile for Linux (deployment)
CGO_ENABLED=1 CC=x86_64-linux-gnu-gcc GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o lobby-linux-amd64 ./cmd/server
```

No test suite or linting configuration exists yet. Standard `go test ./...` and `go vet ./...` apply.

## Architecture

```
cmd/server/main.go          Entry point, config loading, graceful shutdown
internal/
  api/                      HTTP handlers & middleware (chi router)
  auth/                     JWT (HS256) + magic code (passwordless login)
  config/                   YAML config loading
  constants/                Shared constants (buffer sizes, limits)
  db/                       SQLite layer (WAL mode), repositories
  email/                    SMTP service for magic codes
  models/                   Data structs (User, Message, MagicCode, RefreshToken)
  sfu/                      WebRTC Selective Forwarding Unit (Pion)
  ws/                       WebSocket hub/client, protocol (OpCodes + event types)
```

### Request Flow

1. HTTP requests route through chi middleware (logging, recovery, security headers, auth)
2. Auth endpoints issue magic codes via email, verify them, return JWT access + refresh tokens
3. WebSocket upgrade at `/ws` (token in query string) registers client with the Hub
4. Hub broadcasts events (presence, messages, typing, voice state) to connected clients
5. Voice: clients send RTC signaling through WebSocket; SFU manages peer connections and forwards media tracks

### Key Patterns

- **Repository pattern** for data access (`UserRepository`, `MessageRepository`, etc.)
- **Hub/Client pattern** for WebSocket — Hub is the central broadcaster, each Client has a send buffer
- **OpCode protocol** for WebSocket framing: OpDispatch(0), OpHello(1), OpReady(2), etc.
- **Event/Command types** for WebSocket payload routing (e.g., `MESSAGE_CREATE`, `VOICE_JOIN`)
- **Sliding window rate limiter** per-IP on sensitive endpoints
- **Prefixed IDs** — `usr_`, `msg_` + 12 random bytes hex-encoded

### WebSocket Protocol

Client → Server commands: `IDENTIFY`, `PRESENCE_SET`, `MESSAGE_SEND`, `TYPING`, `VOICE_JOIN`, `VOICE_LEAVE`, `VOICE_STATE_SET`, `RTC_OFFER`, `RTC_ANSWER`, `RTC_ICE_CANDIDATE`, `SCREEN_SHARE_START`, `SCREEN_SHARE_STOP`, `SCREEN_SHARE_SUBSCRIBE`, `SCREEN_SHARE_UNSUBSCRIBE`, `SCREEN_SHARE_READY`

Server → Client events: `PRESENCE_UPDATE`, `MESSAGE_CREATE`, `TYPING_START`, `TYPING_STOP`, `USER_UPDATE`, `VOICE_STATE_UPDATE`, `RTC_READY`, `RTC_OFFER`, `RTC_ANSWER`, `RTC_ICE_CANDIDATE`, `VOICE_SPEAKING`, `USER_JOINED`, `USER_LEFT`, `SCREEN_SHARE_UPDATE`, `ERROR`

### Database

SQLite3 with WAL mode. Tables: `users`, `magic_codes`, `refresh_tokens`, `messages`. Schema is defined inline in `internal/db/db.go` (no migration framework). A background `CleanupService` purges expired codes and tokens.

## Configuration

All config via YAML files (`config.yaml` / `config.dev.yaml`). No environment variables. Key sections: `server`, `database`, `auth`, `email`, `sfu`. JWT secret must be ≥32 chars. Dev config uses mailpit on localhost:1025 for SMTP.

## Deployment

Target: RHEL/Fedora Linux. Scripts in `deploy/`:
- `build.sh` — cross-compile binary
- `setup.sh` — provision server (systemd service, coturn, firewall)
- `deploy.sh` — upload binary via SSH, restart service, health check

Required ports: 8080/TCP (API), 3478/TCP+UDP (TURN), 50000-50100/UDP (RTP)

## Dependencies

- `go-chi/chi/v5` — HTTP router
- `gorilla/websocket` — WebSocket
- `pion/webrtc/v4` — WebRTC/SFU
- `golang-jwt/jwt/v5` — JWT tokens
- `mattn/go-sqlite3` — SQLite (requires CGO)
- `google/uuid` — UUIDs
- `gopkg.in/yaml.v3` — Config parsing
