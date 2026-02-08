package db

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"lobby/internal/constants"
	"lobby/internal/models"
)

type MessageRepository struct {
	db *DB
}

func NewMessageRepository(db *DB) *MessageRepository {
	return &MessageRepository{db: db}
}

func (r *MessageRepository) Create(authorID, content string) (*models.Message, error) {
	id, err := generateID("msg")
	if err != nil {
		return nil, fmt.Errorf("generating message ID: %w", err)
	}
	now := time.Now().UTC()

	_, err = r.db.Exec(
		`INSERT INTO messages (id, author_id, content, created_at) VALUES (?, ?, ?, ?)`,
		id, authorID, content, now,
	)
	if err != nil {
		return nil, fmt.Errorf("creating message: %w", err)
	}

	return &models.Message{
		ID:        id,
		AuthorID:  authorID,
		Content:   content,
		CreatedAt: now,
	}, nil
}

func (r *MessageRepository) GetHistory(beforeID string, limit int) ([]*models.Message, error) {
	if limit <= 0 || limit > constants.MessageHistoryMaxLimit {
		limit = 50
	}

	query := `SELECT m.id, m.author_id, u.username, u.avatar_url, m.content, m.created_at, m.edited_at
		FROM messages m
		LEFT JOIN users u ON m.author_id = u.id`
	var args []any

	if beforeID != "" {
		query += ` WHERE m.rowid < (SELECT rowid FROM messages WHERE id = ?)`
		args = append(args, beforeID)
	}
	query += ` ORDER BY m.rowid DESC LIMIT ?`
	args = append(args, limit)

	rows, err := r.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("querying messages: %w", err)
	}
	defer rows.Close()

	messages := make([]*models.Message, 0)
	for rows.Next() {
		var m models.Message
		var editedAt sql.NullTime

		err := rows.Scan(&m.ID, &m.AuthorID, &m.AuthorName, &m.AuthorAvatarURL, &m.Content, &m.CreatedAt, &editedAt)
		if err != nil {
			return nil, fmt.Errorf("scanning message: %w", err)
		}

		m.EditedAt = nullTimeToPtr(editedAt)
		messages = append(messages, &m)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating messages: %w", err)
	}

	return messages, nil
}

func (r *MessageRepository) FindByID(id string) (*models.Message, error) {
	var m models.Message
	var editedAt sql.NullTime

	err := r.db.QueryRow(
		`SELECT id, author_id, content, created_at, edited_at FROM messages WHERE id = ?`,
		id,
	).Scan(&m.ID, &m.AuthorID, &m.Content, &m.CreatedAt, &editedAt)

	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("querying message: %w", err)
	}

	m.EditedAt = nullTimeToPtr(editedAt)

	return &m, nil
}
