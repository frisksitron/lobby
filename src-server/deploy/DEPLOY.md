# Lobby Server Requirements

## Platform

- Official quick-install target: Ubuntu 24.04 LTS
- CPU architecture: x86_64/amd64
- Container runtime: Docker Engine + Docker Compose plugin

## External Dependencies

- Public domain with an `A` record pointing to the server public IPv4
- SMTP provider (email login is required)

## Quick Install (Fresh Host)

`install.sh` is a one-time installer for a new Ubuntu 24.04 host.

The installer requires an interactive terminal.

```bash
curl -fsSL https://raw.githubusercontent.com/frisksitron/lobby/main/src-server/deploy/install.sh -o /tmp/lobby-install.sh
sudo bash /tmp/lobby-install.sh
```

The installer exits if it detects an existing installation in the target install directory.
Use Docker Compose for upgrades:

```bash
docker compose -f /opt/lobby/docker-compose.prod.yml --env-file /opt/lobby/.env pull
docker compose -f /opt/lobby/docker-compose.prod.yml --env-file /opt/lobby/.env up -d
```

## Required Network Ports

| Port | Protocol | Service |
|------|----------|---------|
| 22 | TCP | SSH |
| 80 | TCP | HTTP (ACME challenge + redirect) |
| 443 | TCP + UDP | HTTPS |
| 3478 | TCP + UDP | TURN signaling |
| 49152-49252 | UDP | TURN relay range |
| 50000-50100 | UDP | SFU RTP media range |

## Runtime Environment Variables

| Variable | Requirement | Notes |
|----------|-------------|-------|
| `LOBBY_DOMAIN` | required | Public domain used for HTTPS and TURN realm |
| `LOBBY_IMAGE_TAG` | required | Server image tag (use `latest` for the default path) |
| `LOBBY_JWT_SECRET` | required | Minimum 32 characters |
| `LOBBY_SERVER_BASE_URL` | required | Public HTTPS base URL, usually `https://<domain>` |
| `LOBBY_SFU_PUBLIC_IP` | required | Server public IPv4 advertised for media |
| `LOBBY_SMTP_FROM` | required | Sender email address |
| `LOBBY_SMTP_HOST` | required | SMTP host |
| `LOBBY_SMTP_PASSWORD` | optional | Required only if SMTP provider needs auth |
| `LOBBY_SMTP_PORT` | required | SMTP port |
| `LOBBY_SMTP_USERNAME` | optional | Required only if SMTP provider needs auth |
| `LOBBY_TURN_ADDR` | required | TURN endpoint, usually `<domain>:3478` |
| `LOBBY_TURN_SECRET` | required | Shared secret for TURN auth |

When using `install.sh`, `LOBBY_SERVER_BASE_URL`, `LOBBY_JWT_SECRET`,
`LOBBY_TURN_SECRET`, and `LOBBY_TURN_ADDR` are generated/derived automatically.

See `src-server/deploy/.env.example` for full config surface.

## Persistence Requirements

- Persistent writable storage for `/data/lobby.db`
- SQLite runs in WAL mode; backup must include `lobby.db`, `lobby.db-wal`, and `lobby.db-shm` when the process is live

## Runtime Health Expectations

- Health endpoint `GET /health` returns `{"status":"ok","checks":{"database":"ok"}}`
- HTTPS is reachable at `https://<domain>`
- UDP media and TURN ranges are reachable from clients
