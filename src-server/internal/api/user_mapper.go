package api

import (
	sqldb "lobby/internal/db/sqlc"
	"lobby/internal/models"
)

func modelUserFromDBUser(row sqldb.User) *models.User {
	return &models.User{
		ID:             row.ID,
		Username:       row.Username,
		Email:          row.Email,
		AvatarURL:      row.AvatarUrl,
		CreatedAt:      row.CreatedAt,
		UpdatedAt:      row.UpdatedAt,
		DeactivatedAt:  row.DeactivatedAt,
		SessionVersion: int(row.SessionVersion),
	}
}
