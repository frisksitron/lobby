package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"lobby/internal/constants"
)

func TestParseHistoryQuery(t *testing.T) {
	tests := []struct {
		name        string
		query       string
		wantLimit   int
		wantBefore  string
		wantMessage string
		wantOK      bool
	}{
		{
			name:       "defaults",
			query:      "",
			wantLimit:  defaultMessageHistoryLimit,
			wantBefore: "",
			wantOK:     true,
		},
		{
			name:       "valid_limit_and_before",
			query:      "limit=25&before=msg_0123456789abcdef01234567",
			wantLimit:  25,
			wantBefore: "msg_0123456789abcdef01234567",
			wantOK:     true,
		},
		{
			name:        "invalid_limit_non_integer",
			query:       "limit=abc",
			wantMessage: "Query parameter 'limit' must be an integer",
			wantOK:      false,
		},
		{
			name:        "invalid_limit_out_of_range",
			query:       fmt.Sprintf("limit=%d", constants.MessageHistoryMaxLimit+1),
			wantMessage: fmt.Sprintf("Query parameter 'limit' must be between 1 and %d", constants.MessageHistoryMaxLimit),
			wantOK:      false,
		},
		{
			name:        "invalid_before",
			query:       "before=not-a-message-id",
			wantMessage: "Query parameter 'before' must be a valid message ID",
			wantOK:      false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/v1/messages?"+tt.query, nil)
			limit, beforeID, message, ok := parseHistoryQuery(req)

			if ok != tt.wantOK {
				t.Fatalf("parseHistoryQuery() ok = %v, want %v", ok, tt.wantOK)
			}
			if message != tt.wantMessage {
				t.Fatalf("parseHistoryQuery() message = %q, want %q", message, tt.wantMessage)
			}
			if limit != tt.wantLimit {
				t.Fatalf("parseHistoryQuery() limit = %d, want %d", limit, tt.wantLimit)
			}
			if beforeID != tt.wantBefore {
				t.Fatalf("parseHistoryQuery() beforeID = %q, want %q", beforeID, tt.wantBefore)
			}
		})
	}
}

func TestIsValidMessageID(t *testing.T) {
	tests := []struct {
		name string
		id   string
		want bool
	}{
		{name: "valid", id: "msg_0123456789abcdef01234567", want: true},
		{name: "wrong_prefix", id: "usr_0123456789abcdef01234567", want: false},
		{name: "wrong_length", id: "msg_0123456789abcdef", want: false},
		{name: "uppercase_hex", id: "msg_0123456789ABCDEF01234567", want: false},
		{name: "non_hex", id: "msg_0123456789abcdef0123456g", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isValidMessageID(tt.id); got != tt.want {
				t.Fatalf("isValidMessageID(%q) = %v, want %v", tt.id, got, tt.want)
			}
		})
	}
}
