package blob

import (
	"bytes"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/jpeg"
	_ "image/png"
	"io"

	xdraw "golang.org/x/image/draw"
)

const (
	DefaultPreviewMaxEdge = 480
	DefaultPreviewQuality = 80
)

type Preview struct {
	Data     []byte
	MimeType string
	Width    int
	Height   int
}

func GenerateStaticImagePreview(src io.Reader, maxEdge int, quality int) (*Preview, error) {
	if maxEdge <= 0 {
		maxEdge = DefaultPreviewMaxEdge
	}
	if quality <= 0 || quality > 100 {
		quality = DefaultPreviewQuality
	}

	img, _, err := image.Decode(src)
	if err != nil {
		return nil, fmt.Errorf("decoding image: %w", err)
	}

	bounds := img.Bounds()
	if bounds.Dx() <= 0 || bounds.Dy() <= 0 {
		return nil, fmt.Errorf("invalid image dimensions")
	}

	width, height := scaleDimensions(bounds.Dx(), bounds.Dy(), maxEdge)
	previewImg := image.NewRGBA(image.Rect(0, 0, width, height))
	xdraw.CatmullRom.Scale(previewImg, previewImg.Bounds(), img, bounds, xdraw.Over, nil)

	buf := bytes.NewBuffer(nil)
	if err := jpeg.Encode(buf, previewImg, &jpeg.Options{Quality: quality}); err != nil {
		return nil, fmt.Errorf("encoding jpeg preview: %w", err)
	}

	return &Preview{
		Data:     buf.Bytes(),
		MimeType: "image/jpeg",
		Width:    width,
		Height:   height,
	}, nil
}

func scaleDimensions(width, height, maxEdge int) (int, int) {
	if width <= maxEdge && height <= maxEdge {
		return width, height
	}

	if width >= height {
		ratio := float64(maxEdge) / float64(width)
		scaledHeight := int(float64(height)*ratio + 0.5)
		if scaledHeight < 1 {
			scaledHeight = 1
		}
		return maxEdge, scaledHeight
	}

	ratio := float64(maxEdge) / float64(height)
	scaledWidth := int(float64(width)*ratio + 0.5)
	if scaledWidth < 1 {
		scaledWidth = 1
	}
	return scaledWidth, maxEdge
}
