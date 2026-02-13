-- name: CreateRefreshToken :exec
INSERT INTO refresh_tokens (
    id,
    user_id,
    token_hash,
    expires_at,
    created_at
) VALUES (
    sqlc.arg(id),
    sqlc.arg(user_id),
    sqlc.arg(token_hash),
    sqlc.arg(expires_at),
    sqlc.arg(created_at)
);

-- name: GetRefreshTokenByHash :one
SELECT id, user_id, token_hash, expires_at, created_at, revoked_at
FROM refresh_tokens
WHERE token_hash = sqlc.arg(token_hash)
LIMIT 1;

-- name: RevokeRefreshToken :execrows
UPDATE refresh_tokens
SET revoked_at = sqlc.arg(revoked_at)
WHERE id = sqlc.arg(id)
  AND revoked_at IS NULL;

-- name: RevokeRefreshTokenForRotation :execrows
UPDATE refresh_tokens
SET revoked_at = sqlc.arg(revoked_at)
WHERE id = sqlc.arg(id)
  AND revoked_at IS NULL
  AND expires_at > sqlc.arg(now);

-- name: RevokeAllRefreshTokensForUser :exec
UPDATE refresh_tokens
SET revoked_at = sqlc.arg(revoked_at)
WHERE user_id = sqlc.arg(user_id)
  AND revoked_at IS NULL;

-- name: DeleteExpiredRefreshTokens :execrows
DELETE FROM refresh_tokens
WHERE expires_at < sqlc.arg(expires_before);
