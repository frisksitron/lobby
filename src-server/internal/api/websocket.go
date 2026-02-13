package api

import (
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"lobby/internal/config"
	"lobby/internal/ws"
)

type WebSocketHandler struct {
	hub             *ws.Hub
	ipResolver      *ClientIPResolver
	upgrader        websocket.Upgrader
	allowedOrigins  []string
	identifyTimeout time.Duration
	preAuthBudget   *preAuthBudget
}

type preAuthBudget struct {
	mu      sync.Mutex
	maxIP   int
	maxAll  int
	total   int
	byIP    map[string]int
	clients map[*ws.Client]string
}

func newPreAuthBudget(maxPerIP, maxGlobal int) *preAuthBudget {
	return &preAuthBudget{
		maxIP:   maxPerIP,
		maxAll:  maxGlobal,
		byIP:    make(map[string]int),
		clients: make(map[*ws.Client]string),
	}
}

func (b *preAuthBudget) reserve(ip string) bool {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.maxIP > 0 && b.byIP[ip] >= b.maxIP {
		return false
	}
	if b.maxAll > 0 && b.total >= b.maxAll {
		return false
	}

	b.byIP[ip]++
	b.total++
	return true
}

func (b *preAuthBudget) releaseReservation(ip string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.releaseByIPLocked(ip)
}

func (b *preAuthBudget) track(client *ws.Client, ip string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.clients[client] = ip
}

func (b *preAuthBudget) releaseClient(client *ws.Client) {
	b.mu.Lock()
	defer b.mu.Unlock()

	ip, ok := b.clients[client]
	if !ok {
		return
	}

	delete(b.clients, client)
	b.releaseByIPLocked(ip)
}

func (b *preAuthBudget) releaseByIPLocked(ip string) {
	if count, ok := b.byIP[ip]; ok {
		if count <= 1 {
			delete(b.byIP, ip)
		} else {
			b.byIP[ip] = count - 1
		}
	}
	if b.total > 0 {
		b.total--
	}
}

func NewWebSocketHandler(hub *ws.Hub, cfg config.WebSocketConfig, ipResolver *ClientIPResolver) *WebSocketHandler {
	if ipResolver == nil {
		ipResolver, _ = NewClientIPResolver(nil)
	}

	h := &WebSocketHandler{
		hub:             hub,
		ipResolver:      ipResolver,
		allowedOrigins:  append([]string{}, cfg.AllowedOrigins...),
		identifyTimeout: cfg.UnauthenticatedTimeout,
		preAuthBudget: newPreAuthBudget(
			cfg.MaxUnauthenticatedPerIP,
			cfg.MaxUnauthenticatedGlobal,
		),
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
		},
	}

	h.upgrader.CheckOrigin = h.checkOrigin
	return h
}

func (h *WebSocketHandler) ServeWS(w http.ResponseWriter, r *http.Request) {
	clientIP := h.ipResolver.Resolve(r)
	if !h.preAuthBudget.reserve(clientIP) {
		slog.Warn("rejecting websocket upgrade due to pre-auth budget", "component", "ws", "ip", clientIP)
		http.Error(w, "Too many pre-auth websocket connections", http.StatusTooManyRequests)
		return
	}

	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.preAuthBudget.releaseReservation(clientIP)
		slog.Error("websocket upgrade failed", "error", err)
		return
	}

	client := ws.NewClient(h.hub, conn)
	h.preAuthBudget.track(client, clientIP)

	client.OnIdentified(func(client *ws.Client) {
		h.preAuthBudget.releaseClient(client)
	})
	client.OnClose(func(client *ws.Client) {
		h.preAuthBudget.releaseClient(client)
	})

	client.SendHello()

	go client.WritePump()
	go client.ReadPump()

	// Close clients that don't IDENTIFY within timeout
	go func() {
		time.Sleep(h.identifyTimeout)
		if !client.IsIdentified() {
			slog.Warn("client did not identify within timeout, closing", "component", "ws", "ip", clientIP)
			client.Close()
		}
	}()
}

func (h *WebSocketHandler) checkOrigin(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}

	if isLoopbackOrigin(origin) {
		return true
	}

	for _, allowed := range h.allowedOrigins {
		if originMatchesAllowed(origin, allowed) {
			return true
		}
	}

	slog.Warn("websocket origin rejected", "component", "ws", "origin", origin, "remote", r.RemoteAddr)
	return false
}

func originMatchesAllowed(origin string, allowed string) bool {
	allowed = strings.TrimSpace(allowed)
	if allowed == "" {
		return false
	}
	if strings.HasSuffix(allowed, "*") {
		return strings.HasPrefix(origin, strings.TrimSuffix(allowed, "*"))
	}
	return origin == allowed
}

func isLoopbackOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}

	hostname := u.Hostname()
	if hostname == "localhost" {
		return true
	}

	ip := net.ParseIP(hostname)
	return ip != nil && ip.IsLoopback()
}
