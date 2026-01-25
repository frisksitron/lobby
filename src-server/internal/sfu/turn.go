package sfu

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"time"

	"lobby/internal/config"
)

// ICEServerInfo matches the ws.ICEServerInfo struct for client configuration.
type ICEServerInfo struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

// GenerateTURNCredentials generates ephemeral TURN credentials using the
// TURN REST API (HMAC-SHA1) scheme compatible with coturn's use-auth-secret.
func GenerateTURNCredentials(secret, userID string, ttl time.Duration) (username, credential string) {
	expiry := time.Now().Add(ttl).Unix()
	username = fmt.Sprintf("%d:%s", expiry, userID)

	mac := hmac.New(sha1.New, []byte(secret))
	mac.Write([]byte(username))
	credential = base64.StdEncoding.EncodeToString(mac.Sum(nil))
	return
}

// BuildICEServers produces the ICE server list sent to clients joining voice.
// If TURN is configured (Host non-empty), it returns both a STUN and TURN entry.
// Otherwise it returns nil (the client will attempt direct connections only).
func BuildICEServers(cfg config.TURNConfig, userID string) []ICEServerInfo {
	if cfg.Host == "" {
		return nil
	}

	stunURL := fmt.Sprintf("stun:%s:%d", cfg.Host, cfg.Port)
	turnURL := fmt.Sprintf("turn:%s:%d", cfg.Host, cfg.Port)

	username, credential := GenerateTURNCredentials(cfg.Secret, userID, cfg.TTL)

	return []ICEServerInfo{
		{URLs: []string{stunURL}},
		{URLs: []string{turnURL}, Username: username, Credential: credential},
	}
}
