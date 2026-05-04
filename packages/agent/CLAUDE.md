# @kstack/agent

Drives the agentic loop on top of `@kstack/chat`. Owns the `Tool` registry type, the `runAgenticTurn` loop, the per-tool view contract, and the built-in tools (`coreTools`). The wire-protocol layer (`Provider`, `StreamChunk`, `ToolDefinition`, `ToolUsePart`, `ToolResultPart`) lives in `@kstack/chat` and stays free of agent concerns.

## Public surface

- `runAgenticTurn(provider, request, tools) → AsyncGenerator<AgentEvent>` — the loop driver. Streams `text_delta` events from the provider, accumulates `tool_use_*` chunks per id, dispatches matched tools when the model stops with `tool_use`, appends results to a private message history, and re-calls until the model finishes.
- `Tool`, `ToolView`, `ToolResult`, `AgentEvent` types in `types.ts`.
- `coreTools` — built-in `Tool[]` shipped with the package. Consumers compose `[...coreTools, ...externalTools]` at registry construction time. Built-ins:
  - `current_time` — returns the current date/time in ISO 8601 format.
  - `read_file` — reads a text file (`text/*` mimetype) at a relative path and returns its full body to the model.
  - `write_file` — writes a text file at a relative path, creating any missing parent directories. Overwrites existing files.
  - `tree` — lists files and directories under a target directory as an indented tree (each line tagged `[dir]` or `[file]`); respects the target's root `.gitignore`/`.ignore` and always elides `.git`. Optional `target_directory` (defaults to cwd) and `depth` (defaults to 3).

## Tool = executor + view

A `Tool` extends the wire-level `ToolDefinition` with two siblings: `execute(input)` and an optional `view({input, result?})`. **They serve different audiences and may diverge.**

- `execute` returns a `ToolResult` whose `content` is what the **model** sees on the next turn — it should carry the full information the model needs to act (e.g. the entire file body for a `read_file` tool).
- `view` returns a `ReactNode` for the **TUI** to render inline in chat history. It can be richer (stylised, multi-element) or sparser (only the first 5 lines of that file) than `result.content`. Never collapse them into a single field.

The host (TUI) renders the tool's name as a header above the view, so individual tools never reprint their own identity. A tool with no presentation needs can omit `view` entirely; the host falls back to a plain text rendering of `result.content`.

`ToolHost` is intentionally absent — `execute(input)` receives only the model's input, no host capabilities. Same philosophy as `CommandHost` in the TUI: keep extension surfaces narrow until a need is broadly demonstrated. If a future tool genuinely needs progress reporting or user prompts, add a narrow host argument then.

## Loop semantics

- **Stateless from the caller's perspective.** The loop owns its own copy of `request.messages` while iterating; the caller's array is never mutated.
- **`tools` arg overrides `request.tools`.** Pass executors here; any wire-level `ToolDefinition[]` on the request is ignored — bare definitions wouldn't have an executor anyway.
- **Errors are data, not exceptions.** Unknown tool names and executor throws are caught and surfaced as `ToolResult { isError: true, content: "<message>" }`. The result is fed back to the model so it can recover. The loop itself only throws on provider/network failures, which propagate to the caller.
- **Assistant message reconstruction.** Between turns, the loop reconstructs the assistant message from accumulated text and `tool_use` blocks (in stream order) and appends it before the user's `tool_result` parts, so the model sees a faithful conversation on subsequent calls.

## Test seam

`agent.test.ts` drives the loop against a scripted mock `Provider` whose `stream` yields a hand-rolled `StreamChunk[]` — same pattern as `chat/anthropic.test.ts`. Keep this seam intact when modifying the loop: tests cover no-tool turns, single round-trips, multi-call turns, unknown names, executor throws, and interleaved text+tool_use.

## React/Ink dep

Because `ToolView` returns `ReactNode` and `core.tsx` uses Ink primitives, this package depends on `react` and `ink`. That's intentional — the agent owns the view contract. Don't try to keep the package "logic-only" by pushing views back into the TUI; cross-package plug-in tools need to ship their own views from wherever they're defined.
