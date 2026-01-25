package db

import (
	"database/sql"
	"fmt"
	"time"
)

// nullTimeToPtr converts a sql.NullTime to *time.Time.
func nullTimeToPtr(nt sql.NullTime) *time.Time {
	if !nt.Valid {
		return nil
	}
	return &nt.Time
}

// checkRowsAffected verifies at least one row was affected, returns ErrNotFound if not
func checkRowsAffected(result sql.Result) error {
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("checking rows affected: %w", err)
	}
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}
