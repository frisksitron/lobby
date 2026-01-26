# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lobby is an Electron desktop app (Discord-like communication platform) built with Solid.js, TypeScript, and electron-vite. It supports multi-server connections, real-time messaging via WebSocket, and voice chat via WebRTC with noise suppression.

## Commands

```bash
# Development
npm run dev                # Start dev server with hot reload
npm run dev:instance1      # Run instance 1 (Windows PowerShell)
npm run dev:instance2      # Run instance 2 (Windows PowerShell)

# Code quality
npm run check              # Biome lint + format check
npm run fix                # Auto-fix with Biome
npm run typecheck          # TypeScript check (both node and web targets)
npm run typecheck:node     # Type check main/preload only
npm run typecheck:web      # Type check renderer only

# Build
npm run build:win          # Windows (NSIS installer)
npm run build:mac          # macOS (DMG)
npm run build:linux        # Linux (AppImage, snap, deb)
```

## Architecture

Three-process Electron architecture:

- **Main process** (`src/main/index.ts`): Window management, IPC handlers, encrypted token storage via `safeStorage`, settings persistence via `electron-store`
- **Preload** (`src/preload/index.ts`): Context bridge exposing `window.api.storage`, `window.api.settings`, `window.api.servers`
- **Renderer** (`src/renderer/`): Solid.js UI with reactive stores

### Renderer Structure

- `stores/` — Solid.js signal-based reactive state:
  - `core.tsx` — Consolidated store providing hooks: `useConnection`, `useServers`, `useSession`, `useUsers` (connection state, server switching, voice, typing, presence)
  - `messages.ts` — Message history and sending
  - `settings.ts` — User preferences
  - `theme.ts` — Theme state
  - `ui.ts` — UI state (modals, toasts)
  - `auth-flow.ts` — Authentication flow state
- `lib/` — Business logic libraries:
  - `api/` — HTTP REST client and auth endpoints
  - `auth/` — Token refresh management
  - `ws/` — WebSocket connection manager
  - `webrtc/` — WebRTC voice, audio processing, noise suppression, VAD
  - `themes/` — Theme definitions and runtime application
  - `sounds/` — Audio playback manager
  - `constants/` — UI and device constants
  - `logger/` — Dev-mode logging utility
  - `storage.ts` — Token storage helpers (IPC wrappers)
- `components/` — UI components organized by feature (Header, MessageFeed, MessageInput, Sidebar, modals, settings, shared)
- `src/shared/types.ts` — Shared type definitions (User, Server, Message, VoiceState, Theme, etc.)

### Data Flow

Components → Stores (reactive signals) → Libraries (api/ws/webrtc) → Remote Server

Tokens are stored encrypted in main process via IPC; renderer never handles raw storage. Servers are persisted in electron-store with per-server token isolation.

### TypeScript Configuration

Two separate tsconfig targets:
- `tsconfig.node.json` — Main and preload (Node.js environment)
- `tsconfig.web.json` — Renderer (browser environment, `jsxImportSource: "solid-js"`)

Path alias: `@renderer` → `src/renderer/src`

## Code Style (Biome)

- 2-space indent, 100-char line width
- Double quotes, no semicolons, no trailing commas
- Solid.js domain rules enabled
- CSS files excluded from Biome (Tailwind CSS v4 with PostCSS)
- Imports auto-organized by Biome assist
- No useless comments—code should be self-explanatory

## After Editing Code

Always run these commands after making code changes:

```bash
npm run fix        # Auto-fix lint and formatting issues
npm run typecheck  # Verify no type errors
```
