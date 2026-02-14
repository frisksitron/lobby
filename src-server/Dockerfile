FROM golang:1.24-alpine AS builder

RUN apk add --no-cache gcc musl-dev

WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .

RUN CGO_ENABLED=1 go build -ldflags="-s -w" -o lobby ./cmd/server

FROM alpine:3.21

RUN apk add --no-cache ca-certificates

COPY --from=builder /build/lobby /usr/local/bin/lobby

RUN mkdir -p /data /data/blobs
VOLUME /data

ENV LOBBY_DATABASE_PATH=/data/lobby.db
ENV LOBBY_BLOB_ROOT=/data/blobs

EXPOSE 8080/tcp
EXPOSE 50000-50100/udp

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1

ENTRYPOINT ["lobby"]
