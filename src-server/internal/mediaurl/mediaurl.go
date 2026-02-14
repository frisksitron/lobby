package mediaurl

import (
	"net/url"
	"strings"
)

const PathPrefix = "/media/"

func Blob(baseURL, blobID string) string {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return PathPrefix + blobID
	}
	return baseURL + PathPrefix + blobID
}

func BlobPreview(baseURL, blobID string) string {
	return Blob(baseURL, blobID) + "/preview"
}

func ParseBlobID(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", false
	}

	u, err := url.Parse(raw)
	if err != nil {
		return "", false
	}

	path := u.Path
	if path == "" {
		path = raw
	}

	if !strings.HasPrefix(path, PathPrefix) {
		return "", false
	}

	blobID := strings.TrimPrefix(path, PathPrefix)
	if blobID == "" || strings.Contains(blobID, "/") {
		return "", false
	}

	return blobID, true
}
