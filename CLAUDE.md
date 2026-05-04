# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Runtime: Bun, not Node

This project targets the Bun runtime. Default to Bun's built-ins and tooling instead of the Node/npm ecosystem equivalents:

- Install deps: `bun install` from the repo root (never `npm`/`pnpm`/`yarn`). The root is a Bun workspace, so a single install hydrates every package under `packages/*`.
- Run the TUI: `bun run packages/tui/index.tsx`, or `bun --filter '@kstack/tui' start` from the root. Bun executes `.ts`/`.tsx` directly, no separate compile/transpile step. The app uses Ink's alternate-screen mode, so it takes over the terminal until ctrl+c — note that `bun --filter` does not forward a TTY to children, so prefer the direct `bun run packages/tui/index.tsx` form for actually using the UI.
- Run tests: `bun test` (or `bun test path/to/file.test.ts` for a single file, `-t "name"` to filter by test name). Use `bun:test` (`import { test, expect } from "bun:test"`) rather than Jest/Vitest.
- Bundle: `bun build` instead of Vite/webpack/esbuild.
- Scripts: `bun run <script>` for the current package's `package.json` scripts; `bun --filter '<pkg>' <script>` to run a script in a specific workspace from the root.
- Prefer Bun APIs over Node equivalents where they exist: `Bun.file()` / `Bun.write()` over `fs`, `Bun.serve()` over Express/`http`, `Bun.$` for shell, `bun:sqlite` over `better-sqlite3`. `process.env` is fine — Bun loads `.env` automatically (no `dotenv`).

## TypeScript config notes

`tsconfig.json` is Bun's bundler-mode preset: `noEmit` + `moduleResolution: bundler` + `allowImportingTsExtensions` + `verbatimModuleSyntax`. Concrete consequences when editing code:

- Imports between local files must include the `.ts` extension (e.g. `import { x } from "./foo.ts"`).
- `verbatimModuleSyntax` means type-only imports must be written as `import type { ... }` — a plain `import` of a type-only symbol will fail.
- `noUncheckedIndexedAccess` is on, so indexed access (`arr[i]`, `obj[key]`) yields `T | undefined` and must be narrowed.
- `tsc` is for type-checking only (`bunx tsc --noEmit`); Bun does the actual running/bundling.
- `jsx: react-jsx` is set, so `.tsx` files don't need `import React` for JSX — but hooks (`useState`, `useRef`, etc.) still import from `react` explicitly.

## Project shape

Bun workspace monorepo. The root `package.json` declares `"workspaces": ["packages/*"]` and holds only dev tooling (`@types/bun`, `typescript`); all runtime deps live in their owning package.

Current packages:

- `packages/tui` (`@kstack/tui`) — Ink + React TUI, single-entry at `packages/tui/index.tsx`. A chat client: streams responses from `@kstack/chat` and renders user/assistant turns. Built on Ink primitives (`Box`, `Text`, `useInput`, `useApp`, `useWindowSize`, `useBoxMetrics`, `usePaste`). `HistoryView` scrolls in *visual-line units* (after wrapping on the box's measured width via `useBoxMetrics`) — entry-unit slicing breaks once assistant turns wrap across lines, so any future scroll/layout work must keep the wrap-then-slice ordering. Requires `ANTHROPIC_API_KEY` in the environment at startup; absent, it renders an error banner instead of crashing. Slash commands: input lines starting with `/` are intercepted by `commands.ts` and dispatched against a registry composed inside `App` at render time. The public `Command` type takes a narrow `CommandHost` (currently just `print`) so commands defined in other packages stay decoupled from TUI internals. Host-internal commands (`/clear`, `/exit`, `/help`) are constructed inside `App` and close over `setEntries`/`exit` directly — they do not flow through `CommandHost`. To register cross-package commands, export a `Command` from another workspace and pass them via the `externalCommands` prop on `<App />`. System-role entries are UI-only and are filtered out before any history is sent to the model.
- `packages/chat` (`@kstack/chat`) — Provider-agnostic AI chat. Public surface is a `Provider` interface with one method (`stream(request) → AsyncIterable<StreamChunk>`) plus the message/tool/chunk types in `types.ts` — no vendor types leak through. Stateless: callers pass the full message history per request. Currently ships one factory, `createAnthropic({apiKey?, baseURL?})`, against `@anthropic-ai/sdk`. The Anthropic→`StreamChunk` translator is exported separately as `translateStream` so `anthropic.test.ts` can feed it mocked event sequences without touching the SDK or network. Adding a second provider means writing another `create*()` factory that conforms to `Provider`; consumers don't change.

When adding a new package, drop it under `packages/<name>/`, give it a `package.json` with `"name": "@kstack/<name>"` and `"private": true`, and a `tsconfig.json` that extends `../../tsconfig.json`. Cross-package deps use `"workspace:*"` (e.g. `"@kstack/tui": "workspace:*"`). To add a third-party dep into a specific workspace, run `bun add <pkg> --cwd packages/<name>` from the repo root — `--filter` is for `bun run`, not `bun add` (it tries to fetch the workspace name from the registry and 404s). Within an existing package, treat code as additions to that package's flat layout until structure emerges; don't preemptively scaffold `src/`, `tests/`, build configs, or lint setup unless asked.

When building Ink UIs, terminal layout is Flexbox via Yoga — `Box` is the layout primitive, `Text` is the only thing that renders strings, and you cannot put bare strings inside a `Box` (they must be wrapped in `<Text>`). Input is event-driven through `useInput` rather than DOM events.

## Ink reference

`docs/ink.md` is a vendored copy of the Ink README — consult it for component props, hooks, and layout semantics before guessing API shapes. It documents the upcoming version of Ink (matches the `^7.0.1` dep), so prefer it over older Ink tutorials found online.
