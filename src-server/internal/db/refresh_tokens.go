package db

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"lobby/internal/models"
)

type RefreshTokenRepository struct {
	db *DB
}

func NewRefreshTokenRepository(db *DB) *RefreshTokenRepository {
	return &RefreshTokenRepository{db: db}
}

func (r *RefreshTokenRepository) Create(userID, tokenHash string, expiresAt time.Time) (*models.RefreshToken, error) {
	id, err := generateID("rft")
	if err != nil {
		return nil, fmt.Errorf("generating refresh token ID: %w", err)
	}
	now := time.Now().UTC()

	_, err = r.db.Exec(
		`INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
		id, userID, tokenHash, expiresAt.UTC(), now,
	)
	if err != nil {
		return nil, fmt.Errorf("creating refresh token: %w", err)
	}

	return &models.RefreshToken{
		ID:        id,
		UserID:    userID,
		TokenHash: tokenHash,
		ExpiresAt: expiresAt,
		CreatedAt: now,
	}, nil
}

func (r *RefreshTokenRepository) FindByHash(tokenHash string) (*models.RefreshToken, error) {
	var t models.RefreshToken
	var revokedAt sql.NullTime

	err := r.db.QueryRow(
		`SELECT id, user_id, token_hash, expires_at, created_at, revoked_at FROM refresh_tokens WHERE token_hash = ?`,
		tokenHash,
	).Scan(&t.ID, &t.UserID, &t.TokenHash, &t.ExpiresAt, &t.CreatedAt, &revokedAt)

	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("querying refresh token: %w", err)
	}

	t.RevokedAt = nullTimeToPtr(revokedAt)

	return &t, nil
}

func (r *RefreshTokenRepository) Revoke(id string) error {
	result, err := r.db.Exec(
		`UPDATE refresh_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
		time.Now().UTC(),
		id,
	)
	if err != nil {
		return fmt.Errorf("revoking token: %w", err)
	}
	return checkRowsAffected(result)
}

func (r *RefreshTokenRepository) Rotate(consumedTokenID string, userID string, newTokenHash string, newExpiresAt time.Time) error {
	tx, err := r.db.Begin()
	if err != nil {
		return fmt.Errorf("starting refresh token rotation transaction: %w", err)
	}
	defer tx.Rollback()

	now := time.Now().UTC()
	result, err := tx.Exec(
		`UPDATE refresh_tokens
         SET revoked_at = ?
       WHERE id = ?
         AND revoked_at IS NULL
         AND expires_at > ?`,
		now,
		consumedTokenID,
		now,
	)
	if err != nil {
		return fmt.Errorf("revoking token during rotation: %w", err)
	}

	if err := checkRowsAffected(result); err != nil {
		if errors.Is(err, ErrNotFound) {
			return ErrNotFound
		}
		return fmt.Errorf("checking refresh token rotation rows affected: %w", err)
	}

	newID, err := generateID("rft")
	if err != nil {
		return fmt.Errorf("generating rotated refresh token ID: %w", err)
	}

	_, err = tx.Exec(
		`INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
		newID,
		userID,
		newTokenHash,
		newExpiresAt.UTC(),
		now,
	)
	if err != nil {
		return fmt.Errorf("creating rotated refresh token: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("committing refresh token rotation: %w", err)
	}

	return nil
}

func (r *RefreshTokenRepository) RevokeAllForUser(userID string) error {
	_, err := r.db.Exec(`UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`, time.Now().UTC(), userID)
	if err != nil {
		return fmt.Errorf("revoking user tokens: %w", err)
	}
	return nil
}

func (r *RefreshTokenRepository) DeleteExpired() (int64, error) {
	result, err := r.db.Exec(`DELETE FROM refresh_tokens WHERE expires_at < ?`, time.Now().UTC())
	if err != nil {
		return 0, fmt.Errorf("deleting expired tokens: %w", err)
	}

	return result.RowsAffected()
}
