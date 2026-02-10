package email

import (
	"context"
	"crypto/tls"
	"fmt"
	"log/slog"
	"net"
	"net/smtp"
	"time"
)

const (
	smtpTimeout = 30 * time.Second
)

type SMTPService struct {
	host     string
	port     int
	username string
	password string
	from     string
}

func NewSMTPService(host string, port int, username, password, from string) *SMTPService {
	return &SMTPService{
		host:     host,
		port:     port,
		username: username,
		password: password,
		from:     from,
	}
}

func (s *SMTPService) SendMagicCode(to, code string, ttl time.Duration) error {
	subject := "Your Lobby Login Code"
	body := fmt.Sprintf(`Hello!

Your login code for Lobby is:

    %s

This code will expire in %d minutes.

If you didn't request this email, you can safely ignore it.

- The Lobby Team`, code, int(ttl.Minutes()))

	return s.send(to, subject, body)
}

func (s *SMTPService) send(to, subject, body string) error {
	msg := s.buildMessage(to, subject, body)

	addr := fmt.Sprintf("%s:%d", s.host, s.port)

	ctx, cancel := context.WithTimeout(context.Background(), smtpTimeout)
	defer cancel()

	dialer := net.Dialer{Timeout: smtpTimeout}
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return fmt.Errorf("connecting to SMTP server: %w", err)
	}

	client, err := smtp.NewClient(conn, s.host)
	if err != nil {
		conn.Close()
		return fmt.Errorf("creating SMTP client: %w", err)
	}
	defer client.Close()

	if ok, _ := client.Extension("STARTTLS"); ok {
		tlsCfg := &tls.Config{ServerName: s.host}
		if err := client.StartTLS(tlsCfg); err != nil {
			return fmt.Errorf("STARTTLS: %w", err)
		}
	} else if s.port != 25 && s.port != 1025 {
		return fmt.Errorf("STARTTLS not available on port %d (required for secure auth)", s.port)
	}

	if s.username != "" && s.password != "" {
		auth := smtp.PlainAuth("", s.username, s.password, s.host)
		if err := client.Auth(auth); err != nil {
			return fmt.Errorf("SMTP authentication: %w", err)
		}
	}

	if err := client.Mail(s.from); err != nil {
		return fmt.Errorf("SMTP MAIL command: %w", err)
	}

	if err := client.Rcpt(to); err != nil {
		return fmt.Errorf("SMTP RCPT command: %w", err)
	}

	wc, err := client.Data()
	if err != nil {
		return fmt.Errorf("SMTP DATA command: %w", err)
	}

	_, err = wc.Write([]byte(msg))
	if err != nil {
		wc.Close()
		return fmt.Errorf("writing email body: %w", err)
	}

	if err := wc.Close(); err != nil {
		return fmt.Errorf("closing email body: %w", err)
	}

	if err := client.Quit(); err != nil {
		slog.Warn("smtp QUIT command failed", "component", "email", "error", err)
	}

	return nil
}

func (s *SMTPService) buildMessage(to, subject, body string) string {
	return fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=\"utf-8\"\r\n\r\n%s",
		s.from, to, subject, body)
}
