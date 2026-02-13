package db

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"lobby/internal/constants"
	"lobby/internal/models"
)

var (
	ErrNotFound  = errors.New("not found")
	ErrDuplicate = errors.New("duplicate entry")
)

type UserRepository struct {
	db *DB
}

func NewUserRepository(db *DB) *UserRepository {
	return &UserRepository{db: db}
}

func (r *UserRepository) Create(email string, username string) (*models.User, error) {
	id, err := generateID("usr")
	if err != nil {
		return nil, fmt.Errorf("generating user ID: %w", err)
	}
	now := time.Now().UTC()

	username = strings.TrimSpace(username)
	if username == "" {
		return nil, fmt.Errorf("username is required")
	}

	_, err = r.db.Exec(
		`INSERT INTO users (id, username, email, session_version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`,
		id, username, email, now, now,
	)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return nil, ErrDuplicate
		}
		return nil, fmt.Errorf("creating user: %w", err)
	}

	return &models.User{
		ID:             id,
		Username:       username,
		Email:          email,
		SessionVersion: 1,
		CreatedAt:      now,
		UpdatedAt:      &now,
	}, nil
}

func (r *UserRepository) FindByID(id string) (*models.User, error) {
	return r.findOne(`SELECT id, COALESCE(username, ''), email, avatar_url, session_version, created_at, updated_at, deactivated_at FROM users WHERE id = ? AND deactivated_at IS NULL`, id)
}

func (r *UserRepository) FindByEmail(email string) (*models.User, error) {
	return r.findOne(`SELECT id, COALESCE(username, ''), email, avatar_url, session_version, created_at, updated_at, deactivated_at FROM users WHERE email = ?`, email)
}

func (r *UserRepository) FindAll() ([]*models.User, error) {
	rows, err := r.db.Query(
		`SELECT id, COALESCE(username, ''), avatar_url, created_at, updated_at FROM users WHERE deactivated_at IS NULL ORDER BY username`,
	)
	if err != nil {
		return nil, fmt.Errorf("querying users: %w", err)
	}
	defer rows.Close()

	var users []*models.User
	for rows.Next() {
		var u models.User
		var updatedAt sql.NullTime

		if err := rows.Scan(&u.ID, &u.Username, &u.AvatarURL, &u.CreatedAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("scanning user: %w", err)
		}

		u.UpdatedAt = nullTimeToPtr(updatedAt)
		users = append(users, &u)
	}

	return users, rows.Err()
}

func (r *UserRepository) UpdateUsername(id, username string) error {
	result, err := r.db.Exec(
		`UPDATE users SET username = ?, updated_at = ? WHERE id = ?`,
		username, time.Now().UTC(), id,
	)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return ErrDuplicate
		}
		return fmt.Errorf("updating username: %w", err)
	}
	return checkRowsAffected(result)
}

func (r *UserRepository) Deactivate(id string) error {
	now := time.Now().UTC()
	result, err := r.db.Exec(
		`UPDATE users SET deactivated_at = ?, updated_at = ? WHERE id = ? AND deactivated_at IS NULL`,
		now, now, id,
	)
	if err != nil {
		return fmt.Errorf("deactivating user: %w", err)
	}
	return checkRowsAffected(result)
}

func (r *UserRepository) Reactivate(id string) error {
	result, err := r.db.Exec(
		`UPDATE users SET deactivated_at = NULL, updated_at = ? WHERE id = ? AND deactivated_at IS NOT NULL`,
		time.Now().UTC(), id,
	)
	if err != nil {
		return fmt.Errorf("reactivating user: %w", err)
	}
	return checkRowsAffected(result)
}

func (r *UserRepository) IsUsernameAvailable(username string) (bool, error) {
	var count int
	err := r.db.QueryRow(`SELECT COUNT(*) FROM users WHERE username = ?`, username).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("checking username availability: %w", err)
	}
	return count == 0, nil
}

func (r *UserRepository) IncrementSessionVersion(id string) error {
	result, err := r.db.Exec(
		`UPDATE users SET session_version = session_version + 1, updated_at = ? WHERE id = ?`,
		time.Now().UTC(),
		id,
	)
	if err != nil {
		return fmt.Errorf("incrementing session version: %w", err)
	}

	return checkRowsAffected(result)
}

func (r *UserRepository) findOne(query string, args ...any) (*models.User, error) {
	var u models.User
	var updatedAt sql.NullTime
	var deactivatedAt sql.NullTime

	err := r.db.QueryRow(query, args...).Scan(
		&u.ID,
		&u.Username,
		&u.Email,
		&u.AvatarURL,
		&u.SessionVersion,
		&u.CreatedAt,
		&updatedAt,
		&deactivatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("querying user: %w", err)
	}

	u.UpdatedAt = nullTimeToPtr(updatedAt)
	u.DeactivatedAt = nullTimeToPtr(deactivatedAt)

	return &u, nil
}

func generateID(prefix string) (string, error) {
	b := make([]byte, constants.IDRandomBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return prefix + "_" + hex.EncodeToString(b), nil
}
