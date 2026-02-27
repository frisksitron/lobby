package api

import (
	"testing"
	"time"
)

func TestRetryAfterSeconds(t *testing.T) {
	tests := []struct {
		name   string
		window time.Duration
		want   int
	}{
		{name: "zero", window: 0, want: 1},
		{name: "negative", window: -time.Second, want: 1},
		{name: "fractional_rounds_up", window: 1500 * time.Millisecond, want: 2},
		{name: "whole_second", window: time.Second, want: 1},
		{name: "minute", window: time.Minute, want: 60},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := retryAfterSeconds(tt.window); got != tt.want {
				t.Fatalf("retryAfterSeconds(%s) = %d, want %d", tt.window, got, tt.want)
			}
		})
	}
}
