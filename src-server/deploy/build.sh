#!/bin/bash
set -euo pipefail

# Build lobby server binary for linux/amd64.
# Usage: ./build.sh [output-path]

OUTPUT="${1:-./lobby-linux-amd64}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Building lobby (linux/amd64, CGO enabled) ==="

if [[ "$(uname -s)" == "Linux" ]] && [[ "$(uname -m)" == "x86_64" ]]; then
    echo "Native linux/amd64 detected, building directly..."
    cd "$SERVER_DIR"
    CGO_ENABLED=1 go build -ldflags="-s -w" -o "$OUTPUT" ./cmd/server
else
    # Cross-compile: need x86_64-linux-gnu-gcc
    if ! command -v x86_64-linux-gnu-gcc &>/dev/null; then
        echo "ERROR: Cross-compiling to linux/amd64 requires x86_64-linux-gnu-gcc"
        echo ""
        echo "Install it:"
        echo "  Ubuntu/Debian: sudo apt install gcc-x86-64-linux-gnu"
        echo "  Fedora/RHEL:   sudo dnf install gcc-x86_64-linux-gnu"
        echo "  macOS:         brew install messense/macos-cross-toolchains/x86_64-unknown-linux-gnu"
        echo ""
        echo "Or build on a linux/amd64 machine (CI runner, WSL, etc.)"
        exit 1
    fi

    echo "Cross-compiling with x86_64-linux-gnu-gcc..."
    cd "$SERVER_DIR"
    CC=x86_64-linux-gnu-gcc \
    GOOS=linux GOARCH=amd64 CGO_ENABLED=1 \
    go build -ldflags="-s -w" -o "$OUTPUT" ./cmd/server
fi

chmod +x "$OUTPUT"
echo "Built: $OUTPUT ($(du -h "$OUTPUT" | cut -f1))"
