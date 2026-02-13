package db

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"lobby/internal/models"
)

type RegistrationTokenRepository struct {
	db *DB
}

func NewRegistrationTokenRepository(db *DB) *RegistrationTokenRepository {
	return &RegistrationTokenRepository{db: db}
}

func (r *RegistrationTokenRepository) Create(email, tokenHash string, expiresAt time.Time) (*models.RegistrationToken, error) {
	id, err := generateID("rgt")
	if err != nil {
		return nil, fmt.Errorf("generating registration token ID: %w", err)
	}
	now := time.Now().UTC()

	_, err = r.db.Exec(
		`INSERT INTO registration_tokens (id, email, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
		id,
		email,
		tokenHash,
		expiresAt.UTC(),
		now,
	)
	if err != nil {
		return nil, fmt.Errorf("creating registration token: %w", err)
	}

	return &models.RegistrationToken{
		ID:        id,
		Email:     email,
		TokenHash: tokenHash,
		ExpiresAt: expiresAt,
		CreatedAt: now,
	}, nil
}

func (r *RegistrationTokenRepository) FindValid(tokenHash string) (*models.RegistrationToken, error) {
	now := time.Now().UTC()
	var token models.RegistrationToken
	var usedAt sql.NullTime

	err := r.db.QueryRow(
		`SELECT id, email, token_hash, expires_at, used_at, created_at
		 FROM registration_tokens
		 WHERE token_hash = ?
		   AND used_at IS NULL
		   AND expires_at > ?`,
		tokenHash,
		now,
	).Scan(&token.ID, &token.Email, &token.TokenHash, &token.ExpiresAt, &usedAt, &token.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("querying registration token: %w", err)
	}

	token.UsedAt = nullTimeToPtr(usedAt)
	return &token, nil
}

func (r *RegistrationTokenRepository) ConsumeValid(tokenHash string) (*models.RegistrationToken, error) {
	now := time.Now().UTC()
	var token models.RegistrationToken
	var usedAt sql.NullTime

	err := r.db.QueryRow(
		`UPDATE registration_tokens
         SET used_at = ?
       WHERE token_hash = ?
         AND used_at IS NULL
         AND expires_at > ?
       RETURNING id, email, token_hash, expires_at, used_at, created_at`,
		now,
		tokenHash,
		now,
	).Scan(&token.ID, &token.Email, &token.TokenHash, &token.ExpiresAt, &usedAt, &token.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("consuming registration token: %w", err)
	}

	token.UsedAt = nullTimeToPtr(usedAt)
	return &token, nil
}

func (r *RegistrationTokenRepository) DeleteExpired() (int64, error) {
	result, err := r.db.Exec(`DELETE FROM registration_tokens WHERE expires_at < ?`, time.Now().UTC())
	if err != nil {
		return 0, fmt.Errorf("deleting expired registration tokens: %w", err)
	}

	return result.RowsAffected()
}
