package db

import (
	"context"
	"log/slog"
	"time"
)

const (
	DefaultCleanupInterval = 1 * time.Hour
)

type CleanupService struct {
	magicCodes         *MagicCodeRepository
	registrationTokens *RegistrationTokenRepository
	refreshTokens      *RefreshTokenRepository
	interval           time.Duration
}

func NewCleanupService(
	magicCodes *MagicCodeRepository,
	registrationTokens *RegistrationTokenRepository,
	refreshTokens *RefreshTokenRepository,
) *CleanupService {
	return &CleanupService{
		magicCodes:         magicCodes,
		registrationTokens: registrationTokens,
		refreshTokens:      refreshTokens,
		interval:           DefaultCleanupInterval,
	}
}

func (s *CleanupService) Start(ctx context.Context) {
	slog.Info("starting token cleanup service", "component", "cleanup", "interval", s.interval)

	s.runCleanup()

	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			slog.Info("stopping token cleanup service", "component", "cleanup")
			return
		case <-ticker.C:
			s.runCleanup()
		}
	}
}

func (s *CleanupService) runCleanup() {
	magicDeleted, err := s.magicCodes.DeleteExpired()
	if err != nil {
		slog.Error("error deleting expired magic codes", "component", "cleanup", "error", err)
	} else if magicDeleted > 0 {
		slog.Info("deleted expired magic codes", "component", "cleanup", "count", magicDeleted)
	}

	registrationDeleted, err := s.registrationTokens.DeleteExpired()
	if err != nil {
		slog.Error("error deleting expired registration tokens", "component", "cleanup", "error", err)
	} else if registrationDeleted > 0 {
		slog.Info("deleted expired registration tokens", "component", "cleanup", "count", registrationDeleted)
	}

	refreshDeleted, err := s.refreshTokens.DeleteExpired()
	if err != nil {
		slog.Error("error deleting expired refresh tokens", "component", "cleanup", "error", err)
	} else if refreshDeleted > 0 {
		slog.Info("deleted expired refresh tokens", "component", "cleanup", "count", refreshDeleted)
	}
}
