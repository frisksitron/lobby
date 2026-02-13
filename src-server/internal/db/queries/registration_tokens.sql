-- name: CreateRegistrationToken :exec
INSERT INTO registration_tokens (
    id,
    email,
    token_hash,
    expires_at,
    created_at
) VALUES (
    sqlc.arg(id),
    sqlc.arg(email),
    sqlc.arg(token_hash),
    sqlc.arg(expires_at),
    sqlc.arg(created_at)
);

-- name: GetValidRegistrationToken :one
SELECT id, email, token_hash, expires_at, used_at, created_at
FROM registration_tokens
WHERE token_hash = sqlc.arg(token_hash)
  AND used_at IS NULL
  AND expires_at > sqlc.arg(now)
LIMIT 1;

-- name: ConsumeValidRegistrationToken :one
UPDATE registration_tokens
SET used_at = sqlc.arg(used_at)
WHERE token_hash = sqlc.arg(token_hash)
  AND used_at IS NULL
  AND expires_at > sqlc.arg(now)
RETURNING id, email, token_hash, expires_at, used_at, created_at;

-- name: DeleteExpiredRegistrationTokens :execrows
DELETE FROM registration_tokens
WHERE expires_at < sqlc.arg(expires_before);
