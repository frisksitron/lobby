package blob

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func TestSaveRejectsExecutableSignatureForChatAttachment(t *testing.T) {
	svc, err := NewService(t.TempDir(), 1024*1024)
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}

	_, err = svc.Save(context.Background(), KindChatAttachment, "payload.png", bytes.NewReader([]byte("MZ\x90\x00\x03\x00")))
	if !errors.Is(err, ErrExecutableFile) {
		t.Fatalf("Save() error = %v, want ErrExecutableFile", err)
	}
}

func TestSaveAllowsUnknownBinaryForChatAttachment(t *testing.T) {
	svc, err := NewService(t.TempDir(), 1024*1024)
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}

	stored, err := svc.Save(context.Background(), KindChatAttachment, "blob.bin", bytes.NewReader([]byte{0x00, 0x01, 0x02, 0x03, 0x04}))
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	if stored == nil {
		t.Fatal("Save() returned nil stored blob")
	}
	if stored.MimeType != "application/octet-stream" {
		t.Fatalf("stored.MimeType = %q, want application/octet-stream", stored.MimeType)
	}
}

func TestSaveRejectsNonImageBytesForAvatarEvenWithPngExtension(t *testing.T) {
	svc, err := NewService(t.TempDir(), 1024*1024)
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}

	_, err = svc.Save(context.Background(), KindAvatar, "avatar.png", bytes.NewReader([]byte{0x00, 0x01, 0x02, 0x03}))
	if !errors.Is(err, ErrDisallowedType) {
		t.Fatalf("Save() error = %v, want ErrDisallowedType", err)
	}
}

func TestSaveAcceptsRealImageForAvatar(t *testing.T) {
	svc, err := NewService(t.TempDir(), 1024*1024)
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}

	img := image.NewRGBA(image.Rect(0, 0, 1, 1))
	img.Set(0, 0, color.RGBA{R: 255, G: 0, B: 0, A: 255})

	buf := bytes.NewBuffer(nil)
	if err := png.Encode(buf, img); err != nil {
		t.Fatalf("png.Encode() error = %v", err)
	}

	stored, err := svc.Save(context.Background(), KindAvatar, "avatar.png", bytes.NewReader(buf.Bytes()))
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	if stored.MimeType != "image/png" {
		t.Fatalf("stored.MimeType = %q, want image/png", stored.MimeType)
	}
}
