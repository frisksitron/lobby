# Contributing

## Commit Messages

This project uses semantic commit messages.

Format: `<type>(<scope>): <subject>`

`<scope>` is optional

### Example

```
feat: add hat wobble
^--^  ^------------^
|     |
|     +-> Summary in present tense.
|
+-------> Type: chore, docs, feat, fix, refactor, style, or test.
```

### Types

| Type       | Description                                                |
| ---------- | ---------------------------------------------------------- |
| `feat`     | New feature for the user                                   |
| `fix`      | Bug fix for the user                                       |
| `docs`     | Documentation changes                                      |
| `style`    | Visual/UI changes, formatting (no logic change)            |
| `refactor` | Code restructuring without changing behavior               |
| `test`     | Adding or refactoring tests (no production code change)    |
| `chore`    | Maintenance tasks, config, dependencies (no product change)|

### Scope

Use scope to indicate the area of the codebase:

- `client` - Desktop client
- `server` - Go server
- Or a specific component/feature name

Omit scope when changes span multiple areas or the type is self-explanatory.

### Examples

```
feat(client): add voice activity indicator
fix(server): handle disconnection during handshake
style: polish sidebar member selection
refactor: consolidate authentication logic
docs: update setup instructions
chore: upgrade electron to v28
test(client): add WebRTC connection tests
```
