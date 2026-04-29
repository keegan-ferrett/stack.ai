# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Runtime: Bun, not Node

This project targets the Bun runtime. Default to Bun's built-ins and tooling instead of the Node/npm ecosystem equivalents:

- Install deps: `bun install` (never `npm`/`pnpm`/`yarn`).
- Run the app: `bun run index.ts` (or `bun index.ts`) — Bun executes `.ts`/`.tsx` directly, no separate compile/transpile step.
- Run tests: `bun test` (or `bun test path/to/file.test.ts` for a single file, `-t "name"` to filter by test name). Use `bun:test` (`import { test, expect } from "bun:test"`) rather than Jest/Vitest.
- Bundle: `bun build` instead of Vite/webpack/esbuild.
- Scripts: `bun run <script>` for `package.json` scripts.
- Prefer Bun APIs over Node equivalents where they exist: `Bun.file()` / `Bun.write()` over `fs`, `Bun.serve()` over Express/`http`, `Bun.$` for shell, `bun:sqlite` over `better-sqlite3`. `process.env` is fine — Bun loads `.env` automatically (no `dotenv`).

The `.cursor/rules/use-bun-instead-of-node-vite-npm-pnpm.mdc` file is a symlink to this `CLAUDE.md`, so the same guidance applies in Cursor.

## TypeScript config notes

`tsconfig.json` is Bun's bundler-mode preset: `noEmit` + `moduleResolution: bundler` + `allowImportingTsExtensions` + `verbatimModuleSyntax`. Concrete consequences when editing code:

- Imports between local files must include the `.ts` extension (e.g. `import { x } from "./foo.ts"`).
- `verbatimModuleSyntax` means type-only imports must be written as `import type { ... }` — a plain `import` of a type-only symbol will fail.
- `noUncheckedIndexedAccess` is on, so indexed access (`arr[i]`, `obj[key]`) yields `T | undefined` and must be narrowed.
- `tsc` is for type-checking only (`bunx tsc --noEmit`); Bun does the actual running/bundling.

## Project shape

Single-entry Bun starter — `index.ts` at the root, no `src/` layout, no framework. Treat new code as additions to a flat module layout until structure emerges; don't preemptively scaffold `src/`, `tests/`, build configs, or lint setup unless asked.
