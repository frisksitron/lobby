package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"lobby/internal/db"
	sqldb "lobby/internal/db/sqlc"
	"lobby/internal/models"
)

func TestUpdateMeAllowsUnchangedUsername(t *testing.T) {
	database := openTestDB(t)
	queries := database.Queries()

	if err := queries.CreateUser(context.Background(), sqldb.CreateUserParams{
		ID:        "usr_self",
		Username:  "alice",
		Email:     "alice@example.com",
		CreatedAt: time.Now().UTC(),
	}); err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}

	handler := NewUserHandler(queries, nil)
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/users/me", strings.NewReader(`{"username":"alice"}`))
	req = req.WithContext(context.WithValue(req.Context(), userIDKey, "usr_self"))
	rr := httptest.NewRecorder()

	handler.UpdateMe(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%q", rr.Code, http.StatusOK, rr.Body.String())
	}

	var user models.User
	if err := json.Unmarshal(rr.Body.Bytes(), &user); err != nil {
		t.Fatalf("json.Unmarshal() error = %v, body=%q", err, rr.Body.String())
	}
	if user.Username != "alice" {
		t.Fatalf("username = %q, want %q", user.Username, "alice")
	}
}

func TestUpdateMeRejectsTakenUsernameFromAnotherUser(t *testing.T) {
	database := openTestDB(t)
	queries := database.Queries()

	for _, user := range []sqldb.CreateUserParams{
		{ID: "usr_1", Username: "alice", Email: "alice@example.com", CreatedAt: time.Now().UTC()},
		{ID: "usr_2", Username: "bob", Email: "bob@example.com", CreatedAt: time.Now().UTC()},
	} {
		if err := queries.CreateUser(context.Background(), user); err != nil {
			t.Fatalf("CreateUser() error = %v", err)
		}
	}

	handler := NewUserHandler(queries, nil)
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/users/me", strings.NewReader(`{"username":"bob"}`))
	req = req.WithContext(context.WithValue(req.Context(), userIDKey, "usr_1"))
	rr := httptest.NewRecorder()

	handler.UpdateMe(rr, req)

	if rr.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d, body=%q", rr.Code, http.StatusConflict, rr.Body.String())
	}

	var resp ErrorResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("json.Unmarshal() error = %v, body=%q", err, rr.Body.String())
	}
	if resp.Error.Code != ErrCodeConflict {
		t.Fatalf("error.code = %q, want %q", resp.Error.Code, ErrCodeConflict)
	}
}

func openTestDB(t *testing.T) *db.DB {
	t.Helper()

	database, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open() error = %v", err)
	}
	t.Cleanup(func() {
		_ = database.Close()
	})

	return database
}
