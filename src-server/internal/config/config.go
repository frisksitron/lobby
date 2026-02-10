package config

import (
	"errors"
	"fmt"
	"net"
	"os"
	"strconv"
	"time"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server   ServerConfig   `yaml:"server"`
	Database DatabaseConfig `yaml:"database"`
	Auth     AuthConfig     `yaml:"auth"`
	Email    EmailConfig    `yaml:"email"`
	SFU      SFUConfig      `yaml:"sfu"`
}

type SFUConfig struct {
	PublicIP string     `yaml:"publicIP"`
	MinPort  uint16     `yaml:"minPort"`
	MaxPort  uint16     `yaml:"maxPort"`
	TURN     TURNConfig `yaml:"turn"`
}

type TURNConfig struct {
	Host   string        `yaml:"host"`   // coturn hostname/IP (e.g., "turn.myserver.com")
	Port   int           `yaml:"port"`   // coturn listening port (default 3478)
	Secret string        `yaml:"secret"` // coturn static-auth-secret
	TTL    time.Duration `yaml:"ttl"`    // credential lifetime (default 24h)
}

type ServerConfig struct {
	Name    string `yaml:"name"`
	Host    string `yaml:"host"`
	Port    int    `yaml:"port"`
	BaseURL string `yaml:"base_url"`
}

type DatabaseConfig struct {
	Path string `yaml:"path"`
}

type AuthConfig struct {
	JWTSecret       string        `yaml:"jwt_secret"`
	AccessTokenTTL  time.Duration `yaml:"access_token_ttl"`
	RefreshTokenTTL time.Duration `yaml:"refresh_token_ttl"`
	MagicCodeTTL    time.Duration `yaml:"magic_code_ttl"`
}

type EmailConfig struct {
	SMTP SMTPConfig `yaml:"smtp"`
}

type SMTPConfig struct {
	Host     string `yaml:"host"`
	Port     int    `yaml:"port"`
	Username string `yaml:"username"`
	Password string `yaml:"password"`
	From     string `yaml:"from"`
}

func Load(path string) (*Config, error) {
	var cfg Config

	data, err := os.ReadFile(path)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("reading config file: %w", err)
		}
		// No config file — continue with env vars + defaults
	} else {
		if err := yaml.Unmarshal(data, &cfg); err != nil {
			return nil, fmt.Errorf("parsing config file: %w", err)
		}
	}

	cfg.applyEnvOverrides()

	if err := cfg.validate(); err != nil {
		return nil, fmt.Errorf("validating config: %w", err)
	}

	cfg.setDefaults()

	return &cfg, nil
}

func envString(key string, dst *string) {
	if v := os.Getenv(key); v != "" {
		*dst = v
	}
}

func envInt(key string, dst *int) {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			*dst = i
		}
	}
}

func envUint16(key string, dst *uint16) {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.ParseUint(v, 10, 16); err == nil {
			*dst = uint16(i)
		}
	}
}

func envDuration(key string, dst *time.Duration) {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			*dst = d
		}
	}
}

func (c *Config) applyEnvOverrides() {
	// Server
	envString("LOBBY_SERVER_NAME", &c.Server.Name)
	envString("LOBBY_SERVER_BASE_URL", &c.Server.BaseURL)

	// Database
	envString("LOBBY_DATABASE_PATH", &c.Database.Path)

	// Auth
	envString("LOBBY_JWT_SECRET", &c.Auth.JWTSecret)
	envDuration("LOBBY_ACCESS_TOKEN_TTL", &c.Auth.AccessTokenTTL)
	envDuration("LOBBY_REFRESH_TOKEN_TTL", &c.Auth.RefreshTokenTTL)
	envDuration("LOBBY_MAGIC_CODE_TTL", &c.Auth.MagicCodeTTL)

	// Email / SMTP
	envString("LOBBY_SMTP_HOST", &c.Email.SMTP.Host)
	envInt("LOBBY_SMTP_PORT", &c.Email.SMTP.Port)
	envString("LOBBY_SMTP_USERNAME", &c.Email.SMTP.Username)
	envString("LOBBY_SMTP_PASSWORD", &c.Email.SMTP.Password)
	envString("LOBBY_SMTP_FROM", &c.Email.SMTP.From)

	// SFU
	envString("LOBBY_SFU_PUBLIC_IP", &c.SFU.PublicIP)
	envUint16("LOBBY_SFU_MIN_PORT", &c.SFU.MinPort)
	envUint16("LOBBY_SFU_MAX_PORT", &c.SFU.MaxPort)

	// TURN
	if v := os.Getenv("LOBBY_TURN_ADDR"); v != "" {
		if host, portStr, err := net.SplitHostPort(v); err == nil {
			c.SFU.TURN.Host = host
			if port, err := strconv.Atoi(portStr); err == nil {
				c.SFU.TURN.Port = port
			}
		}
	}
	envString("LOBBY_TURN_SECRET", &c.SFU.TURN.Secret)
	envDuration("LOBBY_TURN_TTL", &c.SFU.TURN.TTL)
}

func (c *Config) validate() error {
	if c.Auth.JWTSecret == "" {
		return fmt.Errorf("auth.jwt_secret is required")
	}
	if len(c.Auth.JWTSecret) < 32 {
		return fmt.Errorf("auth.jwt_secret must be at least 32 characters")
	}
	if c.Email.SMTP.Host == "" {
		return fmt.Errorf("email.smtp.host is required")
	}
	if c.Email.SMTP.Port == 0 {
		return fmt.Errorf("email.smtp.port is required")
	}
	if c.Email.SMTP.From == "" {
		return fmt.Errorf("email.smtp.from is required")
	}
	return nil
}

func (c *Config) setDefaults() {
	if c.Server.Host == "" {
		c.Server.Host = "0.0.0.0"
	}
	if c.Server.Port == 0 {
		c.Server.Port = 8080
	}
	if c.Server.Name == "" {
		c.Server.Name = "Lobby Server"
	}
	if c.Server.BaseURL == "" {
		c.Server.BaseURL = fmt.Sprintf("http://%s:%d", c.Server.Host, c.Server.Port)
	}
	if c.Database.Path == "" {
		c.Database.Path = "./data/lobby.db"
	}
	if c.Auth.AccessTokenTTL == 0 {
		c.Auth.AccessTokenTTL = 15 * time.Minute
	}
	if c.Auth.RefreshTokenTTL == 0 {
		c.Auth.RefreshTokenTTL = 30 * 24 * time.Hour
	}
	if c.Auth.MagicCodeTTL == 0 {
		c.Auth.MagicCodeTTL = 10 * time.Minute
	}
	// SFU defaults
	if c.SFU.MinPort == 0 {
		c.SFU.MinPort = 50000
	}
	if c.SFU.MaxPort == 0 {
		c.SFU.MaxPort = 50100
	}
	if c.SFU.TURN.Port == 0 {
		c.SFU.TURN.Port = 3478
	}
	if c.SFU.TURN.TTL == 0 {
		c.SFU.TURN.TTL = 24 * time.Hour
	}
}

func (c *Config) Addr() string {
	return fmt.Sprintf("%s:%d", c.Server.Host, c.Server.Port)
}
