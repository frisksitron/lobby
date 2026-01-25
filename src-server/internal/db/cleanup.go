package db

import (
	"context"
	"log"
	"time"
)

const (
	DefaultCleanupInterval = 1 * time.Hour
)

type CleanupService struct {
	magicCodes    *MagicCodeRepository
	refreshTokens *RefreshTokenRepository
	interval      time.Duration
}

func NewCleanupService(magicCodes *MagicCodeRepository, refreshTokens *RefreshTokenRepository) *CleanupService {
	return &CleanupService{
		magicCodes:    magicCodes,
		refreshTokens: refreshTokens,
		interval:      DefaultCleanupInterval,
	}
}

func (s *CleanupService) Start(ctx context.Context) {
	log.Printf("[Cleanup] Starting token cleanup service (interval: %v)", s.interval)

	s.runCleanup()

	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Printf("[Cleanup] Stopping token cleanup service")
			return
		case <-ticker.C:
			s.runCleanup()
		}
	}
}

func (s *CleanupService) runCleanup() {
	magicDeleted, err := s.magicCodes.DeleteExpired()
	if err != nil {
		log.Printf("[Cleanup] Error deleting expired magic codes: %v", err)
	} else if magicDeleted > 0 {
		log.Printf("[Cleanup] Deleted %d expired magic codes", magicDeleted)
	}

	refreshDeleted, err := s.refreshTokens.DeleteExpired()
	if err != nil {
		log.Printf("[Cleanup] Error deleting expired refresh tokens: %v", err)
	} else if refreshDeleted > 0 {
		log.Printf("[Cleanup] Deleted %d expired refresh tokens", refreshDeleted)
	}
}
