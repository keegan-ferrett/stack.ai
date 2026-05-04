# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Runtime: Bun, not Node

This project targets the Bun runtime. Default to Bun's built-ins and tooling instead of the Node/npm ecosystem equivalents:

- Install deps: `bun install` from the repo root (never `npm`/`pnpm`/`yarn`). The root is a Bun workspace, so a single install hydrates every package under `packages/*`.
- Run tests: `bun test` (or `bun test path/to/file.test.ts` for a single file, `-t "name"` to filter by test name). Use `bun:test` (`import { test, expect } from "bun:test"`) rather than Jest/Vitest.
- Bundle: `bun build` instead of Vite/webpack/esbuild. Bun executes `.ts`/`.tsx` directly, no separate compile/transpile step.
- Scripts: `bun run <script>` for the current package's `package.json` scripts; `bun --filter '<pkg>' <script>` to run a script in a specific workspace from the root.
- Prefer Bun APIs over Node equivalents where they exist: `Bun.file()` / `Bun.write()` over `fs`, `Bun.serve()` over Express/`http`, `Bun.$` for shell, `bun:sqlite` over `better-sqlite3`. `process.env` is fine — Bun loads `.env` automatically (no `dotenv`).

## TypeScript config notes

`tsconfig.json` is Bun's bundler-mode preset: `noEmit` + `moduleResolution: bundler` + `allowImportingTsExtensions` + `verbatimModuleSyntax`. Concrete consequences when editing code:

- Imports between local files must include the `.ts` extension (e.g. `import { x } from "./foo.ts"`).
- `verbatimModuleSyntax` means type-only imports must be written as `import type { ... }` — a plain `import` of a type-only symbol will fail.
- `noUncheckedIndexedAccess` is on, so indexed access (`arr[i]`, `obj[key]`) yields `T | undefined` and must be narrowed.
- `tsc` is for type-checking only (`bunx tsc --noEmit`); Bun does the actual running/bundling.
- `jsx: react-jsx` is set, so `.tsx` files don't need `import React` for JSX — but hooks (`useState`, `useRef`, etc.) still import from `react` explicitly.

## Packages

Bun workspace monorepo. The root `package.json` declares `"workspaces": ["packages/*"]` and holds only dev tooling (`@types/bun`, `typescript`); all runtime deps live in their owning package. Each package has its own `CLAUDE.md` with the details that matter when working inside it.

- **`packages/tui`** (`@kstack/tui`) — Ink + React terminal chat client. Streams from `@kstack/chat`, dispatches slash commands, renders the conversation. See `packages/tui/CLAUDE.md`.
- **`packages/chat`** (`@kstack/chat`) — Provider-agnostic AI chat library. Stateless `Provider` interface plus an Anthropic implementation; vendor SDKs stay behind the boundary. See `packages/chat/CLAUDE.md`.

## Adding a new package

Drop it under `packages/<name>/`, give it a `package.json` with `"name": "@kstack/<name>"` and `"private": true`, and a `tsconfig.json` that extends `../../tsconfig.json`. Cross-package deps use `"workspace:*"` (e.g. `"@kstack/tui": "workspace:*"`).

To add a third-party dep into a specific workspace, run `bun add <pkg> --cwd packages/<name>` from the repo root — `--filter` is for `bun run`, not `bun add` (it tries to fetch the workspace name from the registry and 404s).

Within an existing package, treat code as additions to that package's flat layout until structure emerges; don't preemptively scaffold `src/`, `tests/`, build configs, or lint setup unless asked.
