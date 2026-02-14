package api

import (
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"lobby/internal/auth"
	"lobby/internal/blob"
	"lobby/internal/config"
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
	database *db.DB,
	emailService *email.SMTPService,
	blobService *blob.Service,
) (*Server, error) {
	if blobService == nil {
		return nil, fmt.Errorf("blob service is required")
	}

	queries := database.Queries()
	uploadRequestLimitBytes := cfg.Storage.UploadMaxBytes + (1 << 20) // include multipart envelope overhead

	magicCodeLimiter := NewRateLimiter(5, time.Minute)
	verifyLimiter := NewRateLimiter(5, time.Minute)
	refreshLimiter := NewRateLimiter(30, time.Minute)

	jwtService := auth.NewJWTService(
		cfg.Auth.JWTSecret,
		cfg.Auth.AccessTokenTTL,
		cfg.Auth.RefreshTokenTTL,
	)
	magicService := auth.NewMagicCodeService(cfg.Auth.MagicCodeTTL)

	hub, err := ws.NewHub(jwtService, database, queries, &cfg.SFU, cfg.Server.BaseURL)
	if err != nil {
		return nil, fmt.Errorf("initializing hub: %w", err)
	}
	go hub.Run()

	authHandler := NewAuthHandler(
		database,
		queries,
		jwtService,
		magicService,
		emailService,
		cfg.Auth.MagicCodeTTL,
		hub,
	)
	userHandler := NewUserHandler(queries, hub)
	serverInfoHandler := NewServerInfoHandler(
		cfg.Server.Name,
		cfg.Server.BaseURL,
		cfg.Storage.UploadMaxBytes,
		queries,
	)
	messageHandler := NewMessageHandler(queries, cfg.Server.BaseURL)
	uploadHandler := NewUploadHandler(
		database,
		queries,
		blobService,
		hub,
		cfg.Server.Name,
		cfg.Server.BaseURL,
		uploadRequestLimitBytes,
	)
	mediaHandler := NewMediaHandler(queries, blobService)
	healthHandler := NewHealthHandler(database)

	authMiddleware := NewAuthMiddleware(jwtService, queries)
	ipResolver, err := NewClientIPResolver(cfg.Server.TrustedProxyCIDRs)
	if err != nil {
		return nil, fmt.Errorf("initializing client IP resolver: %w", err)
	}

	wsHandler := NewWebSocketHandler(hub, cfg.Server.WebSocket, ipResolver)

	r := chi.NewRouter()
	r.Use(slogRequestLogger)
	r.Use(middleware.Recoverer)
	r.Use(corsMiddleware)
	r.Use(securityHeadersMiddleware)

	r.Get("/health", healthHandler.Check)
	r.Get("/media/{blobID}/preview", mediaHandler.GetBlobPreview)
	r.Get("/media/{blobID}", mediaHandler.GetBlob)

	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/server/info", serverInfoHandler.GetInfo)

		r.Route("/server", func(r chi.Router) {
			r.Group(func(r chi.Router) {
				r.Use(authMiddleware.RequireAuth)
				r.Post("/image", uploadHandler.UploadServerImage)
			})
		})

		r.Route("/auth", func(r chi.Router) {
			r.Use(maxBodySizeMiddleware(1 << 20)) // 1 MB
			r.With(RateLimitMiddleware(magicCodeLimiter, ipResolver)).Post("/login/magic-code", authHandler.RequestMagicCode)
			r.With(RateLimitMiddleware(verifyLimiter, ipResolver)).Post("/login/magic-code/verify", authHandler.VerifyMagicCode)
			r.With(RateLimitMiddleware(verifyLimiter, ipResolver)).Post("/register", authHandler.Register)
			r.With(RateLimitMiddleware(refreshLimiter, ipResolver)).Post("/refresh", authHandler.Refresh)

			r.Group(func(r chi.Router) {
				r.Use(authMiddleware.RequireAuth)
				r.Post("/logout", authHandler.Logout)
			})
		})

		r.Route("/users", func(r chi.Router) {
			r.Use(authMiddleware.RequireAuth)
			r.Get("/me", userHandler.GetMe)
			r.Post("/me/avatar", uploadHandler.UploadAvatar)
			r.With(maxBodySizeMiddleware(1<<20)).Patch("/me", userHandler.UpdateMe)
			r.Delete("/me", userHandler.LeaveMe)
		})

		r.Route("/messages", func(r chi.Router) {
			r.Use(authMiddleware.RequireAuth)
			r.Get("/", messageHandler.GetHistory)
		})

		r.Route("/uploads", func(r chi.Router) {
			r.Use(authMiddleware.RequireAuth)
			r.Post("/chat", uploadHandler.UploadChatAttachment)
		})
	})

	wsUpgradeLimiter := NewRateLimiter(10, time.Minute)
	r.With(RateLimitMiddleware(wsUpgradeLimiter, ipResolver)).Get("/ws", wsHandler.ServeWS)

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

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func maxBodySizeMiddleware(maxBytes int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
			next.ServeHTTP(w, r)
		})
	}
}

func securityHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if strings.HasPrefix(r.URL.Path, "/media/") {
			w.Header().Del("X-Frame-Options")
		} else {
			w.Header().Set("X-Frame-Options", "DENY")
		}
		w.Header().Set("X-XSS-Protection", "1; mode=block")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		next.ServeHTTP(w, r)
	})
}

func slogRequestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		slog.Info("http request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", ww.Status(),
			"bytes", ww.BytesWritten(),
			"duration", time.Since(start).String(),
			"remote", r.RemoteAddr,
		)
	})
}
