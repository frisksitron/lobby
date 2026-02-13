package db

import (
	"crypto/rand"
	"encoding/hex"

	"lobby/internal/constants"
)

func GenerateID(prefix string) (string, error) {
	b := make([]byte, constants.IDRandomBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return prefix + "_" + hex.EncodeToString(b), nil
}
