package api

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"lobby/internal/auth"
	"lobby/internal/db"
)

type contextKey string

const userIDKey contextKey = "userID"

type AuthMiddleware struct {
	jwtService *auth.JWTService
	users      *db.UserRepository
}

func NewAuthMiddleware(jwtService *auth.JWTService, users *db.UserRepository) *AuthMiddleware {
	return &AuthMiddleware{jwtService: jwtService, users: users}
}

func (m *AuthMiddleware) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			unauthorized(w, "Authorization header required")
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
			unauthorized(w, "Invalid authorization header format")
			return
		}

		token := parts[1]
		claims, err := m.jwtService.ValidateAccessToken(token)
		if err != nil {
			unauthorized(w, "Invalid or expired token")
			return
		}

		user, err := m.users.FindByID(claims.UserID)
		if err != nil {
			if errors.Is(err, db.ErrNotFound) {
				unauthorized(w, "User not found")
				return
			}
			internalError(w)
			return
		}

		if claims.SessionVersion != user.SessionVersion {
			unauthorized(w, "Session invalidated")
			return
		}

		ctx := context.WithValue(r.Context(), userIDKey, claims.UserID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func GetUserID(r *http.Request) string {
	if v := r.Context().Value(userIDKey); v != nil {
		if userID, ok := v.(string); ok {
			return userID
		}
	}
	return ""
}
