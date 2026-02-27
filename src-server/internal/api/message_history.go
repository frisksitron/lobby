package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"lobby/internal/constants"
	sqldb "lobby/internal/db/sqlc"
	"lobby/internal/mediaurl"
	"lobby/internal/models"
)

const defaultMessageHistoryLimit = 50

type historyMessageRow struct {
	ID              string
	AuthorID        string
	AuthorName      string
	AuthorAvatarURL *string
	Content         string
	CreatedAt       time.Time
	EditedAt        *time.Time
}

type MessageHandler struct {
	queries *sqldb.Queries
	baseURL string
}

func NewMessageHandler(queries *sqldb.Queries, baseURL string) *MessageHandler {
	return &MessageHandler{
		queries: queries,
		baseURL: baseURL,
	}
}

func (h *MessageHandler) GetHistory(w http.ResponseWriter, r *http.Request) {
	limit, beforeID, validationMessage, ok := parseHistoryQuery(r)
	if !ok {
		badRequest(w, validationMessage)
		return
	}

	rows, err := h.listHistoryRows(r.Context(), beforeID, int64(limit))
	if err != nil {
		internalError(w)
		return
	}

	attachmentsByMessageID, err := h.listAttachmentsByMessageID(r.Context(), rows)
	if err != nil {
		internalError(w)
		return
	}

	messages := make([]*models.Message, 0, len(rows))
	for _, row := range rows {
		messages = append(messages, &models.Message{
			ID:              row.ID,
			AuthorID:        row.AuthorID,
			AuthorName:      row.AuthorName,
			AuthorAvatarURL: row.AuthorAvatarURL,
			Content:         row.Content,
			Attachments:     attachmentsByMessageID[row.ID],
			CreatedAt:       row.CreatedAt,
			EditedAt:        row.EditedAt,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(messages)
}

func parseHistoryQuery(r *http.Request) (int, string, string, bool) {
	limitStr := strings.TrimSpace(r.URL.Query().Get("limit"))
	beforeID := strings.TrimSpace(r.URL.Query().Get("before"))

	limit := defaultMessageHistoryLimit
	if limitStr != "" {
		parsedLimit, err := strconv.Atoi(limitStr)
		if err != nil {
			return 0, "", "Query parameter 'limit' must be an integer", false
		}
		if parsedLimit <= 0 || parsedLimit > constants.MessageHistoryMaxLimit {
			return 0, "", fmt.Sprintf("Query parameter 'limit' must be between 1 and %d", constants.MessageHistoryMaxLimit), false
		}
		limit = parsedLimit
	}

	if beforeID != "" && !isValidMessageID(beforeID) {
		return 0, "", "Query parameter 'before' must be a valid message ID", false
	}

	return limit, beforeID, "", true
}

func isValidMessageID(id string) bool {
	if !strings.HasPrefix(id, "msg_") {
		return false
	}

	hexPart := strings.TrimPrefix(id, "msg_")
	if len(hexPart) != constants.IDRandomBytes*2 {
		return false
	}

	for _, r := range hexPart {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return false
		}
	}

	return true
}

func (h *MessageHandler) listHistoryRows(ctx context.Context, beforeID string, limitRows int64) ([]historyMessageRow, error) {
	if beforeID != "" {
		rows, err := h.queries.ListMessageHistoryBefore(ctx, sqldb.ListMessageHistoryBeforeParams{
			BeforeID:  beforeID,
			LimitRows: limitRows,
		})
		if err != nil {
			return nil, err
		}

		mapped := make([]historyMessageRow, 0, len(rows))
		for _, row := range rows {
			mapped = append(mapped, historyMessageRow{
				ID:              row.ID,
				AuthorID:        row.AuthorID,
				AuthorName:      row.AuthorName,
				AuthorAvatarURL: row.AuthorAvatarUrl,
				Content:         row.Content,
				CreatedAt:       row.CreatedAt,
				EditedAt:        row.EditedAt,
			})
		}

		return mapped, nil
	}

	rows, err := h.queries.ListMessageHistory(ctx, limitRows)
	if err != nil {
		return nil, err
	}

	mapped := make([]historyMessageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, historyMessageRow{
			ID:              row.ID,
			AuthorID:        row.AuthorID,
			AuthorName:      row.AuthorName,
			AuthorAvatarURL: row.AuthorAvatarUrl,
			Content:         row.Content,
			CreatedAt:       row.CreatedAt,
			EditedAt:        row.EditedAt,
		})
	}

	return mapped, nil
}

func (h *MessageHandler) listAttachmentsByMessageID(ctx context.Context, rows []historyMessageRow) (map[string][]models.MessageAttachment, error) {
	attachmentsByMessageID := make(map[string][]models.MessageAttachment, len(rows))
	if len(rows) == 0 {
		return attachmentsByMessageID, nil
	}

	messageIDs := make([]*string, 0, len(rows))
	for _, row := range rows {
		messageID := row.ID
		messageIDs = append(messageIDs, &messageID)
	}

	attachments, err := h.queries.ListMessageAttachmentsByMessageIDs(ctx, messageIDs)
	if err != nil {
		return nil, err
	}

	for _, attachment := range attachments {
		if attachment.MessageID == nil || *attachment.MessageID == "" {
			continue
		}

		mapped := h.modelAttachment(
			attachment.ID,
			attachment.OriginalName,
			attachment.MimeType,
			attachment.SizeBytes,
			attachment.PreviewStoragePath,
			attachment.PreviewWidth,
			attachment.PreviewHeight,
		)
		messageID := *attachment.MessageID
		attachmentsByMessageID[messageID] = append(attachmentsByMessageID[messageID], mapped)
	}

	return attachmentsByMessageID, nil
}

func (h *MessageHandler) modelAttachment(
	id string,
	originalName string,
	mimeType string,
	sizeBytes int64,
	previewStoragePath *string,
	previewWidth *int64,
	previewHeight *int64,
) models.MessageAttachment {
	mapped := models.MessageAttachment{
		ID:       id,
		Name:     originalName,
		MimeType: mimeType,
		Size:     sizeBytes,
		URL:      mediaurl.Blob(h.baseURL, id),
	}

	if previewStoragePath != nil {
		mapped.PreviewURL = mediaurl.BlobPreview(h.baseURL, id)
	}
	if previewWidth != nil {
		mapped.PreviewWidth = *previewWidth
	}
	if previewHeight != nil {
		mapped.PreviewHeight = *previewHeight
	}

	return mapped
}
