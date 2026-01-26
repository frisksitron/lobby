# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lobby is a self-hosted Discord-like communication platform with a desktop client and server.

**Simplified channel model:** Each server has exactly one text channel and one voice channel. No channel management or selection required.

## Shell Environment

Windows with Git Bash. Use POSIX-style paths in shell commands (e.g. `/c/` prefix instead of `C:\`).

## Component Documentation

- [Desktop Client (Electron + Solid.js)](src-client-desktop/CLAUDE.md)
- [Server (Go)](src-server/CLAUDE.md)
