package api

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"lobby/internal/blob"
	sqldb "lobby/internal/db/sqlc"
)

type MediaHandler struct {
	queries *sqldb.Queries
	blobs   *blob.Service
}

func NewMediaHandler(queries *sqldb.Queries, blobs *blob.Service) *MediaHandler {
	return &MediaHandler{queries: queries, blobs: blobs}
}

func (h *MediaHandler) GetBlob(w http.ResponseWriter, r *http.Request) {
	blobID := strings.TrimSpace(chi.URLParam(r, "blobID"))
	if blobID == "" {
		notFound(w, "Media not found")
		return
	}

	row, err := h.queries.GetBlobByID(r.Context(), blobID)
	if errors.Is(err, sql.ErrNoRows) {
		notFound(w, "Media not found")
		return
	}
	if err != nil {
		internalError(w)
		return
	}

	file, err := h.blobs.Open(row.StoragePath)
	if errors.Is(err, os.ErrNotExist) {
		notFound(w, "Media not found")
		return
	}
	if err != nil {
		internalError(w)
		return
	}
	defer file.Close()

	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("ETag", fmt.Sprintf("\"%s\"", row.ID))
	w.Header().Set("Content-Type", row.MimeType)

	fileName := sanitizeDispositionFilename(row.OriginalName)
	if shouldForceDownload(r) {
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", fileName))
	} else if shouldRenderInline(row.MimeType) {
		w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=\"%s\"", fileName))
	} else {
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", fileName))
	}

	http.ServeContent(w, r, row.OriginalName, row.CreatedAt, file)
}

func (h *MediaHandler) GetBlobPreview(w http.ResponseWriter, r *http.Request) {
	blobID := strings.TrimSpace(chi.URLParam(r, "blobID"))
	if blobID == "" {
		notFound(w, "Media preview not found")
		return
	}

	row, err := h.queries.GetBlobByID(r.Context(), blobID)
	if errors.Is(err, sql.ErrNoRows) {
		notFound(w, "Media preview not found")
		return
	}
	if err != nil {
		internalError(w)
		return
	}

	if row.PreviewStoragePath == nil || row.PreviewMimeType == nil {
		notFound(w, "Media preview not found")
		return
	}

	file, err := h.blobs.Open(*row.PreviewStoragePath)
	if errors.Is(err, os.ErrNotExist) {
		notFound(w, "Media preview not found")
		return
	}
	if err != nil {
		internalError(w)
		return
	}
	defer file.Close()

	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("ETag", fmt.Sprintf("\"%s-preview\"", row.ID))
	w.Header().Set("Content-Type", *row.PreviewMimeType)

	fileName := sanitizeDispositionFilename(row.OriginalName)
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=\"%s\"", fileName))

	http.ServeContent(w, r, row.OriginalName, row.CreatedAt, file)
}

func sanitizeDispositionFilename(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "download"
	}
	name = strings.ReplaceAll(name, "\\", "")
	name = strings.ReplaceAll(name, "\"", "")
	name = strings.ReplaceAll(name, "\r", "")
	name = strings.ReplaceAll(name, "\n", "")
	if name == "" {
		return "download"
	}
	return name
}

func shouldRenderInline(mimeType string) bool {
	mimeType = strings.ToLower(strings.TrimSpace(mimeType))
	if strings.HasPrefix(mimeType, "image/") {
		return true
	}
	if strings.HasPrefix(mimeType, "video/") {
		return true
	}
	if strings.HasPrefix(mimeType, "audio/") {
		return true
	}
	if mimeType == "application/pdf" {
		return true
	}

	return false
}

func shouldForceDownload(r *http.Request) bool {
	download := strings.TrimSpace(r.URL.Query().Get("download"))
	if download == "" {
		return false
	}

	force, err := strconv.ParseBool(download)
	if err != nil {
		return false
	}

	return force
}
