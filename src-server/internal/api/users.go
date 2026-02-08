package api

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"regexp"
	"strings"

	"lobby/internal/db"
	"lobby/internal/ws"
)

type UserHandler struct {
	users *db.UserRepository
	hub   *ws.Hub
}

func NewUserHandler(users *db.UserRepository, hub *ws.Hub) *UserHandler {
	return &UserHandler{users: users, hub: hub}
}

// GET /api/v1/users
func (h *UserHandler) GetAll(w http.ResponseWriter, r *http.Request) {
	users, err := h.users.FindAll()
	if err != nil {
		log.Printf("Error finding users: %v", err)
		internalError(w)
		return
	}

	writeJSON(w, http.StatusOK, users)
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
		log.Printf("Error finding user: %v", err)
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
			log.Printf("Error checking username availability: %v", err)
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
			log.Printf("Error updating username: %v", err)
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
		log.Printf("Error finding user: %v", err)
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
