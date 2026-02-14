package api

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestReadSingleFileUploadReturnsJSON413OnOversizeBody(t *testing.T) {
	body := bytes.NewBuffer(nil)
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("file", "large.bin")
	if err != nil {
		t.Fatalf("CreateFormFile() error = %v", err)
	}
	if _, err := part.Write(bytes.Repeat([]byte{'a'}, 2048)); err != nil {
		t.Fatalf("part.Write() error = %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("writer.Close() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/uploads/chat", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rr := httptest.NewRecorder()

	file, header, cleanup, ok := readSingleFileUpload(rr, req, 1024)
	if cleanup != nil {
		cleanup()
	}
	if file != nil {
		_ = file.Close()
	}
	if ok {
		t.Fatalf("readSingleFileUpload() ok = true, want false")
	}
	if header != nil {
		t.Fatalf("readSingleFileUpload() header = %#v, want nil", header)
	}

	if rr.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusRequestEntityTooLarge)
	}

	var resp ErrorResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("json.Unmarshal() error = %v, body=%q", err, rr.Body.String())
	}
	if resp.Error.Code != ErrCodePayloadTooLarge {
		t.Fatalf("error.code = %q, want %q", resp.Error.Code, ErrCodePayloadTooLarge)
	}
}
