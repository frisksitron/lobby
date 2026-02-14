package blob

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"testing"
)

func TestNormalizeStaticImageConvertsOpaqueImagesToJPEGAndResizes(t *testing.T) {
	src := image.NewRGBA(image.Rect(0, 0, 640, 320))
	draw.Draw(src, src.Bounds(), &image.Uniform{C: color.RGBA{R: 40, G: 90, B: 220, A: 255}}, image.Point{}, draw.Src)

	normalized, err := NormalizeStaticImage(bytes.NewReader(encodePNG(t, src)), 256, 82)
	if err != nil {
		t.Fatalf("NormalizeStaticImage() error = %v", err)
	}
	if normalized.MimeType != "image/jpeg" {
		t.Fatalf("normalized.MimeType = %q, want image/jpeg", normalized.MimeType)
	}
	if normalized.Width != 256 || normalized.Height != 128 {
		t.Fatalf("normalized dimensions = %dx%d, want 256x128", normalized.Width, normalized.Height)
	}

	decoded, format, err := image.Decode(bytes.NewReader(normalized.Data))
	if err != nil {
		t.Fatalf("image.Decode() error = %v", err)
	}
	if format != "jpeg" {
		t.Fatalf("decoded format = %q, want jpeg", format)
	}
	if decoded.Bounds().Dx() != 256 || decoded.Bounds().Dy() != 128 {
		t.Fatalf("decoded dimensions = %dx%d, want 256x128", decoded.Bounds().Dx(), decoded.Bounds().Dy())
	}
}

func TestNormalizeStaticImagePreservesAlphaAsPNG(t *testing.T) {
	src := image.NewNRGBA(image.Rect(0, 0, 400, 400))
	draw.Draw(src, src.Bounds(), &image.Uniform{C: color.NRGBA{R: 255, G: 60, B: 60, A: 128}}, image.Point{}, draw.Src)

	normalized, err := NormalizeStaticImage(bytes.NewReader(encodePNG(t, src)), 256, 82)
	if err != nil {
		t.Fatalf("NormalizeStaticImage() error = %v", err)
	}
	if normalized.MimeType != "image/png" {
		t.Fatalf("normalized.MimeType = %q, want image/png", normalized.MimeType)
	}
	if normalized.Width != 256 || normalized.Height != 256 {
		t.Fatalf("normalized dimensions = %dx%d, want 256x256", normalized.Width, normalized.Height)
	}

	decoded, format, err := image.Decode(bytes.NewReader(normalized.Data))
	if err != nil {
		t.Fatalf("image.Decode() error = %v", err)
	}
	if format != "png" {
		t.Fatalf("decoded format = %q, want png", format)
	}
	_, _, _, alpha := decoded.At(0, 0).RGBA()
	if alpha == 0xffff {
		t.Fatalf("decoded alpha = %d, want transparent pixel", alpha)
	}
}

func TestNormalizeStaticImageDoesNotUpscaleSmallImages(t *testing.T) {
	src := image.NewRGBA(image.Rect(0, 0, 48, 32))
	draw.Draw(src, src.Bounds(), &image.Uniform{C: color.RGBA{R: 20, G: 140, B: 80, A: 255}}, image.Point{}, draw.Src)

	normalized, err := NormalizeStaticImage(bytes.NewReader(encodePNG(t, src)), 256, 82)
	if err != nil {
		t.Fatalf("NormalizeStaticImage() error = %v", err)
	}
	if normalized.Width != 48 || normalized.Height != 32 {
		t.Fatalf("normalized dimensions = %dx%d, want 48x32", normalized.Width, normalized.Height)
	}
}

func TestNormalizeStaticImageRejectsInvalidImageData(t *testing.T) {
	_, err := NormalizeStaticImage(bytes.NewReader([]byte("not-an-image")), 256, 82)
	if !errors.Is(err, ErrInvalidImage) {
		t.Fatalf("NormalizeStaticImage() error = %v, want ErrInvalidImage", err)
	}
}

func encodePNG(t *testing.T, img image.Image) []byte {
	t.Helper()

	buf := bytes.NewBuffer(nil)
	if err := png.Encode(buf, img); err != nil {
		t.Fatalf("png.Encode() error = %v", err)
	}
	return buf.Bytes()
}
