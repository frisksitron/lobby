package models

import "time"

type User struct {
	ID             string     `json:"id"`
	Username       string     `json:"username"`
	Email          string     `json:"email,omitempty"`
	AvatarURL      *string    `json:"avatarUrl,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      *time.Time `json:"updatedAt,omitempty"`
	DeactivatedAt  *time.Time `json:"-"`
	SessionVersion int        `json:"-"`
}

func (u *User) GetAvatarURL() string {
	if u.AvatarURL != nil {
		return *u.AvatarURL
	}
	return ""
}

type MagicCode struct {
	ID        string
	Email     string
	CodeHash  string
	ExpiresAt time.Time
	UsedAt    *time.Time
	Attempts  int
	CreatedAt time.Time
}

type RegistrationToken struct {
	ID        string
	Email     string
	TokenHash string
	ExpiresAt time.Time
	UsedAt    *time.Time
	CreatedAt time.Time
}

type RefreshToken struct {
	ID        string
	UserID    string
	TokenHash string
	ExpiresAt time.Time
	CreatedAt time.Time
	RevokedAt *time.Time
}
