#!/bin/bash
set -euo pipefail

# First-time Lobby server provisioning for RHEL/Fedora.
# Run on the target server. Binary is deployed separately via deploy.sh.
#
# Usage:
#   sudo ./setup.sh \
#     --name "My Server" \
#     --base-url "https://lobby.example.com" \
#     --smtp-host "smtp.example.com" \
#     --smtp-port 587 \
#     --smtp-user "user" \
#     --smtp-pass "pass" \
#     --smtp-from "noreply@example.com" \
#     [--public-ip "1.2.3.4"]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Parse arguments ---
SERVER_NAME=""
BASE_URL=""
SMTP_HOST=""
SMTP_PORT=""
SMTP_USER=""
SMTP_PASS=""
SMTP_FROM=""
PUBLIC_IP=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --name)       SERVER_NAME="$2"; shift 2 ;;
        --base-url)   BASE_URL="$2"; shift 2 ;;
        --smtp-host)  SMTP_HOST="$2"; shift 2 ;;
        --smtp-port)  SMTP_PORT="$2"; shift 2 ;;
        --smtp-user)  SMTP_USER="$2"; shift 2 ;;
        --smtp-pass)  SMTP_PASS="$2"; shift 2 ;;
        --smtp-from)  SMTP_FROM="$2"; shift 2 ;;
        --public-ip)  PUBLIC_IP="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

# --- Validate required params ---
MISSING=""
[[ -z "$SERVER_NAME" ]] && MISSING="$MISSING --name"
[[ -z "$BASE_URL" ]]    && MISSING="$MISSING --base-url"
[[ -z "$SMTP_HOST" ]]   && MISSING="$MISSING --smtp-host"
[[ -z "$SMTP_PORT" ]]   && MISSING="$MISSING --smtp-port"
[[ -z "$SMTP_USER" ]]   && MISSING="$MISSING --smtp-user"
[[ -z "$SMTP_PASS" ]]   && MISSING="$MISSING --smtp-pass"
[[ -z "$SMTP_FROM" ]]   && MISSING="$MISSING --smtp-from"

if [[ -n "$MISSING" ]]; then
    echo "ERROR: Missing required arguments:$MISSING"
    echo ""
    echo "Usage: sudo ./setup.sh --name \"My Server\" --base-url \"https://lobby.example.com\" \\"
    echo "  --smtp-host smtp.example.com --smtp-port 587 \\"
    echo "  --smtp-user user --smtp-pass pass --smtp-from noreply@example.com"
    exit 1
fi

echo "=== Lobby Server Setup ==="

# --- 1. Auto-detect public IP if not provided ---
if [[ -z "$PUBLIC_IP" ]]; then
    echo "[1/7] Detecting public IP..."
    PUBLIC_IP=$(curl -sf --max-time 5 https://ifconfig.me || true)
    if [[ -z "$PUBLIC_IP" ]]; then
        echo "ERROR: Could not auto-detect public IP. Pass --public-ip explicitly."
        exit 1
    fi
    echo "  Detected: $PUBLIC_IP"
else
    echo "[1/7] Using provided public IP: $PUBLIC_IP"
fi

# --- 2. Generate secrets ---
echo "[2/7] Generating secrets..."
JWT_SECRET=$(openssl rand -base64 32)
TURN_SECRET=$(openssl rand -base64 32)

# --- 3. Install runtime dependencies ---
echo "[3/7] Installing runtime dependencies..."
dnf install -y coturn

# --- 4. Create system user and directories ---
echo "[4/7] Creating lobby user and directories..."
if ! id -u lobby &>/dev/null; then
    useradd -r -s /usr/sbin/nologin lobby
fi
mkdir -p /etc/lobby /var/lib/lobby
chown lobby:lobby /var/lib/lobby

# --- 5. Generate config from template ---
echo "[5/7] Generating config..."
cp "$SCRIPT_DIR/config.template.yaml" /etc/lobby/config.yaml
sed -i "s|__SERVER_NAME__|$SERVER_NAME|g" /etc/lobby/config.yaml
sed -i "s|__BASE_URL__|$BASE_URL|g" /etc/lobby/config.yaml
sed -i "s|__JWT_SECRET__|$JWT_SECRET|g" /etc/lobby/config.yaml
sed -i "s|__SMTP_HOST__|$SMTP_HOST|g" /etc/lobby/config.yaml
sed -i "s|__SMTP_PORT__|$SMTP_PORT|g" /etc/lobby/config.yaml
sed -i "s|__SMTP_USER__|$SMTP_USER|g" /etc/lobby/config.yaml
sed -i "s|__SMTP_PASS__|$SMTP_PASS|g" /etc/lobby/config.yaml
sed -i "s|__SMTP_FROM__|$SMTP_FROM|g" /etc/lobby/config.yaml
sed -i "s|__PUBLIC_IP__|$PUBLIC_IP|g" /etc/lobby/config.yaml
sed -i "s|__TURN_SECRET__|$TURN_SECRET|g" /etc/lobby/config.yaml
chown root:lobby /etc/lobby/config.yaml
chmod 640 /etc/lobby/config.yaml
echo "  Config installed at /etc/lobby/config.yaml"

# --- 6. Install systemd service ---
echo "[6/7] Installing systemd service..."
cat > /etc/systemd/system/lobby.service << 'EOF'
[Unit]
Description=Lobby Voice/Text Chat Server
After=network.target

[Service]
Type=simple
User=lobby
Group=lobby
ExecStart=/usr/local/bin/lobby -config /etc/lobby/config.yaml
Restart=on-failure
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload

# --- 7. Configure coturn and firewall ---
echo "[7/7] Configuring coturn and firewall..."
cat > /etc/turnserver.conf << EOF
listening-port=3478
realm=lobby
use-auth-secret
static-auth-secret=$TURN_SECRET
no-tls
no-dtls
EOF
chmod 640 /etc/turnserver.conf

if command -v firewall-cmd &>/dev/null; then
    firewall-cmd --permanent --add-port=8080/tcp        2>/dev/null || true
    firewall-cmd --permanent --add-port=3478/udp        2>/dev/null || true
    firewall-cmd --permanent --add-port=3478/tcp        2>/dev/null || true
    firewall-cmd --permanent --add-port=50000-50100/udp 2>/dev/null || true
    firewall-cmd --reload
    echo "  Firewall rules added."
else
    echo "  WARNING: firewall-cmd not found. Manually open ports 8080/tcp, 3478/udp+tcp, 50000-50100/udp"
fi

# --- Enable services (don't start lobby - no binary yet) ---
systemctl enable coturn
systemctl start coturn
systemctl enable lobby

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Next steps:"
echo "  1. Build the binary:  ./build.sh"
echo "  2. Deploy it:         ./deploy.sh --host root@$(hostname -f || echo 'this-server')"
echo ""
echo "Generated secrets (stored in /etc/lobby/config.yaml):"
echo "  JWT Secret:  $JWT_SECRET"
echo "  TURN Secret: $TURN_SECRET"
