-- name: CreateBlob :exec
INSERT INTO blobs (
    id,
    kind,
    uploaded_by,
    storage_path,
    mime_type,
    size_bytes,
    original_name,
    expires_at,
    created_at
) VALUES (
    sqlc.arg(id),
    sqlc.arg(kind),
    sqlc.arg(uploaded_by),
    sqlc.arg(storage_path),
    sqlc.arg(mime_type),
    sqlc.arg(size_bytes),
    sqlc.arg(original_name),
    sqlc.arg(expires_at),
    sqlc.arg(created_at)
);

-- name: GetBlobByID :one
SELECT id, kind, uploaded_by, storage_path, mime_type, size_bytes, original_name, message_id, claimed_at, expires_at, created_at,
       preview_storage_path, preview_mime_type, preview_size_bytes, preview_width, preview_height
FROM blobs
WHERE id = sqlc.arg(id)
LIMIT 1;

-- name: UpdateBlobPreview :execrows
UPDATE blobs
SET preview_storage_path = sqlc.arg(preview_storage_path),
    preview_mime_type = sqlc.arg(preview_mime_type),
    preview_size_bytes = sqlc.arg(preview_size_bytes),
    preview_width = sqlc.arg(preview_width),
    preview_height = sqlc.arg(preview_height)
WHERE id = sqlc.arg(id);

-- name: ClaimChatBlobsForMessage :execrows
UPDATE blobs
SET message_id = sqlc.arg(message_id),
    claimed_at = sqlc.arg(claimed_at),
    expires_at = NULL
WHERE kind = 'chat_attachment'
  AND uploaded_by = sqlc.arg(uploaded_by)
  AND message_id IS NULL
  AND (expires_at IS NULL OR expires_at > sqlc.arg(now))
  AND id IN (sqlc.slice(blob_ids));

-- name: ListMessageAttachments :many
SELECT id, original_name, mime_type, size_bytes, created_at,
       preview_storage_path, preview_mime_type, preview_size_bytes, preview_width, preview_height
FROM blobs
WHERE message_id = sqlc.arg(message_id)
  AND kind = 'chat_attachment'
ORDER BY created_at ASC, id ASC;

-- name: ListMessageAttachmentsByMessageIDs :many
SELECT message_id, id, original_name, mime_type, size_bytes, created_at,
       preview_storage_path, preview_mime_type, preview_size_bytes, preview_width, preview_height
FROM blobs
WHERE kind = 'chat_attachment'
  AND message_id IN (sqlc.slice(message_ids))
ORDER BY message_id ASC, created_at ASC, id ASC;

-- name: ListExpiredUnclaimedChatBlobs :many
SELECT id, storage_path, preview_storage_path
FROM blobs
WHERE kind = 'chat_attachment'
  AND message_id IS NULL
  AND expires_at IS NOT NULL
  AND expires_at <= sqlc.arg(now)
ORDER BY expires_at ASC
LIMIT sqlc.arg(limit_rows);

-- name: DeleteBlobByID :execrows
DELETE FROM blobs
WHERE id = sqlc.arg(id);
