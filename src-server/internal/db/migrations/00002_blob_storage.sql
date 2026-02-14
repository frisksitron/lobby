-- +goose Up
CREATE TABLE blobs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('avatar', 'server_image', 'chat_attachment')),
    uploaded_by TEXT NOT NULL REFERENCES users(id),
    storage_path TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
    original_name TEXT NOT NULL,
    message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
    claimed_at DATETIME,
    expires_at DATETIME,
    preview_storage_path TEXT,
    preview_mime_type TEXT,
    preview_size_bytes INTEGER,
    preview_width INTEGER,
    preview_height INTEGER,
    created_at DATETIME NOT NULL
);

CREATE INDEX idx_blobs_message_id ON blobs(message_id);
CREATE INDEX idx_blobs_uploaded_by ON blobs(uploaded_by);
CREATE INDEX idx_blobs_expires_at ON blobs(expires_at);
CREATE INDEX idx_blobs_preview_storage_path ON blobs(preview_storage_path);

CREATE TABLE server_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    icon_blob_id TEXT REFERENCES blobs(id) ON DELETE SET NULL,
    updated_at DATETIME NOT NULL
);

INSERT INTO server_settings (id, icon_blob_id, updated_at)
VALUES (1, NULL, CURRENT_TIMESTAMP);
