package api

import (
	"fmt"
	"net"
	"net/http"
	"strings"
)

// ClientIPResolver resolves the client IP address for security decisions
// (rate limiting, abuse controls). It only trusts forwarding headers when the
// immediate peer is in a trusted proxy CIDR.
type ClientIPResolver struct {
	trustedProxyNets []*net.IPNet
}

func NewClientIPResolver(trustedProxyCIDRs []string) (*ClientIPResolver, error) {
	resolver := &ClientIPResolver{}

	for _, raw := range trustedProxyCIDRs {
		value := strings.TrimSpace(raw)
		if value == "" {
			continue
		}

		if ip := net.ParseIP(value); ip != nil {
			bits := 32
			if ip.To4() == nil {
				bits = 128
			}
			resolver.trustedProxyNets = append(resolver.trustedProxyNets, &net.IPNet{
				IP:   ip,
				Mask: net.CIDRMask(bits, bits),
			})
			continue
		}

		_, network, err := net.ParseCIDR(value)
		if err != nil {
			return nil, fmt.Errorf("invalid trusted proxy CIDR %q: %w", value, err)
		}
		resolver.trustedProxyNets = append(resolver.trustedProxyNets, network)
	}

	return resolver, nil
}

func (r *ClientIPResolver) Resolve(req *http.Request) string {
	peerIP := parseIPFromRemoteAddr(req.RemoteAddr)
	if peerIP == nil {
		return "unknown"
	}

	if r.isTrustedProxy(peerIP) {
		if forwarded := parseForwardedFor(req.Header.Get("X-Forwarded-For")); forwarded != nil {
			return forwarded.String()
		}
		if realIP := parseIP(req.Header.Get("X-Real-IP")); realIP != nil {
			return realIP.String()
		}
	}

	return peerIP.String()
}

func (r *ClientIPResolver) isTrustedProxy(ip net.IP) bool {
	if ip == nil {
		return false
	}
	for _, network := range r.trustedProxyNets {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

func parseForwardedFor(header string) net.IP {
	if header == "" {
		return nil
	}

	parts := strings.Split(header, ",")
	for _, part := range parts {
		if ip := parseIP(part); ip != nil {
			return ip
		}
	}

	return nil
}

func parseIPFromRemoteAddr(remoteAddr string) net.IP {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err == nil {
		return parseIP(host)
	}

	return parseIP(remoteAddr)
}

func parseIP(value string) net.IP {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}

	if len(value) >= 2 && value[0] == '"' && value[len(value)-1] == '"' {
		value = value[1 : len(value)-1]
	}

	if ip := net.ParseIP(value); ip != nil {
		return ip
	}

	host, _, err := net.SplitHostPort(value)
	if err == nil {
		host = strings.Trim(host, "[]")
		return net.ParseIP(host)
	}

	return nil
}
