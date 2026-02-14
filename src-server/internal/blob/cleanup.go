package blob

import (
	"context"
	"log/slog"
	"time"

	sqldb "lobby/internal/db/sqlc"
)

const (
	DefaultCleanupInterval = 1 * time.Hour
	DefaultCleanupBatch    = 100
)

type CleanupService struct {
	queries   *sqldb.Queries
	blobs     *Service
	interval  time.Duration
	batchSize int64
}

func NewCleanupService(queries *sqldb.Queries, blobs *Service) *CleanupService {
	return &CleanupService{
		queries:   queries,
		blobs:     blobs,
		interval:  DefaultCleanupInterval,
		batchSize: DefaultCleanupBatch,
	}
}

func (s *CleanupService) Start(ctx context.Context) {
	slog.Info("starting blob cleanup service", "component", "blob_cleanup", "interval", s.interval)

	s.runCleanup(ctx)

	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			slog.Info("stopping blob cleanup service", "component", "blob_cleanup")
			return
		case <-ticker.C:
			s.runCleanup(ctx)
		}
	}
}

func (s *CleanupService) runCleanup(ctx context.Context) {
	now := time.Now().UTC()
	rows, err := s.queries.ListExpiredUnclaimedChatBlobs(ctx, sqldb.ListExpiredUnclaimedChatBlobsParams{
		Now:       &now,
		LimitRows: s.batchSize,
	})
	if err != nil {
		slog.Error("error listing expired chat blobs", "component", "blob_cleanup", "error", err)
		return
	}

	for _, row := range rows {
		rowsAffected, err := s.queries.DeleteBlobByID(ctx, row.ID)
		if err != nil {
			slog.Error("error deleting expired chat blob row", "component", "blob_cleanup", "error", err, "blob_id", row.ID)
			continue
		}
		if rowsAffected == 0 {
			continue
		}

		if row.PreviewStoragePath != nil {
			if err := s.blobs.Delete(*row.PreviewStoragePath); err != nil {
				slog.Warn("error deleting expired chat blob preview", "component", "blob_cleanup", "error", err, "blob_id", row.ID)
			}
		}

		if err := s.blobs.Delete(row.StoragePath); err != nil {
			slog.Warn("error deleting expired chat blob file", "component", "blob_cleanup", "error", err, "blob_id", row.ID)
		}
	}

	if len(rows) > 0 {
		slog.Info("deleted expired chat blobs", "component", "blob_cleanup", "count", len(rows))
	}
}
