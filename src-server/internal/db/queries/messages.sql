-- name: CreateMessage :exec
INSERT INTO messages (
    id,
    author_id,
    content,
    created_at
) VALUES (
    sqlc.arg(id),
    sqlc.arg(author_id),
    sqlc.arg(content),
    sqlc.arg(created_at)
);

-- name: ListMessageHistory :many
SELECT
    m.id,
    m.author_id,
    COALESCE(u.username, '') AS author_name,
    u.avatar_url AS author_avatar_url,
    m.content,
    m.created_at,
    m.edited_at
FROM messages m
LEFT JOIN users u ON m.author_id = u.id
ORDER BY m.rowid DESC
LIMIT sqlc.arg(limit_rows);

-- name: ListMessageHistoryBefore :many
SELECT
    m.id,
    m.author_id,
    COALESCE(u.username, '') AS author_name,
    u.avatar_url AS author_avatar_url,
    m.content,
    m.created_at,
    m.edited_at
FROM messages m
LEFT JOIN users u ON m.author_id = u.id
WHERE m.rowid < (SELECT rowid FROM messages WHERE messages.id = sqlc.arg(before_id))
ORDER BY m.rowid DESC
LIMIT sqlc.arg(limit_rows);

-- name: GetMessageByID :one
SELECT id, author_id, content, created_at, edited_at
FROM messages
WHERE id = sqlc.arg(id)
LIMIT 1;
