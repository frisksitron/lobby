package api

import (
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"lobby/internal/auth"
	"lobby/internal/config"
	"lobby/internal/constants"
	"lobby/internal/db"
	"lobby/internal/email"
	"lobby/internal/ws"
)

type Server struct {
	router *chi.Mux
	config *config.Config
	hub    *ws.Hub
}

func NewServer(
	cfg *config.Config,
	emailService *email.SMTPService,
	userRepo *db.UserRepository,
	magicCodeRepo *db.MagicCodeRepository,
	refreshTokenRepo *db.RefreshTokenRepository,
	messageRepo *db.MessageRepository,
) (*Server, error) {
	magicCodeLimiter := NewRateLimiter(5, time.Minute)
	verifyLimiter := NewRateLimiter(5, time.Minute)
	refreshLimiter := NewRateLimiter(30, time.Minute)

	jwtService := auth.NewJWTService(
		cfg.Auth.JWTSecret,
		cfg.Auth.AccessTokenTTL,
		cfg.Auth.RefreshTokenTTL,
	)
	magicService := auth.NewMagicCodeService(cfg.Auth.MagicCodeTTL)

	hub, err := ws.NewHub(userRepo, messageRepo, &cfg.SFU)
	if err != nil {
		return nil, fmt.Errorf("initializing hub: %w", err)
	}
	go hub.Run()

	authHandler := NewAuthHandler(
		userRepo,
		magicCodeRepo,
		refreshTokenRepo,
		jwtService,
		magicService,
		emailService,
		cfg.Auth.MagicCodeTTL,
	)
	userHandler := NewUserHandler(userRepo, hub)
	serverInfoHandler := NewServerInfoHandler(cfg.Server.Name)
	wsHandler := NewWebSocketHandler(hub, jwtService, userRepo)
	messageHandler := NewMessageHandler(messageRepo, userRepo)

	authMiddleware := NewAuthMiddleware(jwtService)

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RealIP)
	r.Use(securityHeadersMiddleware)
	r.Use(corsMiddleware())

	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/server/info", serverInfoHandler.GetInfo)

		r.Route("/auth", func(r chi.Router) {
			r.With(RateLimitMiddleware(magicCodeLimiter)).Post("/login/magic-code", authHandler.RequestMagicCode)
			r.With(RateLimitMiddleware(verifyLimiter)).Post("/login/magic-code/verify", authHandler.VerifyMagicCode)
			r.With(RateLimitMiddleware(refreshLimiter)).Post("/refresh", authHandler.Refresh)

			r.Group(func(r chi.Router) {
				r.Use(authMiddleware.RequireAuth)
				r.Post("/logout", authHandler.Logout)
			})
		})

		r.Route("/users", func(r chi.Router) {
			r.Use(authMiddleware.RequireAuth)
			r.Get("/", userHandler.GetAll)
			r.Get("/me", userHandler.GetMe)
			r.Patch("/me", userHandler.UpdateMe)
		})

		r.Route("/messages", func(r chi.Router) {
			r.Use(authMiddleware.RequireAuth)
			r.Get("/", messageHandler.GetHistory)
		})
	})

	wsUpgradeLimiter := NewRateLimiter(10, time.Minute)
	r.With(RateLimitMiddleware(wsUpgradeLimiter)).Get("/ws", wsHandler.ServeWS)

	return &Server{
		router: r,
		config: cfg,
		hub:    hub,
	}, nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.router.ServeHTTP(w, r)
}

func (s *Server) Shutdown() {
	s.hub.Shutdown()
}

func securityHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("X-XSS-Protection", "1; mode=block")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		next.ServeHTTP(w, r)
	})
}

func corsMiddleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin == "" {
				next.ServeHTTP(w, r)
				return
			}

			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Accept, Authorization, Content-Type")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Max-Age", constants.CORSMaxAgeSec)
			w.Header().Set("Vary", "Origin")

			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusNoContent)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
