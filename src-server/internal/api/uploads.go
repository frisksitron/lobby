package api

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"mime/multipart"
	"net/http"
	"strings"
	"time"

	"lobby/internal/blob"
	"lobby/internal/db"
	sqldb "lobby/internal/db/sqlc"
	"lobby/internal/mediaurl"
	"lobby/internal/ws"
)

const chatAttachmentTTL = 24 * time.Hour

type UploadHandler struct {
	database                *db.DB
	queries                 *sqldb.Queries
	blobs                   *blob.Service
	hub                     *ws.Hub
	serverName              string
	baseURL                 string
	uploadRequestLimitBytes int64
}

func NewUploadHandler(
	database *db.DB,
	queries *sqldb.Queries,
	blobs *blob.Service,
	hub *ws.Hub,
	serverName string,
	baseURL string,
	uploadRequestLimitBytes int64,
) *UploadHandler {
	return &UploadHandler{
		database:                database,
		queries:                 queries,
		blobs:                   blobs,
		hub:                     hub,
		serverName:              serverName,
		baseURL:                 baseURL,
		uploadRequestLimitBytes: uploadRequestLimitBytes,
	}
}

type ChatUploadResponse struct {
	ID       string             `json:"id"`
	Name     string             `json:"name"`
	MimeType string             `json:"mimeType"`
	Size     int64              `json:"size"`
	URL      string             `json:"url"`
	Preview  *ChatUploadPreview `json:"preview,omitempty"`
}

type ChatUploadPreview struct {
	URL    string `json:"url"`
	Width  int64  `json:"width"`
	Height int64  `json:"height"`
}

// POST /api/v1/uploads/chat
func (h *UploadHandler) UploadChatAttachment(w http.ResponseWriter, r *http.Request) {
	userID := GetUserID(r)
	if userID == "" {
		unauthorized(w, "User not found in context")
		return
	}

	file, fileHeader, cleanup, ok := readSingleFileUpload(w, r, h.uploadRequestLimitBytes)
	if !ok {
		return
	}
	defer cleanup()
	defer file.Close()

	stored, err := h.blobs.Save(r.Context(), blob.KindChatAttachment, fileHeader.Filename, file)
	if !handleBlobSaveError(w, err) {
		return
	}

	expiresAt := time.Now().UTC().Add(chatAttachmentTTL)
	createErr := h.queries.CreateBlob(r.Context(), buildCreateBlobParams(stored, userID, &expiresAt))
	if createErr != nil {
		_ = h.blobs.Delete(stored.StoragePath)
		slog.Error("error creating chat upload blob record", "error", createErr)
		internalError(w)
		return
	}

	var preview *ChatUploadPreview
	if isImageMimeType(stored.MimeType) {
		generatedPreview, previewErr := h.createChatAttachmentPreview(r.Context(), stored.ID, stored.StoragePath)
		if previewErr != nil {
			slog.Warn("error generating chat image preview", "error", previewErr, "blob_id", stored.ID)
		} else {
			preview = generatedPreview
		}
	}

	writeJSON(w, http.StatusCreated, ChatUploadResponse{
		ID:       stored.ID,
		Name:     stored.OriginalName,
		MimeType: stored.MimeType,
		Size:     stored.SizeBytes,
		URL:      mediaurl.Blob(h.baseURL, stored.ID),
		Preview:  preview,
	})
}

// POST /api/v1/users/me/avatar
func (h *UploadHandler) UploadAvatar(w http.ResponseWriter, r *http.Request) {
	userID := GetUserID(r)
	if userID == "" {
		unauthorized(w, "User not found in context")
		return
	}

	file, fileHeader, cleanup, ok := readSingleFileUpload(w, r, h.uploadRequestLimitBytes)
	if !ok {
		return
	}
	defer cleanup()
	defer file.Close()

	normalized, err := blob.NormalizeStaticImage(file, blob.DefaultProfileImageMaxEdge, blob.DefaultProfileJPEGQuality)
	if !handleImageNormalizeError(w, err) {
		return
	}

	stored, err := h.blobs.Save(r.Context(), blob.KindAvatar, fileHeader.Filename, bytes.NewReader(normalized.Data))
	if !handleBlobSaveError(w, err) {
		return
	}

	cleanupStoredFile := true
	defer func() {
		if cleanupStoredFile {
			_ = h.blobs.Delete(stored.StoragePath)
		}
	}()

	oldAvatarBlobID := ""
	tx, err := h.database.BeginTx(r.Context(), nil)
	if err != nil {
		slog.Error("error starting avatar update transaction", "error", err, "user_id", userID)
		internalError(w)
		return
	}
	defer tx.Rollback()

	qtx := h.queries.WithTx(tx)

	userRow, err := qtx.GetActiveUserByID(r.Context(), userID)
	if errors.Is(err, sql.ErrNoRows) {
		notFound(w, "User not found")
		return
	}
	if err != nil {
		slog.Error("error loading user before avatar update", "error", err, "user_id", userID)
		internalError(w)
		return
	}
	if userRow.AvatarUrl != nil {
		if blobID, ok := mediaurl.ParseBlobID(*userRow.AvatarUrl); ok {
			oldAvatarBlobID = blobID
		}
	}

	err = qtx.CreateBlob(r.Context(), buildCreateBlobParams(stored, userID, nil))
	if err != nil {
		slog.Error("error creating avatar blob record", "error", err, "user_id", userID)
		internalError(w)
		return
	}

	avatarURL := mediaurl.Blob(h.baseURL, stored.ID)
	now := time.Now().UTC()
	rowsAffected, err := qtx.UpdateUserAvatarURL(r.Context(), sqldb.UpdateUserAvatarURLParams{
		AvatarUrl: &avatarURL,
		UpdatedAt: &now,
		ID:        userID,
	})
	if err != nil {
		slog.Error("error updating user avatar url", "error", err, "user_id", userID)
		internalError(w)
		return
	}
	if rowsAffected == 0 {
		notFound(w, "User not found")
		return
	}

	updatedUserRow, err := qtx.GetActiveUserByID(r.Context(), userID)
	if err != nil {
		slog.Error("error loading updated user after avatar update", "error", err, "user_id", userID)
		internalError(w)
		return
	}

	if err := tx.Commit(); err != nil {
		slog.Error("error committing avatar update transaction", "error", err, "user_id", userID)
		internalError(w)
		return
	}
	cleanupStoredFile = false

	user := modelUserFromDBUser(updatedUserRow)
	h.hub.BroadcastDispatch(ws.EventUserUpdate, ws.UserUpdatePayload{
		ID:       user.ID,
		Username: user.Username,
		Avatar:   user.GetAvatarURL(),
	})

	if oldAvatarBlobID != "" && oldAvatarBlobID != stored.ID {
		h.deleteBlobByIDBestEffort(r.Context(), oldAvatarBlobID, string(blob.KindAvatar))
	}

	writeJSON(w, http.StatusOK, user)
}

// POST /api/v1/server/image
func (h *UploadHandler) UploadServerImage(w http.ResponseWriter, r *http.Request) {
	userID := GetUserID(r)
	if userID == "" {
		unauthorized(w, "User not found in context")
		return
	}

	file, fileHeader, cleanup, ok := readSingleFileUpload(w, r, h.uploadRequestLimitBytes)
	if !ok {
		return
	}
	defer cleanup()
	defer file.Close()

	normalized, err := blob.NormalizeStaticImage(file, blob.DefaultProfileImageMaxEdge, blob.DefaultProfileJPEGQuality)
	if !handleImageNormalizeError(w, err) {
		return
	}

	stored, err := h.blobs.Save(
		r.Context(),
		blob.KindServerImage,
		fileHeader.Filename,
		bytes.NewReader(normalized.Data),
	)
	if !handleBlobSaveError(w, err) {
		return
	}

	cleanupStoredFile := true
	defer func() {
		if cleanupStoredFile {
			_ = h.blobs.Delete(stored.StoragePath)
		}
	}()

	tx, err := h.database.BeginTx(r.Context(), nil)
	if err != nil {
		slog.Error("error starting server image transaction", "error", err)
		internalError(w)
		return
	}
	defer tx.Rollback()

	qtx := h.queries.WithTx(tx)

	err = qtx.CreateBlob(r.Context(), buildCreateBlobParams(stored, userID, nil))
	if err != nil {
		slog.Error("error creating server image blob record", "error", err)
		internalError(w)
		return
	}

	oldSettings, err := qtx.GetServerSettings(r.Context())
	if err != nil {
		slog.Error("error loading server settings before image update", "error", err)
		internalError(w)
		return
	}

	now := time.Now().UTC()
	rowsAffected, err := qtx.SetServerIconBlobID(r.Context(), sqldb.SetServerIconBlobIDParams{
		IconBlobID: &stored.ID,
		UpdatedAt:  now,
	})
	if err != nil {
		slog.Error("error updating server icon", "error", err)
		internalError(w)
		return
	}
	if rowsAffected == 0 {
		internalError(w)
		return
	}

	if err := tx.Commit(); err != nil {
		slog.Error("error committing server image transaction", "error", err)
		internalError(w)
		return
	}
	cleanupStoredFile = false

	iconURL := mediaurl.Blob(h.baseURL, stored.ID)
	h.hub.BroadcastDispatch(ws.EventServerUpdate, ws.ServerUpdatePayload{
		Name:    h.serverName,
		IconURL: iconURL,
	})

	if oldSettings.IconBlobID != nil && *oldSettings.IconBlobID != "" && *oldSettings.IconBlobID != stored.ID {
		h.deleteBlobByIDBestEffort(r.Context(), *oldSettings.IconBlobID, string(blob.KindServerImage))
	}

	writeJSON(w, http.StatusOK, ServerInfoResponse{
		Name:           h.serverName,
		IconURL:        iconURL,
		UploadMaxBytes: h.blobs.MaxUploadBytes(),
	})
}

func buildCreateBlobParams(stored *blob.StoredBlob, uploadedBy string, expiresAt *time.Time) sqldb.CreateBlobParams {
	return sqldb.CreateBlobParams{
		ID:           stored.ID,
		Kind:         string(stored.Kind),
		UploadedBy:   uploadedBy,
		StoragePath:  stored.StoragePath,
		MimeType:     stored.MimeType,
		SizeBytes:    stored.SizeBytes,
		OriginalName: stored.OriginalName,
		ExpiresAt:    expiresAt,
		CreatedAt:    stored.CreatedAt,
	}
}

func (h *UploadHandler) deleteBlobByIDBestEffort(ctx context.Context, blobID string, allowedKinds ...string) {
	if blobID == "" {
		return
	}

	row, err := h.queries.GetBlobByID(ctx, blobID)
	if err != nil {
		return
	}

	if len(allowedKinds) > 0 {
		allowed := false
		for _, allowedKind := range allowedKinds {
			if row.Kind == allowedKind {
				allowed = true
				break
			}
		}
		if !allowed {
			return
		}
	}

	rows, err := h.queries.DeleteBlobByID(ctx, blobID)
	if err != nil || rows == 0 {
		return
	}

	if row.PreviewStoragePath != nil {
		if err := h.blobs.Delete(*row.PreviewStoragePath); err != nil {
			slog.Warn("error deleting blob preview file", "error", err, "blob_id", blobID)
		}
	}

	if err := h.blobs.Delete(row.StoragePath); err != nil {
		slog.Warn("error deleting blob file", "error", err, "blob_id", blobID)
	}
}

func (h *UploadHandler) createChatAttachmentPreview(
	ctx context.Context,
	blobID string,
	originalStoragePath string,
) (*ChatUploadPreview, error) {
	file, err := h.blobs.Open(originalStoragePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	preview, err := blob.GenerateStaticImagePreview(file, blob.DefaultPreviewMaxEdge, blob.DefaultPreviewQuality)
	if err != nil {
		return nil, err
	}

	previewPath := blob.ChatAttachmentPreviewRelativePath(blobID)
	previewSize, err := h.blobs.Write(previewPath, bytes.NewReader(preview.Data))
	if err != nil {
		return nil, err
	}

	previewMimeType := preview.MimeType
	previewSizeBytes := previewSize
	previewWidth := int64(preview.Width)
	previewHeight := int64(preview.Height)
	rowsAffected, err := h.queries.UpdateBlobPreview(ctx, sqldb.UpdateBlobPreviewParams{
		PreviewStoragePath: &previewPath,
		PreviewMimeType:    &previewMimeType,
		PreviewSizeBytes:   &previewSizeBytes,
		PreviewWidth:       &previewWidth,
		PreviewHeight:      &previewHeight,
		ID:                 blobID,
	})
	if err != nil {
		_ = h.blobs.Delete(previewPath)
		return nil, err
	}
	if rowsAffected == 0 {
		_ = h.blobs.Delete(previewPath)
		return nil, errors.New("blob row not found for preview update")
	}

	return &ChatUploadPreview{
		URL:    mediaurl.BlobPreview(h.baseURL, blobID),
		Width:  previewWidth,
		Height: previewHeight,
	}, nil
}

func isImageMimeType(mimeType string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(mimeType)), "image/")
}

func readSingleFileUpload(
	w http.ResponseWriter,
	r *http.Request,
	maxBytes int64,
) (multipart.File, *multipart.FileHeader, func(), bool) {
	if maxBytes > 0 {
		r.Body = http.MaxBytesReader(nil, r.Body, maxBytes)
	}

	err := r.ParseMultipartForm(1 << 20)
	if err != nil {
		if isBodyTooLargeError(err) {
			payloadTooLarge(w, "File exceeds maximum upload size")
		} else {
			badRequest(w, "Invalid multipart upload")
		}
		return nil, nil, func() {}, false
	}

	cleanup := func() {
		if r.MultipartForm != nil {
			r.MultipartForm.RemoveAll()
		}
	}

	file, fileHeader, err := r.FormFile("file")
	if err != nil {
		badRequest(w, "File field 'file' is required")
		cleanup()
		return nil, nil, func() {}, false
	}

	if fileHeader == nil || strings.TrimSpace(fileHeader.Filename) == "" {
		file.Close()
		cleanup()
		badRequest(w, "File name is required")
		return nil, nil, func() {}, false
	}

	return file, fileHeader, cleanup, true
}

func handleBlobSaveError(w http.ResponseWriter, err error) bool {
	if err == nil {
		return true
	}

	if errors.Is(err, blob.ErrFileTooLarge) {
		payloadTooLarge(w, "File exceeds maximum upload size")
		return false
	}
	if errors.Is(err, blob.ErrDisallowedType) {
		badRequest(w, "Unsupported file type")
		return false
	}
	if errors.Is(err, blob.ErrExecutableFile) {
		badRequest(w, "Executable files are not allowed")
		return false
	}

	slog.Error("error saving blob", "error", err)
	internalError(w)
	return false
}

func handleImageNormalizeError(w http.ResponseWriter, err error) bool {
	if err == nil {
		return true
	}

	if errors.Is(err, blob.ErrInvalidImage) {
		badRequest(w, "Invalid image file")
		return false
	}

	slog.Error("error normalizing image", "error", err)
	internalError(w)
	return false
}

func isBodyTooLargeError(err error) bool {
	var maxBytesErr *http.MaxBytesError
	if errors.As(err, &maxBytesErr) {
		return true
	}
	return strings.Contains(strings.ToLower(err.Error()), "request body too large")
}
