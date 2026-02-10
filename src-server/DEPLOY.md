# Deploying Lobby Server

## Prerequisites

- **A domain name** — Caddy handles TLS automatically, but DNS must be configured first
- **SMTP credentials** — magic code login is the only auth method, so email is required
- **A Linux server with Docker** — or a Hetzner account for one-click cloud-config provisioning

## Quick Start (Hetzner Cloud)

The included `cloud-config.yml` provisions a fully hardened Ubuntu server with Lobby running on first boot.

1. Open `cloud-config.yml` and fill in your values:
   - `<public_ssh_key>` — your SSH public key
   - `<your-domain>` — your domain name (appears in several places)
   - `<smtp-host>`, `<smtp-port>`, `<smtp-from>`, `<smtp-username>`, `<smtp-password>` — your SMTP credentials
2. Point a DNS A record to the server IP you'll get from Hetzner
3. Create a Hetzner Cloud server (Ubuntu 24.04, any size) and paste the full cloud-config into the **Cloud config** field
4. The server installs Docker, configures the firewall, generates unique secrets, and starts Lobby automatically

JWT and TURN secrets are auto-generated. The server's public IP is auto-detected via Hetzner metadata.

## Manual Deployment

### 1. DNS

Create an A record pointing your domain to the server IP. Do this first — Caddy needs DNS to resolve before it can obtain TLS certificates.

### 2. Firewall

Open the following ports:

| Port | Protocol | Service |
|------|----------|---------|
| 22 | TCP | SSH |
| 80 | TCP | HTTP (Caddy redirect) |
| 443 | TCP + UDP | HTTPS (Caddy) |
| 3478 | TCP + UDP | TURN (coturn) |
| 49152–49252 | UDP | TURN relay (coturn) |
| 50000–50100 | UDP | RTP media (SFU) |

### 3. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
```

### 4. Download files

```bash
mkdir -p /opt/lobby && cd /opt/lobby

# Docker Compose file
curl -fsSL -o docker-compose.prod.yml \
  https://raw.githubusercontent.com/frisksitron/lobby/main/src-server/docker-compose.prod.yml

# Caddyfile
curl -fsSL -o Caddyfile \
  https://raw.githubusercontent.com/frisksitron/lobby/main/src-server/Caddyfile

# Environment template
curl -fsSL -o .env \
  https://raw.githubusercontent.com/frisksitron/lobby/main/src-server/.env.example
```

### 5. Configure .env

Edit `/opt/lobby/.env` and set the required values:

```bash
# Domain & network
LOBBY_DOMAIN=lobby.example.com
LOBBY_SFU_PUBLIC_IP=203.0.113.1          # Your server's public IP

# Server
LOBBY_SERVER_NAME=Lobby Server
LOBBY_SERVER_BASE_URL=https://lobby.example.com

# Auth — generate a unique secret:
#   openssl rand -hex 32
LOBBY_JWT_SECRET=<generated-secret>

# Email (SMTP) — required
LOBBY_SMTP_HOST=smtp.example.com
LOBBY_SMTP_PORT=587
LOBBY_SMTP_FROM=lobby@example.com
LOBBY_SMTP_USERNAME=your-username
LOBBY_SMTP_PASSWORD=your-password

# TURN — generate a unique secret:
#   openssl rand -hex 32
LOBBY_TURN_SECRET=<generated-secret>
LOBBY_TURN_ADDR=lobby.example.com:3478
```

Optional variables (defaults are fine for most setups):

| Variable | Default | Description |
|----------|---------|-------------|
| `LOBBY_ACCESS_TOKEN_TTL` | `15m` | JWT access token lifetime |
| `LOBBY_REFRESH_TOKEN_TTL` | `720h` | Refresh token lifetime |
| `LOBBY_MAGIC_CODE_TTL` | `10m` | Login code lifetime |
| `LOBBY_TURN_TTL` | `24h` | TURN credential lifetime |
| `LOBBY_SFU_MIN_PORT` | `50000` | RTP port range start |
| `LOBBY_SFU_MAX_PORT` | `50100` | RTP port range end |

### 6. Start

```bash
cd /opt/lobby
docker compose -f docker-compose.prod.yml up -d
```

## Verification

Check that all three services are running:

```bash
docker compose -f docker-compose.prod.yml ps
```

Hit the health endpoint:

```bash
curl https://your-domain/health
# Expected: {"status":"ok","checks":{"database":"ok"}}
```

If something looks wrong, check the logs:

```bash
docker compose -f docker-compose.prod.yml logs lobby
docker compose -f docker-compose.prod.yml logs caddy
docker compose -f docker-compose.prod.yml logs coturn
```

## Updating

Pull the latest images and restart:

```bash
cd /opt/lobby
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

## Operations

### Viewing logs

```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Single service
docker compose -f docker-compose.prod.yml logs -f lobby
```

### Database backups

The SQLite database is stored in the `lobby-data` Docker volume. To back it up:

```bash
# Find the volume mount
docker volume inspect lobby-data

# Copy the database file out
docker compose -f docker-compose.prod.yml exec lobby cp /data/lobby.db /data/lobby.db.bak
docker cp "$(docker compose -f docker-compose.prod.yml ps -q lobby)":/data/lobby.db.bak ./lobby-backup.db
```

### Restarting services

```bash
# Restart everything
docker compose -f docker-compose.prod.yml restart

# Restart a single service
docker compose -f docker-compose.prod.yml restart lobby
```
