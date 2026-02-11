package api

import (
	"net/http/httptest"
	"testing"
	"time"

	"lobby/internal/config"
)

func TestOriginMatchesAllowed(t *testing.T) {
	tests := []struct {
		name    string
		origin  string
		allowed string
		want    bool
	}{
		{name: "exact_match", origin: "https://example.com", allowed: "https://example.com", want: true},
		{name: "wildcard_prefix_match", origin: "app://desktop/main", allowed: "app://*", want: true},
		{name: "wildcard_prefix_miss", origin: "https://example.com", allowed: "app://*", want: false},
		{name: "exact_miss", origin: "https://evil.com", allowed: "https://example.com", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := originMatchesAllowed(tt.origin, tt.allowed); got != tt.want {
				t.Fatalf("originMatchesAllowed(%q, %q) = %v, want %v", tt.origin, tt.allowed, got, tt.want)
			}
		})
	}
}

func TestCheckOriginAllowsLoopbackAndConfiguredOrigins(t *testing.T) {
	handler := NewWebSocketHandler(nil, config.WebSocketConfig{
		AllowedOrigins:           []string{"https://example.com", "app://*"},
		MaxUnauthenticatedPerIP:  10,
		MaxUnauthenticatedGlobal: 100,
		UnauthenticatedTimeout:   10 * time.Second,
	})

	loopbackReq := httptest.NewRequest("GET", "http://localhost/ws", nil)
	loopbackReq.Header.Set("Origin", "http://127.0.0.1:5173")
	if !handler.checkOrigin(loopbackReq) {
		t.Fatal("expected loopback origin to be allowed")
	}

	configuredReq := httptest.NewRequest("GET", "http://localhost/ws", nil)
	configuredReq.Header.Set("Origin", "https://example.com")
	if !handler.checkOrigin(configuredReq) {
		t.Fatal("expected configured origin to be allowed")
	}

	deniedReq := httptest.NewRequest("GET", "http://localhost/ws", nil)
	deniedReq.Header.Set("Origin", "https://evil.com")
	if handler.checkOrigin(deniedReq) {
		t.Fatal("expected disallowed origin to be rejected")
	}
}

func TestPreAuthBudgetReserveAndRelease(t *testing.T) {
	budget := newPreAuthBudget(2, 3)

	if !budget.reserve("1.1.1.1") {
		t.Fatal("expected first reservation to succeed")
	}
	if !budget.reserve("1.1.1.1") {
		t.Fatal("expected second reservation on same IP to succeed")
	}
	if budget.reserve("1.1.1.1") {
		t.Fatal("expected third reservation on same IP to fail")
	}

	if !budget.reserve("2.2.2.2") {
		t.Fatal("expected reservation on second IP to succeed")
	}
	if budget.reserve("3.3.3.3") {
		t.Fatal("expected global reservation limit to fail")
	}

	budget.releaseReservation("1.1.1.1")
	if !budget.reserve("3.3.3.3") {
		t.Fatal("expected reservation after release to succeed")
	}
}
