package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/go-playground/validator/v10"
)

var requestValidator = validator.New()

func decodeAndValidate(body io.Reader, dst any) error {
	decoder := json.NewDecoder(body)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(dst); err != nil {
		return fmt.Errorf("invalid JSON body")
	}

	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("invalid JSON body")
	}

	if err := requestValidator.Struct(dst); err != nil {
		if validationErrors, ok := err.(validator.ValidationErrors); ok && len(validationErrors) > 0 {
			first := validationErrors[0]
			field := strings.ToLower(first.Field())
			switch first.Tag() {
			case "required":
				return fmt.Errorf("%s is required", field)
			case "email":
				return fmt.Errorf("invalid email format")
			case "len":
				return fmt.Errorf("invalid %s length", field)
			case "numeric":
				return fmt.Errorf("%s must contain only digits", field)
			default:
				return fmt.Errorf("invalid %s", field)
			}
		}

		return fmt.Errorf("invalid request payload")
	}

	return nil
}
