package api

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"lobby/internal/auth"
	"lobby/internal/db"
	sqldb "lobby/internal/db/sqlc"
	"lobby/internal/email"
	"lobby/internal/models"
	"lobby/internal/ws"
)

type AuthHandler struct {
	database     *db.DB
	queries      *sqldb.Queries
	jwtService   *auth.JWTService
	magicService *auth.MagicCodeService
	emailService *email.SMTPService
	magicCodeTTL time.Duration
	hub          *ws.Hub
}

func NewAuthHandler(
	database *db.DB,
	queries *sqldb.Queries,
	jwtService *auth.JWTService,
	magicService *auth.MagicCodeService,
	emailService *email.SMTPService,
	magicCodeTTL time.Duration,
	hub *ws.Hub,
) *AuthHandler {
	return &AuthHandler{
		database:     database,
		queries:      queries,
		jwtService:   jwtService,
		magicService: magicService,
		emailService: emailService,
		magicCodeTTL: magicCodeTTL,
		hub:          hub,
	}
}

type MagicCodeRequest struct {
	Email string `json:"email" validate:"required,max=254"`
}

type MagicCodeResponse struct {
	Message string `json:"message"`
}

func (h *AuthHandler) RequestMagicCode(w http.ResponseWriter, r *http.Request) {
	var req MagicCodeRequest
	if err := decodeAndValidate(r.Body, &req); err != nil {
		badRequest(w, err.Error())
		return
	}

	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	if req.Email == "" {
		badRequest(w, "email is required")
		return
	}
	if err := requestValidator.Var(req.Email, "email,max=254"); err != nil {
		badRequest(w, "invalid email format")
		return
	}

	code, err := h.magicService.GenerateCode()
	if err != nil {
		slog.Error("error generating magic code", "error", err)
		internalError(w)
		return
	}

	expiresAt := h.magicService.ExpiresAt()
	codeHash := auth.HashMagicCode(req.Email, code)
	magicCodeID, err := db.GenerateID("mc")
	if err != nil {
		slog.Error("error generating magic code id", "error", err)
		internalError(w)
		return
	}

	err = h.queries.CreateMagicCode(r.Context(), sqldb.CreateMagicCodeParams{
		ID:        magicCodeID,
		Email:     req.Email,
		CodeHash:  codeHash,
		ExpiresAt: expiresAt.UTC(),
		CreatedAt: time.Now().UTC(),
	})
	if err != nil {
		slog.Error("error storing magic code", "error", err)
		internalError(w)
		return
	}

	if err := h.emailService.SendMagicCode(req.Email, code, h.magicCodeTTL); err != nil {
		slog.Error("error sending magic code email", "error", err)
		// Intentionally not returning error to client - prevents email enumeration attacks.
	}

	writeJSON(w, http.StatusOK, MagicCodeResponse{
		Message: "If an account exists with this email, a login code has been sent",
	})
}

// POST /api/v1/auth/login/magic-code/verify
type VerifyMagicCodeRequest struct {
	Email string `json:"email" validate:"required,max=254"`
	Code  string `json:"code" validate:"required,len=6,numeric"`
}

type AuthResponse struct {
	User         *models.User `json:"user"`
	AccessToken  string       `json:"accessToken"`
	RefreshToken string       `json:"refreshToken"`
	ExpiresAt    string       `json:"expiresAt"`
}

type VerifyMagicCodeResponse struct {
	Next                  string        `json:"next"`
	RegistrationToken     string        `json:"registrationToken,omitempty"`
	RegistrationExpiresAt string        `json:"registrationExpiresAt,omitempty"`
	Session               *AuthResponse `json:"session,omitempty"`
}

type RefreshResponse struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	ExpiresAt    string `json:"expiresAt"`
}

type RegisterRequest struct {
	RegistrationToken string `json:"registrationToken" validate:"required"`
	Username          string `json:"username" validate:"required,min=3,max=32"`
}

func (h *AuthHandler) VerifyMagicCode(w http.ResponseWriter, r *http.Request) {
	var req VerifyMagicCodeRequest
	if err := decodeAndValidate(r.Body, &req); err != nil {
		badRequest(w, err.Error())
		return
	}

	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	if req.Email == "" {
		badRequest(w, "email is required")
		return
	}
	if err := requestValidator.Var(req.Email, "email,max=254"); err != nil {
		badRequest(w, "invalid email format")
		return
	}

	magicCode, err := h.queries.GetLatestUnusedMagicCodeByEmail(r.Context(), req.Email)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusUnauthorized, ErrCodeAuthFailed, "Invalid code")
		return
	}
	if err != nil {
		slog.Error("error finding magic code", "error", err)
		internalError(w)
		return
	}

	newAttempts, err := h.queries.IncrementMagicCodeAttempts(r.Context(), sqldb.IncrementMagicCodeAttemptsParams{
		ID:          magicCode.ID,
		MaxAttempts: int64(auth.MaxAttempts),
	})
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusUnauthorized, ErrCodeAuthFailed, "Too many attempts")
		return
	}
	if err != nil {
		slog.Error("error incrementing attempts", "error", err)
		internalError(w)
		return
	}
	if newAttempts > int64(auth.MaxAttempts) {
		writeError(w, http.StatusUnauthorized, ErrCodeAuthFailed, "Too many attempts")
		return
	}

	expectedHash := auth.HashMagicCode(req.Email, req.Code)
	if subtle.ConstantTimeCompare([]byte(expectedHash), []byte(magicCode.CodeHash)) != 1 {
		writeError(w, http.StatusUnauthorized, ErrCodeAuthFailed, "Invalid code")
		return
	}

	if time.Now().After(magicCode.ExpiresAt) {
		writeError(w, http.StatusUnauthorized, ErrCodeAuthExpired, "Code has expired")
		return
	}

	usedAt := time.Now().UTC()
	rowsAffected, err := h.queries.MarkMagicCodeUsedIfUnused(r.Context(), sqldb.MarkMagicCodeUsedIfUnusedParams{
		UsedAt: &usedAt,
		ID:     magicCode.ID,
	})
	if err != nil {
		slog.Error("error marking code used", "error", err)
		internalError(w)
		return
	}
	if rowsAffected == 0 {
		writeError(w, http.StatusUnauthorized, ErrCodeAuthFailed, "Code has already been used")
		return
	}

	userRow, err := h.queries.GetUserByEmail(r.Context(), magicCode.Email)
	if errors.Is(err, sql.ErrNoRows) {
		registrationToken, tokenErr := auth.GenerateOpaqueToken(32)
		if tokenErr != nil {
			slog.Error("error generating registration token", "error", tokenErr)
			internalError(w)
			return
		}

		registrationExpiresAt := time.Now().Add(h.magicCodeTTL)
		registrationTokenHash := auth.HashRegistrationToken(registrationToken)
		registrationTokenID, tokenErr := db.GenerateID("rgt")
		if tokenErr != nil {
			slog.Error("error generating registration token id", "error", tokenErr)
			internalError(w)
			return
		}

		tokenErr = h.queries.CreateRegistrationToken(r.Context(), sqldb.CreateRegistrationTokenParams{
			ID:        registrationTokenID,
			Email:     magicCode.Email,
			TokenHash: registrationTokenHash,
			ExpiresAt: registrationExpiresAt.UTC(),
			CreatedAt: time.Now().UTC(),
		})
		if tokenErr != nil {
			slog.Error("error storing registration token", "error", tokenErr)
			internalError(w)
			return
		}

		writeJSON(w, http.StatusOK, VerifyMagicCodeResponse{
			Next:                  "register",
			RegistrationToken:     registrationToken,
			RegistrationExpiresAt: registrationExpiresAt.UTC().Format(time.RFC3339),
		})
		return
	}

	if err != nil {
		slog.Error("error finding user", "error", err)
		internalError(w)
		return
	}

	user := modelUserFromDBUser(userRow)
	wasReactivated := false
	if user.DeactivatedAt != nil {
		updatedAt := time.Now().UTC()
		rowsAffected, err = h.queries.ReactivateUser(r.Context(), sqldb.ReactivateUserParams{
			UpdatedAt: &updatedAt,
			ID:        user.ID,
		})
		if err != nil {
			slog.Error("error reactivating user", "error", err, "user_id", user.ID)
			internalError(w)
			return
		}
		if rowsAffected == 0 {
			slog.Error("reactivating user affected no rows", "user_id", user.ID)
			internalError(w)
			return
		}

		userRow, err = h.queries.GetActiveUserByID(r.Context(), user.ID)
		if err != nil {
			slog.Error("error loading reactivated user", "error", err, "user_id", user.ID)
			internalError(w)
			return
		}
		user = modelUserFromDBUser(userRow)
		wasReactivated = true
	}

	if wasReactivated {
		updatedAt := time.Now().UTC()
		rowsAffected, err = h.queries.IncrementUserSessionVersion(r.Context(), sqldb.IncrementUserSessionVersionParams{
			UpdatedAt: &updatedAt,
			ID:        user.ID,
		})
		if err != nil {
			slog.Error("error incrementing session version for reactivated user", "error", err, "user_id", user.ID)
			internalError(w)
			return
		}
		if rowsAffected == 0 {
			slog.Error("incrementing session version affected no rows", "user_id", user.ID)
			internalError(w)
			return
		}

		userRow, err = h.queries.GetActiveUserByID(r.Context(), user.ID)
		if err != nil {
			slog.Error("error loading reactivated user after session increment", "error", err, "user_id", user.ID)
			internalError(w)
			return
		}
		user = modelUserFromDBUser(userRow)
	}

	authResponse, err := h.generateAuthResponse(r.Context(), user)
	if err != nil {
		slog.Error("error issuing auth tokens", "error", err, "user_id", user.ID)
		internalError(w)
		return
	}

	if wasReactivated {
		h.broadcastUserJoined(user)
	}

	writeJSON(w, http.StatusOK, VerifyMagicCodeResponse{
		Next:    "session",
		Session: authResponse,
	})
}

// POST /api/v1/auth/register
func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req RegisterRequest
	if err := decodeAndValidate(r.Body, &req); err != nil {
		badRequest(w, err.Error())
		return
	}

	req.RegistrationToken = strings.TrimSpace(req.RegistrationToken)
	username := strings.TrimSpace(req.Username)

	if !usernameRegex.MatchString(username) {
		badRequest(w, "Username must be 3-32 characters and contain only letters, numbers, underscores, and hyphens")
		return
	}

	now := time.Now().UTC()
	registrationTokenHash := auth.HashRegistrationToken(req.RegistrationToken)
	registrationToken, err := h.queries.GetValidRegistrationToken(r.Context(), sqldb.GetValidRegistrationTokenParams{
		TokenHash: registrationTokenHash,
		Now:       now,
	})
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusUnauthorized, ErrCodeAuthFailed, "Invalid registration token")
		return
	}
	if err != nil {
		slog.Error("error validating registration token", "error", err)
		internalError(w)
		return
	}

	email := strings.ToLower(strings.TrimSpace(registrationToken.Email))
	if email == "" {
		writeError(w, http.StatusUnauthorized, ErrCodeAuthFailed, "Invalid registration token")
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

	now = time.Now().UTC()
	if _, err := h.queries.ConsumeValidRegistrationToken(r.Context(), sqldb.ConsumeValidRegistrationTokenParams{
		UsedAt:    &now,
		TokenHash: registrationTokenHash,
		Now:       now,
	}); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusUnauthorized, ErrCodeAuthFailed, "Invalid registration token")
			return
		}
		slog.Error("error consuming registration token", "error", err)
		internalError(w)
		return
	}

	userID, err := db.GenerateID("usr")
	if err != nil {
		slog.Error("error generating user id", "error", err)
		internalError(w)
		return
	}

	createdAt := time.Now().UTC()
	err = h.queries.CreateUser(r.Context(), sqldb.CreateUserParams{
		ID:        userID,
		Username:  username,
		Email:     email,
		CreatedAt: createdAt,
	})
	if err != nil {
		if db.IsUniqueConstraintError(err) {
			conflict(w, "Account already registered")
			return
		}
		slog.Error("error creating user", "error", err)
		internalError(w)
		return
	}

	user := &models.User{
		ID:             userID,
		Username:       username,
		Email:          email,
		CreatedAt:      createdAt,
		UpdatedAt:      nil,
		SessionVersion: 1,
	}

	authResponse, err := h.generateAuthResponse(r.Context(), user)
	if err != nil {
		slog.Error("error issuing auth tokens", "error", err, "user_id", user.ID)
		internalError(w)
		return
	}

	h.broadcastUserJoined(user)
	writeJSON(w, http.StatusOK, authResponse)
}

// POST /api/v1/auth/refresh
type RefreshRequest struct {
	RefreshToken string `json:"refreshToken" validate:"required"`
}

func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	var req RefreshRequest
	if err := decodeAndValidate(r.Body, &req); err != nil {
		badRequest(w, err.Error())
		return
	}

	tokenHash := auth.HashRefreshToken(req.RefreshToken)
	refreshToken, err := h.queries.GetRefreshTokenByHash(r.Context(), tokenHash)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusUnauthorized, ErrCodeAuthFailed, "Invalid refresh token")
		return
	}
	if err != nil {
		slog.Error("error finding refresh token", "error", err)
		internalError(w)
		return
	}

	if refreshToken.RevokedAt != nil {
		writeError(w, http.StatusUnauthorized, ErrCodeAuthFailed, "Refresh token has been revoked")
		return
	}

	if time.Now().After(refreshToken.ExpiresAt) {
		writeError(w, http.StatusUnauthorized, ErrCodeAuthExpired, "Refresh token has expired")
		return
	}

	userRow, err := h.queries.GetActiveUserByID(r.Context(), refreshToken.UserID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusUnauthorized, ErrCodeAuthFailed, "User not found")
		return
	}
	if err != nil {
		slog.Error("error finding user", "error", err)
		internalError(w)
		return
	}
	user := modelUserFromDBUser(userRow)

	tokenPair, newRefreshHash, err := h.jwtService.GenerateTokenPair(user)
	if err != nil {
		slog.Error("error generating refreshed token pair", "error", err)
		internalError(w)
		return
	}

	if err := h.rotateRefreshToken(r.Context(), refreshToken.ID, user.ID, newRefreshHash, h.jwtService.RefreshTokenExpiry()); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusUnauthorized, ErrCodeAuthFailed, "Refresh token has already been used")
			return
		}
		slog.Error("error rotating refresh token", "error", err)
		internalError(w)
		return
	}

	writeJSON(w, http.StatusOK, RefreshResponse{
		AccessToken:  tokenPair.AccessToken,
		RefreshToken: tokenPair.RefreshToken,
		ExpiresAt:    tokenPair.ExpiresAt.UTC().Format(time.RFC3339),
	})
}

// POST /api/v1/auth/logout
func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(userIDKey).(string)
	if !ok || userID == "" {
		unauthorized(w, "User not found in context")
		return
	}

	revokedAt := time.Now().UTC()
	if err := h.queries.RevokeAllRefreshTokensForUser(r.Context(), sqldb.RevokeAllRefreshTokensForUserParams{
		RevokedAt: &revokedAt,
		UserID:    userID,
	}); err != nil {
		slog.Error("error revoking refresh tokens", "error", err)
		internalError(w)
		return
	}

	updatedAt := time.Now().UTC()
	rowsAffected, err := h.queries.IncrementUserSessionVersion(r.Context(), sqldb.IncrementUserSessionVersionParams{
		UpdatedAt: &updatedAt,
		ID:        userID,
	})
	if err != nil {
		slog.Error("error incrementing session version on logout", "error", err, "user_id", userID)
		internalError(w)
		return
	}
	if rowsAffected == 0 {
		slog.Error("incrementing session version on logout affected no rows", "user_id", userID)
		internalError(w)
		return
	}

	if client := h.hub.GetClient(userID); client != nil {
		client.Close()
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "Logged out successfully"})
}

func (h *AuthHandler) generateAuthResponse(ctx context.Context, user *models.User) (*AuthResponse, error) {
	tokenPair, refreshHash, err := h.jwtService.GenerateTokenPair(user)
	if err != nil {
		return nil, err
	}

	refreshTokenID, err := db.GenerateID("rft")
	if err != nil {
		return nil, fmt.Errorf("generating refresh token ID: %w", err)
	}

	refreshExpiry := h.jwtService.RefreshTokenExpiry()
	err = h.queries.CreateRefreshToken(ctx, sqldb.CreateRefreshTokenParams{
		ID:        refreshTokenID,
		UserID:    user.ID,
		TokenHash: refreshHash,
		ExpiresAt: refreshExpiry.UTC(),
		CreatedAt: time.Now().UTC(),
	})
	if err != nil {
		return nil, err
	}

	return &AuthResponse{
		User:         user,
		AccessToken:  tokenPair.AccessToken,
		RefreshToken: tokenPair.RefreshToken,
		ExpiresAt:    tokenPair.ExpiresAt.UTC().Format(time.RFC3339),
	}, nil
}

func (h *AuthHandler) rotateRefreshToken(
	ctx context.Context,
	consumedTokenID string,
	userID string,
	newTokenHash string,
	newExpiresAt time.Time,
) error {
	tx, err := h.database.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("starting refresh token rotation transaction: %w", err)
	}
	defer tx.Rollback()

	qtx := h.queries.WithTx(tx)
	now := time.Now().UTC()
	rowsAffected, err := qtx.RevokeRefreshTokenForRotation(ctx, sqldb.RevokeRefreshTokenForRotationParams{
		RevokedAt: &now,
		ID:        consumedTokenID,
		Now:       now,
	})
	if err != nil {
		return fmt.Errorf("revoking token during rotation: %w", err)
	}
	if rowsAffected == 0 {
		return sql.ErrNoRows
	}

	newID, err := db.GenerateID("rft")
	if err != nil {
		return fmt.Errorf("generating rotated refresh token ID: %w", err)
	}

	err = qtx.CreateRefreshToken(ctx, sqldb.CreateRefreshTokenParams{
		ID:        newID,
		UserID:    userID,
		TokenHash: newTokenHash,
		ExpiresAt: newExpiresAt.UTC(),
		CreatedAt: now,
	})
	if err != nil {
		return fmt.Errorf("creating rotated refresh token: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("committing refresh token rotation: %w", err)
	}

	return nil
}

func (h *AuthHandler) broadcastUserJoined(user *models.User) {
	if user == nil {
		return
	}

	h.hub.BroadcastDispatch(ws.EventUserJoined, ws.UserJoinedPayload{
		Member: ws.MemberState{
			ID:        user.ID,
			Username:  user.Username,
			Avatar:    user.GetAvatarURL(),
			Status:    "offline",
			InVoice:   false,
			Muted:     false,
			Deafened:  false,
			Streaming: false,
			CreatedAt: user.CreatedAt,
		},
	})
}
