package api

import (
	"net/http"
	"sync"
	"time"
)

// RateLimiter implements a sliding window rate limiter
type RateLimiter struct {
	mu       sync.Mutex
	requests map[string][]time.Time
	limit    int
	window   time.Duration
	cleanup  time.Time
}

// NewRateLimiter creates a new rate limiter
func NewRateLimiter(limit int, window time.Duration) *RateLimiter {
	return &RateLimiter{
		requests: make(map[string][]time.Time),
		limit:    limit,
		window:   window,
		cleanup:  time.Now(),
	}
}

// Allow checks if a request from the given key is allowed
func (rl *RateLimiter) Allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	windowStart := now.Add(-rl.window)

	if now.Sub(rl.cleanup) > time.Minute {
		for k, times := range rl.requests {
			filtered := filterTimes(times, windowStart)
			if len(filtered) == 0 {
				delete(rl.requests, k)
			} else {
				rl.requests[k] = filtered
			}
		}
		rl.cleanup = now
	}

	times := rl.requests[key]
	times = filterTimes(times, windowStart)

	if len(times) >= rl.limit {
		return false
	}

	rl.requests[key] = append(times, now)
	return true
}

func filterTimes(times []time.Time, cutoff time.Time) []time.Time {
	result := times[:0]
	for _, t := range times {
		if t.After(cutoff) {
			result = append(result, t)
		}
	}
	return result
}

// RateLimitMiddleware creates a middleware that rate limits by IP.
// chi's middleware.RealIP (applied globally) already sets r.RemoteAddr to the real IP.
func RateLimitMiddleware(limiter *RateLimiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !limiter.Allow(r.RemoteAddr) {
				w.Header().Set("Retry-After", "60")
				writeError(w, http.StatusTooManyRequests, ErrCodeRateLimitExceeded, "Too many requests, please try again later")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
