package models

import "time"

type Message struct {
	ID        string     `json:"id"`
	AuthorID  string     `json:"authorId"`
	Content   string     `json:"content"`
	CreatedAt time.Time  `json:"createdAt"`
	EditedAt  *time.Time `json:"editedAt,omitempty"`
}
