package api

import (
	"crypto/subtle"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"lobby/internal/auth"
	"lobby/internal/db"
	"lobby/internal/email"
	"lobby/internal/models"
	"lobby/internal/ws"
)

type AuthHandler struct {
	users              *db.UserRepository
	magicCodes         *db.MagicCodeRepository
	registrationTokens *db.RegistrationTokenRepository
	refreshTokens      *db.RefreshTokenRepository
	jwtService         *auth.JWTService
	magicService       *auth.MagicCodeService
	emailService       *email.SMTPService
	magicCodeTTL       time.Duration
	hub                *ws.Hub
}

func NewAuthHandler(
	users *db.UserRepository,
	magicCodes *db.MagicCodeRepository,
	registrationTokens *db.RegistrationTokenRepository,
	refreshTokens *db.RefreshTokenRepository,
	jwtService *auth.JWTService,
	magicService *auth.MagicCodeService,
	emailService *email.SMTPService,
	magicCodeTTL time.Duration,
	hub *ws.Hub,
) *AuthHandler {
	return &AuthHandler{
		users:              users,
		magicCodes:         magicCodes,
		registrationTokens: registrationTokens,
		refreshTokens:      refreshTokens,
		jwtService:         jwtService,
		magicService:       magicService,
		emailService:       emailService,
		magicCodeTTL:       magicCodeTTL,
		hub:                hub,
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

	// Store hashed code
	expiresAt := h.magicService.ExpiresAt()
	codeHash := auth.HashMagicCode(req.Email, code)
	_, err = h.magicCodes.Create(req.Email, codeHash, expiresAt)
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

	magicCode, err := h.magicCodes.FindLatestByEmail(req.Email)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusUnauthorized, ErrCodeAuthFailed, "Invalid code")
		return
	}
	if err != nil {
		slog.Error("error finding magic code", "error", err)
		internalError(w)
		return
	}

	newAttempts, err := h.magicCodes.IncrementAttempts(magicCode.ID, auth.MaxAttempts)
	if err != nil {
		slog.Error("error incrementing attempts", "error", err)
		internalError(w)
		return
	}
	if newAttempts < 0 {
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

	wasMarked, err := h.magicCodes.MarkUsedIfUnused(magicCode.ID)
	if err != nil {
		slog.Error("error marking code used", "error", err)
		internalError(w)
		return
	}
	if !wasMarked {
		writeError(w, http.StatusUnauthorized, ErrCodeAuthFailed, "Code has already been used")
		return
	}

	user, err := h.users.FindByEmail(magicCode.Email)
	if errors.Is(err, db.ErrNotFound) {
		registrationToken, tokenErr := auth.GenerateOpaqueToken(32)
		if tokenErr != nil {
			slog.Error("error generating registration token", "error", tokenErr)
			internalError(w)
			return
		}

		registrationExpiresAt := time.Now().Add(h.magicCodeTTL)
		registrationTokenHash := auth.HashRegistrationToken(registrationToken)
		_, tokenErr = h.registrationTokens.Create(magicCode.Email, registrationTokenHash, registrationExpiresAt)
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

	wasReactivated := false
	if user.DeactivatedAt != nil {
		if err := h.users.Reactivate(user.ID); err != nil {
			slog.Error("error reactivating user", "error", err, "user_id", user.ID)
			internalError(w)
			return
		}

		user, err = h.users.FindByID(user.ID)
		if err != nil {
			slog.Error("error loading reactivated user", "error", err, "user_id", user.ID)
			internalError(w)
			return
		}

		wasReactivated = true
	}

	if wasReactivated {
		if err := h.users.IncrementSessionVersion(user.ID); err != nil {
			slog.Error("error incrementing session version for reactivated user", "error", err, "user_id", user.ID)
			internalError(w)
			return
		}

		user, err = h.users.FindByID(user.ID)
		if err != nil {
			slog.Error("error loading reactivated user after session increment", "error", err, "user_id", user.ID)
			internalError(w)
			return
		}
	}

	authResponse, err := h.generateAuthResponse(user)
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

	registrationTokenHash := auth.HashRegistrationToken(req.RegistrationToken)
	registrationToken, err := h.registrationTokens.FindValid(registrationTokenHash)
	if errors.Is(err, db.ErrNotFound) {
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

	if _, err := h.registrationTokens.ConsumeValid(registrationTokenHash); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeError(w, http.StatusUnauthorized, ErrCodeAuthFailed, "Invalid registration token")
			return
		}
		slog.Error("error consuming registration token", "error", err)
		internalError(w)
		return
	}

	user, err := h.users.Create(email, username)
	if errors.Is(err, db.ErrDuplicate) {
		conflict(w, "Account already registered")
		return
	}
	if err != nil {
		slog.Error("error creating user", "error", err)
		internalError(w)
		return
	}

	authResponse, err := h.generateAuthResponse(user)
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
	refreshToken, err := h.refreshTokens.FindByHash(tokenHash)
	if errors.Is(err, db.ErrNotFound) {
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

	user, err := h.users.FindByID(refreshToken.UserID)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusUnauthorized, ErrCodeAuthFailed, "User not found")
		return
	}
	if err != nil {
		slog.Error("error finding user", "error", err)
		internalError(w)
		return
	}

	tokenPair, newRefreshHash, err := h.jwtService.GenerateTokenPair(user)
	if err != nil {
		slog.Error("error generating refreshed token pair", "error", err)
		internalError(w)
		return
	}

	// Atomically consume old token and issue new token.
	if err := h.refreshTokens.Rotate(refreshToken.ID, user.ID, newRefreshHash, h.jwtService.RefreshTokenExpiry()); err != nil {
		if errors.Is(err, db.ErrNotFound) {
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

	if err := h.refreshTokens.RevokeAllForUser(userID); err != nil {
		slog.Error("error revoking refresh tokens", "error", err)
		internalError(w)
		return
	}

	if err := h.users.IncrementSessionVersion(userID); err != nil {
		slog.Error("error incrementing session version on logout", "error", err, "user_id", userID)
		internalError(w)
		return
	}

	if client := h.hub.GetClient(userID); client != nil {
		client.Close()
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "Logged out successfully"})
}

func (h *AuthHandler) generateAuthResponse(user *models.User) (*AuthResponse, error) {
	tokenPair, refreshHash, err := h.jwtService.GenerateTokenPair(user)
	if err != nil {
		return nil, err
	}

	_, err = h.refreshTokens.Create(user.ID, refreshHash, h.jwtService.RefreshTokenExpiry())
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
