package db

import (
	"errors"

	sqlite3 "github.com/mattn/go-sqlite3"
)

func IsUniqueConstraintError(err error) bool {
	var sqliteErr sqlite3.Error
	if !errors.As(err, &sqliteErr) {
		return false
	}

	if sqliteErr.Code != sqlite3.ErrConstraint {
		return false
	}

	return sqliteErr.ExtendedCode == sqlite3.ErrConstraintUnique ||
		sqliteErr.ExtendedCode == sqlite3.ErrConstraintPrimaryKey
}
