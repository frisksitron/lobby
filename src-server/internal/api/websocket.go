package api

import (
	"log"
	"net/http"

	"github.com/gorilla/websocket"

	"lobby/internal/auth"
	"lobby/internal/db"
	"lobby/internal/ws"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type WebSocketHandler struct {
	hub        *ws.Hub
	jwtService *auth.JWTService
	userRepo   *db.UserRepository
}

func NewWebSocketHandler(hub *ws.Hub, jwtService *auth.JWTService, userRepo *db.UserRepository) *WebSocketHandler {
	return &WebSocketHandler{
		hub:        hub,
		jwtService: jwtService,
		userRepo:   userRepo,
	}
}

func (h *WebSocketHandler) ServeWS(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "Missing token", http.StatusUnauthorized)
		return
	}

	claims, err := h.jwtService.ValidateAccessToken(token)
	if err != nil {
		log.Printf("Invalid token: %v", err)
		http.Error(w, "Invalid token", http.StatusUnauthorized)
		return
	}

	user, err := h.userRepo.FindByID(claims.UserID)
	if err != nil {
		log.Printf("User not found: %v", err)
		http.Error(w, "User not found", http.StatusUnauthorized)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}

	client := ws.NewClient(h.hub, conn)
	client.SetUser(user)

	client.SendHello()

	go client.WritePump()
	go client.ReadPump()
}
