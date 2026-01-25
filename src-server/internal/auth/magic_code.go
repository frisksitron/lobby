package auth

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"time"
)

const MaxAttempts = 5

type MagicCodeService struct {
	ttl time.Duration
}

func NewMagicCodeService(ttl time.Duration) *MagicCodeService {
	return &MagicCodeService{ttl: ttl}
}

// GenerateCode creates a 6-digit zero-padded numeric code using crypto/rand
func (s *MagicCodeService) GenerateCode() (string, error) {
	max := big.NewInt(1000000)
	n, err := rand.Int(rand.Reader, max)
	if err != nil {
		return "", fmt.Errorf("generating random code: %w", err)
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// ExpiresAt returns when a newly created code should expire
func (s *MagicCodeService) ExpiresAt() time.Time {
	return time.Now().Add(s.ttl)
}
