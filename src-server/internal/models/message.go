package models

import "time"

type Message struct {
	ID              string              `json:"id"`
	AuthorID        string              `json:"authorId"`
	AuthorName      string              `json:"authorName"`
	AuthorAvatarURL *string             `json:"authorAvatarUrl,omitempty"`
	Content         string              `json:"content"`
	Attachments     []MessageAttachment `json:"attachments,omitempty"`
	CreatedAt       time.Time           `json:"createdAt"`
	EditedAt        *time.Time          `json:"editedAt,omitempty"`
}

type MessageAttachment struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	MimeType      string `json:"mimeType"`
	Size          int64  `json:"size"`
	URL           string `json:"url"`
	PreviewURL    string `json:"previewUrl,omitempty"`
	PreviewWidth  int64  `json:"previewWidth,omitempty"`
	PreviewHeight int64  `json:"previewHeight,omitempty"`
}
