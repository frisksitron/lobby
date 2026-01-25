package api

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"lobby/internal/auth"
	"lobby/internal/db"
	"lobby/internal/email"
	"lobby/internal/models"
)

type AuthHandler struct {
	users         *db.UserRepository
	magicCodes    *db.MagicCodeRepository
	refreshTokens *db.RefreshTokenRepository
	jwtService    *auth.JWTService
	magicService  *auth.MagicCodeService
	emailService  *email.SMTPService
	magicCodeTTL  time.Duration
}

func NewAuthHandler(
	users *db.UserRepository,
	magicCodes *db.MagicCodeRepository,
	refreshTokens *db.RefreshTokenRepository,
	jwtService *auth.JWTService,
	magicService *auth.MagicCodeService,
	emailService *email.SMTPService,
	magicCodeTTL time.Duration,
) *AuthHandler {
	return &AuthHandler{
		users:         users,
		magicCodes:    magicCodes,
		refreshTokens: refreshTokens,
		jwtService:    jwtService,
		magicService:  magicService,
		emailService:  emailService,
		magicCodeTTL:  magicCodeTTL,
	}
}

type MagicCodeRequest struct {
	Email string `json:"email"`
}

type MagicCodeResponse struct {
	Message string `json:"message"`
}

func (h *AuthHandler) RequestMagicCode(w http.ResponseWriter, r *http.Request) {
	var req MagicCodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return
	}

	if req.Email == "" {
		badRequest(w, "Email is required")
		return
	}

	req.Email = strings.TrimSpace(req.Email)
	if _, err := mail.ParseAddress(req.Email); err != nil {
		badRequest(w, "Invalid email format")
		return
	}

	code, err := h.magicService.GenerateCode()
	if err != nil {
		log.Printf("Error generating magic code: %v", err)
		internalError(w)
		return
	}

	// Store code (plaintext - hashing 6 digits provides no value)
	expiresAt := h.magicService.ExpiresAt()
	_, err = h.magicCodes.Create(req.Email, code, expiresAt)
	if err != nil {
		log.Printf("Error storing magic code: %v", err)
		internalError(w)
		return
	}

	if err := h.emailService.SendMagicCode(req.Email, code, h.magicCodeTTL); err != nil {
		log.Printf("Error sending magic code email: %v", err)
		// Intentionally not returning error to client - prevents email enumeration attacks.
	}

	writeJSON(w, http.StatusOK, MagicCodeResponse{
		Message: "If an account exists with this email, a login code has been sent",
	})
}

// POST /api/v1/auth/login/magic-code/verify
type VerifyMagicCodeRequest struct {
	Email string `json:"email"`
	Code  string `json:"code"`
}

type AuthResponse struct {
	User         *models.User `json:"user"`
	AccessToken  string       `json:"accessToken"`
	RefreshToken string       `json:"refreshToken"`
	ExpiresAt    string       `json:"expiresAt"`
	IsNewUser    bool         `json:"isNewUser"`
}

func (h *AuthHandler) VerifyMagicCode(w http.ResponseWriter, r *http.Request) {
	var req VerifyMagicCodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		badRequest(w, "Invalid JSON body")
		return
	}

	if req.Email == "" || req.Code == "" {
		badRequest(w, "Email and code are required")
		return
	}

	if len(req.Code) != 6 {
		badRequest(w, "Code must be exactly 6 digits")
		return
	}
	for _, c := range req.Code {
		if c < '0' || c > '9' {
			badRequest(w, "Code must contain only digits")
			return
		}
	}

	magicCode, err := h.magicCodes.FindByEmailAndCode(req.Email, req.Code)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusUnauthorized, ErrCodeInvalidCredentials, "Invalid code")
		return
	}
	if err != nil {
		log.Printf("Error finding magic code: %v", err)
		internalError(w)
		return
	}

	if magicCode.Attempts >= auth.MaxAttempts {
		writeError(w, http.StatusUnauthorized, ErrCodeInvalidCredentials, "Too many attempts")
		return
	}

	newAttempts, err := h.magicCodes.IncrementAttempts(magicCode.ID)
	if err != nil {
		log.Printf("Error incrementing attempts: %v", err)
		internalError(w)
		return
	}
	if newAttempts > auth.MaxAttempts {
		writeError(w, http.StatusUnauthorized, ErrCodeInvalidCredentials, "Too many attempts")
		return
	}

	if time.Now().After(magicCode.ExpiresAt) {
		writeError(w, http.StatusUnauthorized, ErrCodeTokenExpired, "Code has expired")
		return
	}

	wasMarked, err := h.magicCodes.MarkUsedIfUnused(magicCode.ID)
	if err != nil {
		log.Printf("Error marking code used: %v", err)
		internalError(w)
		return
	}
	if !wasMarked {
		writeError(w, http.StatusUnauthorized, ErrCodeTokenUsed, "Code has already been used")
		return
	}

	user, err := h.users.FindByEmail(magicCode.Email)
	isNewUser := false
	if errors.Is(err, db.ErrNotFound) {
		// Create new user
		user, err = h.users.Create(magicCode.Email)
		if err != nil {
			log.Printf("Error creating user: %v", err)
			internalError(w)
			return
		}
		isNewUser = true
	} else if err != nil {
		log.Printf("Error finding user: %v", err)
		internalError(w)
		return
	}

	h.issueTokens(w, user, isNewUser)
}

// POST /api/v1/auth/refresh
type RefreshRequest struct {
	RefreshToken string `json:"refreshToken"`
}

func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	var req RefreshRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		badRequest(w, "Invalid JSON body")
		return
	}

	if req.RefreshToken == "" {
		badRequest(w, "Refresh token is required")
		return
	}

	tokenHash := auth.HashRefreshToken(req.RefreshToken)
	refreshToken, err := h.refreshTokens.FindByHash(tokenHash)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusUnauthorized, ErrCodeInvalidCredentials, "Invalid refresh token")
		return
	}
	if err != nil {
		log.Printf("Error finding refresh token: %v", err)
		internalError(w)
		return
	}

	if refreshToken.RevokedAt != nil {
		writeError(w, http.StatusUnauthorized, ErrCodeInvalidCredentials, "Refresh token has been revoked")
		return
	}

	if time.Now().After(refreshToken.ExpiresAt) {
		writeError(w, http.StatusUnauthorized, ErrCodeTokenExpired, "Refresh token has expired")
		return
	}

	user, err := h.users.FindByID(refreshToken.UserID)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusUnauthorized, ErrCodeInvalidCredentials, "User not found")
		return
	}
	if err != nil {
		log.Printf("Error finding user: %v", err)
		internalError(w)
		return
	}

	// Revoke old refresh token - fail if revocation fails to prevent token accumulation
	if err := h.refreshTokens.Revoke(refreshToken.ID); err != nil {
		log.Printf("Error revoking old refresh token: %v", err)
		internalError(w)
		return
	}

	// Issue new tokens
	h.issueTokens(w, user, false)
}

// POST /api/v1/auth/logout
func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(userIDKey).(string)
	if !ok || userID == "" {
		unauthorized(w, "User not found in context")
		return
	}

	if err := h.refreshTokens.RevokeAllForUser(userID); err != nil {
		log.Printf("Error revoking refresh tokens: %v", err)
		internalError(w)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "Logged out successfully"})
}

func (h *AuthHandler) issueTokens(w http.ResponseWriter, user *models.User, isNewUser bool) {
	tokenPair, refreshHash, err := h.jwtService.GenerateTokenPair(user)
	if err != nil {
		log.Printf("Error generating token pair: %v", err)
		internalError(w)
		return
	}

	_, err = h.refreshTokens.Create(user.ID, refreshHash, h.jwtService.RefreshTokenExpiry())
	if err != nil {
		log.Printf("Error storing refresh token: %v", err)
		internalError(w)
		return
	}

	writeJSON(w, http.StatusOK, AuthResponse{
		User:         user,
		AccessToken:  tokenPair.AccessToken,
		RefreshToken: tokenPair.RefreshToken,
		ExpiresAt:    tokenPair.ExpiresAt.UTC().Format(time.RFC3339),
		IsNewUser:    isNewUser,
	})
}
