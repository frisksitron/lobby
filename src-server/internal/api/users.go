package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"lobby/internal/db"
	sqldb "lobby/internal/db/sqlc"
	"lobby/internal/ws"
)

type UserHandler struct {
	queries *sqldb.Queries
	hub     *ws.Hub
}

func NewUserHandler(queries *sqldb.Queries, hub *ws.Hub) *UserHandler {
	return &UserHandler{queries: queries, hub: hub}
}

// GET /api/v1/users/me
func (h *UserHandler) GetMe(w http.ResponseWriter, r *http.Request) {
	userID := GetUserID(r)
	if userID == "" {
		unauthorized(w, "User not found in context")
		return
	}

	row, err := h.queries.GetActiveUserByID(r.Context(), userID)
	if errors.Is(err, sql.ErrNoRows) {
		notFound(w, "User not found")
		return
	}
	if err != nil {
		slog.Error("error finding user", "error", err)
		internalError(w)
		return
	}

	user := modelUserFromDBUser(row)
	writeJSON(w, http.StatusOK, user)
}

type UpdateUserRequest struct {
	Username *string `json:"username"`
}

var usernameRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]{3,32}$`)

func (h *UserHandler) UpdateMe(w http.ResponseWriter, r *http.Request) {
	userID := GetUserID(r)
	if userID == "" {
		unauthorized(w, "User not found in context")
		return
	}

	var req UpdateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		badRequest(w, "Invalid JSON body")
		return
	}

	updated := false
	if req.Username != nil {
		username := strings.TrimSpace(*req.Username)

		if !usernameRegex.MatchString(username) {
			badRequest(w, "Username must be 3-32 characters and contain only letters, numbers, underscores, and hyphens")
			return
		}

		count, err := h.queries.CountUsersByUsername(r.Context(), username)
		if err != nil {
			slog.Error("error checking username availability", "error", err)
			internalError(w)
			return
		}
		if count > 0 {
			conflict(w, "Username already taken")
			return
		}

		now := time.Now().UTC()
		rowsAffected, err := h.queries.UpdateUsername(r.Context(), sqldb.UpdateUsernameParams{
			Username:  username,
			UpdatedAt: &now,
			ID:        userID,
		})
		if err != nil {
			if db.IsUniqueConstraintError(err) {
				conflict(w, "Username already taken")
				return
			}
			slog.Error("error updating username", "error", err)
			internalError(w)
			return
		}
		if rowsAffected == 0 {
			notFound(w, "User not found")
			return
		}
		updated = true
	}

	// Return updated user
	row, err := h.queries.GetActiveUserByID(r.Context(), userID)
	if errors.Is(err, sql.ErrNoRows) {
		notFound(w, "User not found")
		return
	}
	if err != nil {
		slog.Error("error finding user", "error", err)
		internalError(w)
		return
	}
	user := modelUserFromDBUser(row)

	if updated {
		avatar := ""
		if user.AvatarURL != nil {
			avatar = *user.AvatarURL
		}
		h.hub.BroadcastDispatch(ws.EventUserUpdate, ws.UserUpdatePayload{
			ID:       user.ID,
			Username: user.Username,
			Avatar:   avatar,
		})
	}

	writeJSON(w, http.StatusOK, user)
}

// DELETE /api/v1/users/me
func (h *UserHandler) LeaveMe(w http.ResponseWriter, r *http.Request) {
	userID := GetUserID(r)
	if userID == "" {
		unauthorized(w, "User not found in context")
		return
	}

	if _, err := h.queries.GetActiveUserByID(r.Context(), userID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			notFound(w, "User not found")
			return
		}
		slog.Error("error finding user", "error", err)
		internalError(w)
		return
	}

	now := time.Now().UTC()
	rowsAffected, err := h.queries.DeactivateUser(r.Context(), sqldb.DeactivateUserParams{
		DeactivatedAt: &now,
		UpdatedAt:     &now,
		ID:            userID,
	})
	if err != nil {
		slog.Error("error deactivating user", "error", err, "user_id", userID)
		internalError(w)
		return
	}
	if rowsAffected == 0 {
		notFound(w, "User not found")
		return
	}

	revokedAt := time.Now().UTC()
	if err := h.queries.RevokeAllRefreshTokensForUser(r.Context(), sqldb.RevokeAllRefreshTokensForUserParams{
		RevokedAt: &revokedAt,
		UserID:    userID,
	}); err != nil {
		slog.Error("error revoking refresh tokens", "error", err, "user_id", userID)
		internalError(w)
		return
	}

	updatedAt := time.Now().UTC()
	rowsAffected, err = h.queries.IncrementUserSessionVersion(r.Context(), sqldb.IncrementUserSessionVersionParams{
		UpdatedAt: &updatedAt,
		ID:        userID,
	})
	if err != nil {
		slog.Error("error incrementing session version", "error", err, "user_id", userID)
		internalError(w)
		return
	}
	if rowsAffected == 0 {
		notFound(w, "User not found")
		return
	}

	h.hub.BroadcastDispatch(ws.EventUserLeft, ws.UserLeftPayload{UserID: userID})
	if client := h.hub.GetClient(userID); client != nil {
		client.Close()
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "Left server successfully"})
}
