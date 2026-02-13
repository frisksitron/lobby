package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strings"

	"lobby/internal/db"
	"lobby/internal/ws"
)

type UserHandler struct {
	users         *db.UserRepository
	refreshTokens *db.RefreshTokenRepository
	hub           *ws.Hub
}

func NewUserHandler(users *db.UserRepository, refreshTokens *db.RefreshTokenRepository, hub *ws.Hub) *UserHandler {
	return &UserHandler{users: users, refreshTokens: refreshTokens, hub: hub}
}

// GET /api/v1/users/me
func (h *UserHandler) GetMe(w http.ResponseWriter, r *http.Request) {
	userID := GetUserID(r)
	if userID == "" {
		unauthorized(w, "User not found in context")
		return
	}

	user, err := h.users.FindByID(userID)
	if errors.Is(err, db.ErrNotFound) {
		notFound(w, "User not found")
		return
	}
	if err != nil {
		slog.Error("error finding user", "error", err)
		internalError(w)
		return
	}

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

		available, err := h.users.IsUsernameAvailable(username)
		if err != nil {
			slog.Error("error checking username availability", "error", err)
			internalError(w)
			return
		}
		if !available {
			conflict(w, "Username already taken")
			return
		}

		if err := h.users.UpdateUsername(userID, username); err != nil {
			if errors.Is(err, db.ErrNotFound) {
				notFound(w, "User not found")
				return
			}
			if errors.Is(err, db.ErrDuplicate) {
				conflict(w, "Username already taken")
				return
			}
			slog.Error("error updating username", "error", err)
			internalError(w)
			return
		}
		updated = true
	}

	// Return updated user
	user, err := h.users.FindByID(userID)
	if errors.Is(err, db.ErrNotFound) {
		notFound(w, "User not found")
		return
	}
	if err != nil {
		slog.Error("error finding user", "error", err)
		internalError(w)
		return
	}

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

	if _, err := h.users.FindByID(userID); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			notFound(w, "User not found")
			return
		}
		slog.Error("error finding user", "error", err)
		internalError(w)
		return
	}

	if err := h.users.Deactivate(userID); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			notFound(w, "User not found")
			return
		}
		slog.Error("error deactivating user", "error", err, "user_id", userID)
		internalError(w)
		return
	}

	if err := h.refreshTokens.RevokeAllForUser(userID); err != nil {
		slog.Error("error revoking refresh tokens", "error", err, "user_id", userID)
		internalError(w)
		return
	}

	if err := h.users.IncrementSessionVersion(userID); err != nil {
		slog.Error("error incrementing session version", "error", err, "user_id", userID)
		internalError(w)
		return
	}

	h.hub.BroadcastDispatch(ws.EventUserLeft, ws.UserLeftPayload{UserID: userID})
	if client := h.hub.GetClient(userID); client != nil {
		client.Close()
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "Left server successfully"})
}
