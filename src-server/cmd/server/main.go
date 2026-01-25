package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"lobby/internal/api"
	"lobby/internal/config"
	"lobby/internal/db"
	"lobby/internal/email"
)

func main() {
	configPath := flag.String("config", "config.yaml", "path to config file")
	flag.Parse()

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	log.Printf("Starting %s...", cfg.Server.Name)

	database, err := db.Open(cfg.Database.Path)
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}
	defer database.Close()
	log.Printf("Database opened at %s", cfg.Database.Path)

	userRepo := db.NewUserRepository(database)
	magicCodeRepo := db.NewMagicCodeRepository(database)
	refreshTokenRepo := db.NewRefreshTokenRepository(database)
	messageRepo := db.NewMessageRepository(database)

	cleanupService := db.NewCleanupService(magicCodeRepo, refreshTokenRepo)
	cleanupCtx, cleanupCancel := context.WithCancel(context.Background())
	go cleanupService.Start(cleanupCtx)

	emailService := email.NewSMTPService(
		cfg.Email.SMTP.Host,
		cfg.Email.SMTP.Port,
		cfg.Email.SMTP.Username,
		cfg.Email.SMTP.Password,
		cfg.Email.SMTP.From,
	)
	log.Printf("Email configured: %s:%d", cfg.Email.SMTP.Host, cfg.Email.SMTP.Port)

	server, err := api.NewServer(cfg, emailService, userRepo, magicCodeRepo, refreshTokenRepo, messageRepo)
	if err != nil {
		log.Fatalf("Failed to create server: %v", err)
	}

	addr := cfg.Addr()
	httpServer := &http.Server{
		Addr:    addr,
		Handler: server,
	}

	go func() {
		log.Printf("Server listening on %s", addr)
		log.Printf("Base URL: %s", cfg.Server.BaseURL)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed: %v", err)
		}
	}()

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	log.Println("Shutting down...")

	cleanupCancel()

	server.Shutdown()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(ctx); err != nil {
		log.Printf("HTTP server shutdown error: %v", err)
	}

	log.Println("Server stopped")
}
