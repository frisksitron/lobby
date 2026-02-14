package api

import (
	"database/sql"
	"errors"
	"log/slog"
	"net/http"

	sqldb "lobby/internal/db/sqlc"
	"lobby/internal/mediaurl"
)

type ServerInfoHandler struct {
	serverName string
	baseURL    string
	uploadMax  int64
	queries    *sqldb.Queries
}

func NewServerInfoHandler(name string, baseURL string, uploadMax int64, queries *sqldb.Queries) *ServerInfoHandler {
	return &ServerInfoHandler{
		serverName: name,
		baseURL:    baseURL,
		uploadMax:  uploadMax,
		queries:    queries,
	}
}

type ServerInfoResponse struct {
	Name           string `json:"name"`
	IconURL        string `json:"iconUrl,omitempty"`
	UploadMaxBytes int64  `json:"uploadMaxBytes"`
}

// GET /api/v1/server/info
func (h *ServerInfoHandler) GetInfo(w http.ResponseWriter, r *http.Request) {
	iconURL := ""
	settings, err := h.queries.GetServerSettings(r.Context())
	if err == nil {
		if settings.IconBlobID != nil {
			iconURL = mediaurl.Blob(h.baseURL, *settings.IconBlobID)
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		slog.Error("error loading server settings", "error", err)
		internalError(w)
		return
	}

	writeJSON(w, http.StatusOK, ServerInfoResponse{
		Name:           h.serverName,
		IconURL:        iconURL,
		UploadMaxBytes: h.uploadMax,
	})
}
