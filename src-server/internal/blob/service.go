package blob

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"lobby/internal/db"
)

type Kind string

const (
	KindAvatar         Kind = "avatar"
	KindServerImage    Kind = "server_image"
	KindChatAttachment Kind = "chat_attachment"
)

var (
	ErrFileTooLarge   = errors.New("blob file too large")
	ErrInvalidKind    = errors.New("invalid blob kind")
	ErrDisallowedType = errors.New("disallowed blob mime type")
	ErrExecutableFile = errors.New("executable files are not allowed")
	ErrInvalidPath    = errors.New("invalid blob path")
)

type StoredBlob struct {
	ID           string
	Kind         Kind
	StoragePath  string
	MimeType     string
	SizeBytes    int64
	OriginalName string
	CreatedAt    time.Time
}

type Service struct {
	rootDir        string
	maxUploadBytes int64
}

func NewService(rootDir string, maxUploadBytes int64) (*Service, error) {
	if strings.TrimSpace(rootDir) == "" {
		return nil, fmt.Errorf("blob root directory is required")
	}
	if maxUploadBytes <= 0 {
		return nil, fmt.Errorf("max upload bytes must be > 0")
	}

	if err := os.MkdirAll(rootDir, 0o755); err != nil {
		return nil, fmt.Errorf("creating blob root directory: %w", err)
	}

	return &Service{
		rootDir:        rootDir,
		maxUploadBytes: maxUploadBytes,
	}, nil
}

func (s *Service) MaxUploadBytes() int64 {
	return s.maxUploadBytes
}

func (s *Service) Save(_ context.Context, kind Kind, originalName string, src io.Reader) (*StoredBlob, error) {
	if !isValidKind(kind) {
		return nil, ErrInvalidKind
	}

	name := sanitizeOriginalName(originalName)
	blobID, err := db.GenerateID("blb")
	if err != nil {
		return nil, fmt.Errorf("generating blob id: %w", err)
	}

	relPath := blobRelativePath(kind, blobID)
	absPath, err := s.resolveStoragePath(relPath)
	if err != nil {
		return nil, err
	}

	if err := os.MkdirAll(filepath.Dir(absPath), 0o755); err != nil {
		return nil, fmt.Errorf("creating blob directory: %w", err)
	}

	tmpFile, err := os.CreateTemp(filepath.Dir(absPath), blobID+".tmp-*")
	if err != nil {
		return nil, fmt.Errorf("creating temporary blob file: %w", err)
	}
	tmpPath := tmpFile.Name()
	defer func() {
		_ = tmpFile.Close()
		_ = os.Remove(tmpPath)
	}()

	sniff := make([]byte, 512)
	sniffN, sniffErr := io.ReadFull(src, sniff)
	if sniffErr != nil && sniffErr != io.EOF && sniffErr != io.ErrUnexpectedEOF {
		return nil, fmt.Errorf("reading blob data: %w", sniffErr)
	}
	sniff = sniff[:sniffN]

	if isExecutableSignature(sniff) {
		return nil, ErrExecutableFile
	}

	mimeType := detectMimeType(sniff)
	if !isAllowedMimeType(kind, mimeType) {
		return nil, ErrDisallowedType
	}

	fullReader := io.MultiReader(bytes.NewReader(sniff), src)
	written, err := io.Copy(tmpFile, io.LimitReader(fullReader, s.maxUploadBytes+1))
	if err != nil {
		return nil, fmt.Errorf("writing blob file: %w", err)
	}
	if written > s.maxUploadBytes {
		return nil, ErrFileTooLarge
	}
	if err := tmpFile.Close(); err != nil {
		return nil, fmt.Errorf("closing temporary blob file: %w", err)
	}

	if err := os.Rename(tmpPath, absPath); err != nil {
		return nil, fmt.Errorf("finalizing blob file: %w", err)
	}

	return &StoredBlob{
		ID:           blobID,
		Kind:         kind,
		StoragePath:  relPath,
		MimeType:     mimeType,
		SizeBytes:    written,
		OriginalName: name,
		CreatedAt:    time.Now().UTC(),
	}, nil
}

func (s *Service) Open(storagePath string) (*os.File, error) {
	absPath, err := s.resolveStoragePath(storagePath)
	if err != nil {
		return nil, err
	}
	return os.Open(absPath)
}

func (s *Service) Write(storagePath string, src io.Reader) (int64, error) {
	absPath, err := s.resolveStoragePath(storagePath)
	if err != nil {
		return 0, err
	}

	if err := os.MkdirAll(filepath.Dir(absPath), 0o755); err != nil {
		return 0, fmt.Errorf("creating blob directory: %w", err)
	}

	tmpFile, err := os.CreateTemp(filepath.Dir(absPath), "blob-write-*.tmp")
	if err != nil {
		return 0, fmt.Errorf("creating temporary blob file: %w", err)
	}
	tmpPath := tmpFile.Name()
	defer func() {
		_ = tmpFile.Close()
		_ = os.Remove(tmpPath)
	}()

	written, err := io.Copy(tmpFile, src)
	if err != nil {
		return 0, fmt.Errorf("writing blob file: %w", err)
	}
	if err := tmpFile.Close(); err != nil {
		return 0, fmt.Errorf("closing temporary blob file: %w", err)
	}

	if err := os.Rename(tmpPath, absPath); err != nil {
		return 0, fmt.Errorf("finalizing blob file: %w", err)
	}

	return written, nil
}

func (s *Service) Delete(storagePath string) error {
	absPath, err := s.resolveStoragePath(storagePath)
	if err != nil {
		return err
	}

	err = os.Remove(absPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("deleting blob file: %w", err)
	}

	return nil
}

func (s *Service) resolveStoragePath(storagePath string) (string, error) {
	clean := filepath.Clean(filepath.FromSlash(storagePath))
	if clean == "." || strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
		return "", ErrInvalidPath
	}

	return filepath.Join(s.rootDir, clean), nil
}

func blobRelativePath(kind Kind, blobID string) string {
	return filepath.ToSlash(filepath.Join(string(kind), blobPathPrefix(blobID), blobID))
}

func ChatAttachmentPreviewRelativePath(blobID string) string {
	return filepath.ToSlash(filepath.Join("chat_attachment_preview", blobPathPrefix(blobID), blobID+".jpg"))
}

func blobPathPrefix(blobID string) string {
	randomPart := strings.TrimPrefix(blobID, "blb_")
	if len(randomPart) < 2 {
		return "xx"
	}
	return randomPart[:2]
}

func sanitizeOriginalName(name string) string {
	name = strings.TrimSpace(filepath.Base(name))
	if name == "" || name == "." || name == string(filepath.Separator) {
		return "upload.bin"
	}
	if len(name) > 255 {
		return name[:255]
	}
	return name
}

func detectMimeType(sniff []byte) string {
	if len(sniff) == 0 {
		return "application/octet-stream"
	}

	return trimMimeParams(http.DetectContentType(sniff))
}

func isExecutableSignature(sniff []byte) bool {
	if len(sniff) < 2 {
		return false
	}

	if sniff[0] == 'M' && sniff[1] == 'Z' {
		return true // PE/COFF (Windows)
	}
	if len(sniff) >= 4 {
		if bytes.Equal(sniff[:4], []byte{0x7f, 'E', 'L', 'F'}) {
			return true // ELF
		}

		machoMagics := [][]byte{
			{0xfe, 0xed, 0xfa, 0xce},
			{0xce, 0xfa, 0xed, 0xfe},
			{0xfe, 0xed, 0xfa, 0xcf},
			{0xcf, 0xfa, 0xed, 0xfe},
			{0xca, 0xfe, 0xba, 0xbe},
			{0xbe, 0xba, 0xfe, 0xca},
			{0xca, 0xfe, 0xba, 0xbf},
			{0xbf, 0xba, 0xfe, 0xca},
		}
		for _, magic := range machoMagics {
			if bytes.Equal(sniff[:4], magic) {
				return true
			}
		}
	}

	if sniff[0] == '#' && sniff[1] == '!' {
		return true // shebang scripts
	}

	return false
}

func trimMimeParams(contentType string) string {
	if idx := strings.Index(contentType, ";"); idx != -1 {
		return strings.TrimSpace(contentType[:idx])
	}
	return strings.TrimSpace(contentType)
}

func isValidKind(kind Kind) bool {
	switch kind {
	case KindAvatar, KindServerImage, KindChatAttachment:
		return true
	default:
		return false
	}
}

func isAllowedMimeType(kind Kind, mimeType string) bool {
	mimeType = strings.ToLower(strings.TrimSpace(mimeType))
	if mimeType == "" {
		return false
	}

	disallowed := map[string]struct{}{
		"image/svg+xml":               {},
		"text/html":                   {},
		"application/xhtml+xml":       {},
		"application/javascript":      {},
		"text/javascript":             {},
		"application/x-javascript":    {},
		"text/ecmascript":             {},
		"application/ecmascript":      {},
		"application/x-httpd-php":     {},
		"application/x-sh":            {},
		"application/x-msdownload":    {},
		"application/x-msdos-program": {},
	}
	if _, blocked := disallowed[mimeType]; blocked {
		return false
	}

	switch kind {
	case KindAvatar, KindServerImage:
		return strings.HasPrefix(mimeType, "image/")
	case KindChatAttachment:
		return true
	default:
		return false
	}
}
