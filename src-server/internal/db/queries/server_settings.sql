-- name: GetServerSettings :one
SELECT id, icon_blob_id, updated_at
FROM server_settings
WHERE id = 1
LIMIT 1;

-- name: SetServerIconBlobID :execrows
UPDATE server_settings
SET icon_blob_id = sqlc.arg(icon_blob_id),
    updated_at = sqlc.arg(updated_at)
WHERE id = 1;
