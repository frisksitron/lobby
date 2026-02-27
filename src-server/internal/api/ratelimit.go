package api

import (
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/httprate"
)

// RateLimiter is a thin wrapper around chi/httprate configuration.
type RateLimiter struct {
	requestLimit int
	windowLength time.Duration
}

func NewRateLimiter(limit int, window time.Duration) *RateLimiter {
	return &RateLimiter{requestLimit: limit, windowLength: window}
}

func RateLimitMiddleware(limiter *RateLimiter, ipResolver *ClientIPResolver) func(http.Handler) http.Handler {
	if ipResolver == nil {
		ipResolver, _ = NewClientIPResolver(nil)
	}

	retryAfter := retryAfterSeconds(limiter.windowLength)

	middleware := httprate.Limit(
		limiter.requestLimit,
		limiter.windowLength,
		httprate.WithKeyFuncs(func(r *http.Request) (string, error) {
			return ipResolver.Resolve(r), nil
		}),
		httprate.WithLimitHandler(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
			writeError(w, http.StatusTooManyRequests, ErrCodeRateLimited, "")
		}),
	)

	return middleware
}

func retryAfterSeconds(window time.Duration) int {
	seconds := int(math.Ceil(window.Seconds()))
	if seconds < 1 {
		return 1
	}
	return seconds
}
