#!/bin/bash
set -euo pipefail

# Deploy a pre-built lobby binary to a remote server via SSH.
# Usage: ./deploy.sh --host root@myserver.com [--binary path] [--ssh-key path]

BINARY="./lobby-linux-amd64"
HOST=""
SSH_KEY=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --host)    HOST="$2"; shift 2 ;;
        --binary)  BINARY="$2"; shift 2 ;;
        --ssh-key) SSH_KEY="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

if [[ -z "$HOST" ]]; then
    echo "ERROR: --host is required"
    echo "Usage: ./deploy.sh --host root@myserver.com [--binary path] [--ssh-key path]"
    exit 1
fi

if [[ ! -f "$BINARY" ]]; then
    echo "ERROR: Binary not found: $BINARY"
    echo "Run build.sh first, or specify --binary path/to/lobby-linux-amd64"
    exit 1
fi

SSH_OPTS="-o StrictHostKeyChecking=accept-new"
if [[ -n "$SSH_KEY" ]]; then
    SSH_OPTS="$SSH_OPTS -i $SSH_KEY"
fi

echo "=== Deploying lobby to $HOST ==="

echo "[1/4] Uploading binary..."
scp $SSH_OPTS "$BINARY" "$HOST:/tmp/lobby-new"

echo "[2/4] Stopping lobby service..."
ssh $SSH_OPTS "$HOST" "systemctl stop lobby || true"

echo "[3/4] Installing binary..."
ssh $SSH_OPTS "$HOST" "mv /tmp/lobby-new /usr/local/bin/lobby && chmod +x /usr/local/bin/lobby"

echo "[4/4] Starting lobby service..."
ssh $SSH_OPTS "$HOST" "systemctl start lobby"

echo ""
echo "Waiting for service to start..."
sleep 3

# Extract the hostname/IP for health check
SERVER_IP="${HOST#*@}"
HEALTH_URL="http://${SERVER_IP}:8080/api/v1/server/info"

echo "Health check: $HEALTH_URL"
if curl -sf --max-time 5 "$HEALTH_URL" > /dev/null 2>&1; then
    echo "Deploy successful - service is healthy"
else
    echo "WARNING: Health check failed. Check logs with:"
    echo "  ssh $HOST journalctl -u lobby -n 50"
    exit 1
fi
