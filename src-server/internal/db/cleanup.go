package db

import (
	"context"
	"log/slog"
	"time"

	sqldb "lobby/internal/db/sqlc"
)

const (
	DefaultCleanupInterval = 1 * time.Hour
)

type CleanupService struct {
	queries  *sqldb.Queries
	interval time.Duration
}

func NewCleanupService(queries *sqldb.Queries) *CleanupService {
	return &CleanupService{
		queries:  queries,
		interval: DefaultCleanupInterval,
	}
}

func (s *CleanupService) Start(ctx context.Context) {
	slog.Info("starting token cleanup service", "component", "cleanup", "interval", s.interval)

	s.runCleanup(ctx)

	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			slog.Info("stopping token cleanup service", "component", "cleanup")
			return
		case <-ticker.C:
			s.runCleanup(ctx)
		}
	}
}

func (s *CleanupService) runCleanup(ctx context.Context) {
	expiresBefore := time.Now().UTC()

	magicDeleted, err := s.queries.DeleteExpiredMagicCodes(ctx, expiresBefore)
	if err != nil {
		slog.Error("error deleting expired magic codes", "component", "cleanup", "error", err)
	} else if magicDeleted > 0 {
		slog.Info("deleted expired magic codes", "component", "cleanup", "count", magicDeleted)
	}

	registrationDeleted, err := s.queries.DeleteExpiredRegistrationTokens(ctx, expiresBefore)
	if err != nil {
		slog.Error("error deleting expired registration tokens", "component", "cleanup", "error", err)
	} else if registrationDeleted > 0 {
		slog.Info("deleted expired registration tokens", "component", "cleanup", "count", registrationDeleted)
	}

	refreshDeleted, err := s.queries.DeleteExpiredRefreshTokens(ctx, expiresBefore)
	if err != nil {
		slog.Error("error deleting expired refresh tokens", "component", "cleanup", "error", err)
	} else if refreshDeleted > 0 {
		slog.Info("deleted expired refresh tokens", "component", "cleanup", "count", refreshDeleted)
	}
}
