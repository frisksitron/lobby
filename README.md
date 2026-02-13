# Lobby
Lobby is a self-hosted Discord alternative.

## Deployment Requirements
Quick install on Ubuntu 24.04:

```bash
curl -fsSL https://raw.githubusercontent.com/frisksitron/lobby/main/src-server/deploy/install.sh -o /tmp/lobby-install.sh
sudo bash /tmp/lobby-install.sh
```

Deployment requirements `src-server/deploy/DEPLOY.md`.

## Development

### Prerequisites

- [Go 1.24+](https://go.dev/dl/) (with CGO enabled for SQLite)
- [Node.js](https://nodejs.org/)
- [Mailpit](https://mailpit.axllent.org/) for local email testing

### Running the Server

```bash
cd src-server
go run ./cmd/server -config config.dev.yaml
```

The server starts on `http://localhost:8080`.

### Starting the Desktop Client

```bash
cd src-client-desktop
npm install
npm run dev
```

### Mailpit (Local Email)

The dev config sends emails to Mailpit's default SMTP port (`localhost:1025`). Run `mailpit` and open `http://localhost:8025` to view login codes.
