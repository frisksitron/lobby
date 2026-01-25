package api

import (
	"net/http"
)

type ServerInfoHandler struct {
	serverName string
}

func NewServerInfoHandler(name string) *ServerInfoHandler {
	return &ServerInfoHandler{
		serverName: name,
	}
}

type ServerInfoResponse struct {
	Name string `json:"name"`
}

// GET /api/v1/server/info
func (h *ServerInfoHandler) GetInfo(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, ServerInfoResponse{
		Name: h.serverName,
	})
}
