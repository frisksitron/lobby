package models

import "time"

type Message struct {
	ID              string     `json:"id"`
	AuthorID        string     `json:"authorId"`
	AuthorName      string     `json:"authorName"`
	AuthorAvatarURL *string    `json:"authorAvatarUrl,omitempty"`
	Content         string     `json:"content"`
	CreatedAt       time.Time  `json:"createdAt"`
	EditedAt        *time.Time `json:"editedAt,omitempty"`
}
