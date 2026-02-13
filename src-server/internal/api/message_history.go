package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"lobby/internal/constants"
	sqldb "lobby/internal/db/sqlc"
	"lobby/internal/models"
)

type MessageHandler struct {
	queries *sqldb.Queries
}

func NewMessageHandler(queries *sqldb.Queries) *MessageHandler {
	return &MessageHandler{
		queries: queries,
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

	messages := make([]*models.Message, 0, limit)

	if beforeStr != "" {
		rows, err := h.queries.ListMessageHistoryBefore(r.Context(), sqldb.ListMessageHistoryBeforeParams{
			BeforeID:  beforeStr,
			LimitRows: int64(limit),
		})
		if err != nil {
			internalError(w)
			return
		}

		messages = make([]*models.Message, 0, len(rows))
		for _, row := range rows {
			messages = append(messages, &models.Message{
				ID:              row.ID,
				AuthorID:        row.AuthorID,
				AuthorName:      row.AuthorName,
				AuthorAvatarURL: row.AuthorAvatarUrl,
				Content:         row.Content,
				CreatedAt:       row.CreatedAt,
				EditedAt:        row.EditedAt,
			})
		}
	} else {
		rows, err := h.queries.ListMessageHistory(r.Context(), int64(limit))
		if err != nil {
			internalError(w)
			return
		}

		messages = make([]*models.Message, 0, len(rows))
		for _, row := range rows {
			messages = append(messages, &models.Message{
				ID:              row.ID,
				AuthorID:        row.AuthorID,
				AuthorName:      row.AuthorName,
				AuthorAvatarURL: row.AuthorAvatarUrl,
				Content:         row.Content,
				CreatedAt:       row.CreatedAt,
				EditedAt:        row.EditedAt,
			})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(messages)
}
