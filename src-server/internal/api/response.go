package api

import (
	"encoding/json"
	"net/http"

	"lobby/internal/constants"
)

const (
	ErrCodeAuthFailed     = constants.ErrCodeAuthFailed
	ErrCodeAuthExpired    = constants.ErrCodeAuthExpired
	ErrCodeRateLimited    = constants.ErrCodeRateLimited
	ErrCodeInvalidRequest = constants.ErrCodeInvalidRequest
	ErrCodeNotFound       = constants.ErrCodeNotFound
	ErrCodeConflict       = constants.ErrCodeConflict
	ErrCodeInternal       = constants.ErrCodeInternal
)

type ErrorResponse struct {
	Error ErrorDetail `json:"error"`
}

type ErrorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, ErrorResponse{
		Error: ErrorDetail{
			Code:    code,
			Message: message,
		},
	})
}

func badRequest(w http.ResponseWriter, message string) {
	writeError(w, http.StatusBadRequest, ErrCodeInvalidRequest, message)
}

func unauthorized(w http.ResponseWriter, message string) {
	writeError(w, http.StatusUnauthorized, ErrCodeAuthFailed, message)
}

func notFound(w http.ResponseWriter, message string) {
	writeError(w, http.StatusNotFound, ErrCodeNotFound, message)
}

func conflict(w http.ResponseWriter, message string) {
	writeError(w, http.StatusConflict, ErrCodeConflict, message)
}

func internalError(w http.ResponseWriter) {
	writeError(w, http.StatusInternalServerError, ErrCodeInternal, "An internal error occurred")
}
