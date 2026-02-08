package api

import (
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"

	"lobby/internal/ws"
)

type WebSocketHandler struct {
	hub      *ws.Hub
	upgrader websocket.Upgrader
}

func NewWebSocketHandler(hub *ws.Hub) *WebSocketHandler {
	return &WebSocketHandler{
		hub: hub,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(r *http.Request) bool {
				return true
			},
		},
	}
}

func (h *WebSocketHandler) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}

	client := ws.NewClient(h.hub, conn)

	client.SendHello()

	go client.WritePump()
	go client.ReadPump()

	// Close clients that don't IDENTIFY within 10 seconds
	go func() {
		time.Sleep(10 * time.Second)
		if !client.IsIdentified() {
			log.Printf("Client did not identify within timeout, closing")
			client.Close()
		}
	}()
}
