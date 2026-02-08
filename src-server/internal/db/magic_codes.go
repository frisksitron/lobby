package db

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"lobby/internal/models"
)

type MagicCodeRepository struct {
	db *DB
}

func NewMagicCodeRepository(db *DB) *MagicCodeRepository {
	return &MagicCodeRepository{db: db}
}

func (r *MagicCodeRepository) Create(email, code string, expiresAt time.Time) (*models.MagicCode, error) {
	id, err := generateID("mc")
	if err != nil {
		return nil, fmt.Errorf("generating magic code ID: %w", err)
	}
	now := time.Now().UTC()

	_, err = r.db.Exec(
		`INSERT INTO magic_codes (id, email, code, expires_at, attempts, created_at) VALUES (?, ?, ?, ?, 0, ?)`,
		id, email, code, expiresAt.UTC(), now,
	)
	if err != nil {
		return nil, fmt.Errorf("creating magic code: %w", err)
	}

	return &models.MagicCode{
		ID:        id,
		Email:     email,
		Code:      code,
		ExpiresAt: expiresAt,
		Attempts:  0,
		CreatedAt: now,
	}, nil
}

func (r *MagicCodeRepository) FindLatestByEmail(email string) (*models.MagicCode, error) {
	var mc models.MagicCode
	var usedAt sql.NullTime

	err := r.db.QueryRow(
		`SELECT id, email, code, expires_at, used_at, attempts, created_at FROM magic_codes WHERE email = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1`,
		email,
	).Scan(&mc.ID, &mc.Email, &mc.Code, &mc.ExpiresAt, &usedAt, &mc.Attempts, &mc.CreatedAt)

	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("querying magic code: %w", err)
	}

	mc.UsedAt = nullTimeToPtr(usedAt)

	return &mc, nil
}

// IncrementAttempts atomically increments the attempt count only if it is
// below max, and returns the new value. Returns -1 if the code was already
// at or above the limit (no update performed).
func (r *MagicCodeRepository) IncrementAttempts(id string, max int) (int, error) {
	var attempts int
	err := r.db.QueryRow(
		`UPDATE magic_codes SET attempts = attempts + 1 WHERE id = ? AND attempts < ? RETURNING attempts`,
		id, max,
	).Scan(&attempts)

	if errors.Is(err, sql.ErrNoRows) {
		return -1, nil
	}
	if err != nil {
		return 0, fmt.Errorf("incrementing attempts: %w", err)
	}

	return attempts, nil
}

// MarkUsedIfUnused atomically marks a code as used only if it hasn't been used yet.
func (r *MagicCodeRepository) MarkUsedIfUnused(id string) (bool, error) {
	result, err := r.db.Exec(`UPDATE magic_codes SET used_at = ? WHERE id = ? AND used_at IS NULL`, time.Now().UTC(), id)
	if err != nil {
		return false, fmt.Errorf("marking code used: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("checking rows affected: %w", err)
	}

	return rows > 0, nil
}

func (r *MagicCodeRepository) DeleteExpired() (int64, error) {
	result, err := r.db.Exec(`DELETE FROM magic_codes WHERE expires_at < ?`, time.Now().UTC())
	if err != nil {
		return 0, fmt.Errorf("deleting expired codes: %w", err)
	}

	return result.RowsAffected()
}
