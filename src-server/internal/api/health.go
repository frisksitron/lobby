package api

import (
	"net/http"

	"lobby/internal/db"
)

type HealthHandler struct {
	database *db.DB
}

func NewHealthHandler(database *db.DB) *HealthHandler {
	return &HealthHandler{database: database}
}

func (h *HealthHandler) Check(w http.ResponseWriter, r *http.Request) {
	dbStatus := "ok"
	status := http.StatusOK

	if err := h.database.Ping(); err != nil {
		dbStatus = "error"
		status = http.StatusServiceUnavailable
	}

	result := "ok"
	if status != http.StatusOK {
		result = "degraded"
	}

	writeJSON(w, status, map[string]any{
		"status": result,
		"checks": map[string]string{
			"database": dbStatus,
		},
	})
}
