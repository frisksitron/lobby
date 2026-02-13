-- name: CreateUser :exec
INSERT INTO users (
    id,
    username,
    email,
    session_version,
    created_at
) VALUES (
    sqlc.arg(id),
    sqlc.arg(username),
    sqlc.arg(email),
    1,
    sqlc.arg(created_at)
);

-- name: GetActiveUserByID :one
SELECT id, username, email, avatar_url, session_version, created_at, updated_at, deactivated_at
FROM users
WHERE id = sqlc.arg(id)
  AND deactivated_at IS NULL
LIMIT 1;

-- name: GetUserByEmail :one
SELECT id, username, email, avatar_url, session_version, created_at, updated_at, deactivated_at
FROM users
WHERE email = sqlc.arg(email)
LIMIT 1;

-- name: ListActiveUsers :many
SELECT id, username, avatar_url, created_at, updated_at
FROM users
WHERE deactivated_at IS NULL
ORDER BY username;

-- name: UpdateUsername :execrows
UPDATE users
SET username = sqlc.arg(username),
    updated_at = sqlc.arg(updated_at)
WHERE id = sqlc.arg(id);

-- name: DeactivateUser :execrows
UPDATE users
SET deactivated_at = sqlc.arg(deactivated_at),
    updated_at = sqlc.arg(updated_at)
WHERE id = sqlc.arg(id)
  AND deactivated_at IS NULL;

-- name: ReactivateUser :execrows
UPDATE users
SET deactivated_at = NULL,
    updated_at = sqlc.arg(updated_at)
WHERE id = sqlc.arg(id)
  AND deactivated_at IS NOT NULL;

-- name: CountUsersByUsername :one
SELECT COUNT(*)
FROM users
WHERE username = sqlc.arg(username);

-- name: IncrementUserSessionVersion :execrows
UPDATE users
SET session_version = session_version + 1,
    updated_at = sqlc.arg(updated_at)
WHERE id = sqlc.arg(id);
