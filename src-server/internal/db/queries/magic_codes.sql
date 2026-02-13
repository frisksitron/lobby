-- name: CreateMagicCode :exec
INSERT INTO magic_codes (
    id,
    email,
    code_hash,
    expires_at,
    attempts,
    created_at
) VALUES (
    sqlc.arg(id),
    sqlc.arg(email),
    sqlc.arg(code_hash),
    sqlc.arg(expires_at),
    0,
    sqlc.arg(created_at)
);

-- name: GetLatestUnusedMagicCodeByEmail :one
SELECT id, email, code_hash, expires_at, used_at, attempts, created_at
FROM magic_codes
WHERE email = sqlc.arg(email)
  AND used_at IS NULL
ORDER BY created_at DESC
LIMIT 1;

-- name: IncrementMagicCodeAttempts :one
UPDATE magic_codes
SET attempts = attempts + 1
WHERE id = sqlc.arg(id)
  AND attempts < sqlc.arg(max_attempts)
RETURNING attempts;

-- name: MarkMagicCodeUsedIfUnused :execrows
UPDATE magic_codes
SET used_at = sqlc.arg(used_at)
WHERE id = sqlc.arg(id)
  AND used_at IS NULL;

-- name: DeleteExpiredMagicCodes :execrows
DELETE FROM magic_codes
WHERE expires_at < sqlc.arg(expires_before);
