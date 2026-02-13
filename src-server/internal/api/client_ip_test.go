package api

import (
	"net/http/httptest"
	"testing"
)

func TestClientIPResolverDirectConnectionIgnoresForwardedHeaders(t *testing.T) {
	resolver, err := NewClientIPResolver(nil)
	if err != nil {
		t.Fatalf("NewClientIPResolver error: %v", err)
	}

	req := httptest.NewRequest("GET", "http://localhost/test", nil)
	req.RemoteAddr = "203.0.113.7:43210"
	req.Header.Set("X-Forwarded-For", "198.51.100.5")
	req.Header.Set("X-Real-IP", "198.51.100.6")

	if got := resolver.Resolve(req); got != "203.0.113.7" {
		t.Fatalf("Resolve() = %q, want %q", got, "203.0.113.7")
	}
}

func TestClientIPResolverTrustedProxyUsesForwardedFor(t *testing.T) {
	resolver, err := NewClientIPResolver([]string{"172.30.0.10/32"})
	if err != nil {
		t.Fatalf("NewClientIPResolver error: %v", err)
	}

	req := httptest.NewRequest("GET", "http://localhost/test", nil)
	req.RemoteAddr = "172.30.0.10:12345"
	req.Header.Set("X-Forwarded-For", "198.51.100.8, 172.30.0.10")

	if got := resolver.Resolve(req); got != "198.51.100.8" {
		t.Fatalf("Resolve() = %q, want %q", got, "198.51.100.8")
	}
}

func TestClientIPResolverTrustedProxyFallsBackToRealIP(t *testing.T) {
	resolver, err := NewClientIPResolver([]string{"172.30.0.10/32"})
	if err != nil {
		t.Fatalf("NewClientIPResolver error: %v", err)
	}

	req := httptest.NewRequest("GET", "http://localhost/test", nil)
	req.RemoteAddr = "172.30.0.10:12345"
	req.Header.Set("X-Forwarded-For", "not-an-ip")
	req.Header.Set("X-Real-IP", "198.51.100.10")

	if got := resolver.Resolve(req); got != "198.51.100.10" {
		t.Fatalf("Resolve() = %q, want %q", got, "198.51.100.10")
	}
}
