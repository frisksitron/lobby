package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"lobby/internal/constants"
	"lobby/internal/db"
)

type MessageHandler struct {
	messageRepo *db.MessageRepository
	userRepo    *db.UserRepository
}

func NewMessageHandler(messageRepo *db.MessageRepository, userRepo *db.UserRepository) *MessageHandler {
	return &MessageHandler{
		messageRepo: messageRepo,
		userRepo:    userRepo,
	}
}

func (h *MessageHandler) GetHistory(w http.ResponseWriter, r *http.Request) {
	limitStr := r.URL.Query().Get("limit")
	beforeStr := r.URL.Query().Get("before")

	limit := 50
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= constants.MessageHistoryMaxLimit {
			limit = l
		}
	}

	messages, err := h.messageRepo.GetHistory(beforeStr, limit)
	if err != nil {
		internalError(w)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(messages)
}
