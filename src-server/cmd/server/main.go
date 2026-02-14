package main

import (
	"context"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"lobby/internal/api"
	"lobby/internal/blob"
	"lobby/internal/config"
	"lobby/internal/db"
	"lobby/internal/email"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))

	configPath := flag.String("config", "config.yaml", "path to config file")
	flag.Parse()

	cfg, err := config.Load(*configPath)
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	slog.Info("starting server", "name", cfg.Server.Name)

	database, err := db.Open(cfg.Database.Path)
	if err != nil {
		slog.Error("failed to open database", "error", err)
		os.Exit(1)
	}
	defer database.Close()
	slog.Info("database opened", "path", cfg.Database.Path)

	blobService, err := blob.NewService(cfg.Storage.BlobRoot, cfg.Storage.UploadMaxBytes)
	if err != nil {
		slog.Error("failed to initialize blob storage", "error", err)
		os.Exit(1)
	}
	slog.Info("blob storage initialized", "root", cfg.Storage.BlobRoot, "upload_max_bytes", cfg.Storage.UploadMaxBytes)

	cleanupService := db.NewCleanupService(database.Queries())
	blobCleanupService := blob.NewCleanupService(database.Queries(), blobService)
	cleanupCtx, cleanupCancel := context.WithCancel(context.Background())
	go cleanupService.Start(cleanupCtx)
	go blobCleanupService.Start(cleanupCtx)

	emailService := email.NewSMTPService(
		cfg.Email.SMTP.Host,
		cfg.Email.SMTP.Port,
		cfg.Email.SMTP.Username,
		cfg.Email.SMTP.Password,
		cfg.Email.SMTP.From,
	)
	slog.Info("email configured", "host", cfg.Email.SMTP.Host, "port", cfg.Email.SMTP.Port)

	server, err := api.NewServer(
		cfg,
		database,
		emailService,
		blobService,
	)
	if err != nil {
		slog.Error("failed to create server", "error", err)
		os.Exit(1)
	}

	addr := cfg.Addr()
	httpServer := &http.Server{
		Addr:    addr,
		Handler: server,
	}

	go func() {
		slog.Info("server listening", "addr", addr, "base_url", cfg.Server.BaseURL)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	slog.Info("shutting down")

	cleanupCancel()

	server.Shutdown()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(ctx); err != nil {
		slog.Error("http server shutdown error", "error", err)
	}

	slog.Info("server stopped")
}
