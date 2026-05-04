# @kstack/tui

Ink + React TUI. Single entry at `packages/tui/index.tsx`. A chat client: streams responses from `@kstack/chat` and renders user/assistant turns.

## Running

`bun run packages/tui/index.tsx` from the repo root. The app uses Ink's alternate-screen mode and takes over the terminal until ctrl+c. Avoid `bun --filter '@kstack/tui' start` for actually using the UI — `bun --filter` does not forward a TTY to children.

Requires `ANTHROPIC_API_KEY` in the environment at startup; absent, the app renders an error banner instead of crashing.

## Ink layout rules

Terminal layout is Flexbox via Yoga.

- `Box` is the only layout primitive; `Text` is the only thing that renders strings.
- You cannot put bare strings inside a `Box` — wrap them in `<Text>`.
- Input is event-driven through `useInput`, not DOM events.
- Ink primitives in use: `Box`, `Text`, `useInput`, `useApp`, `useWindowSize`, `useBoxMetrics`, `usePaste`.

`docs/ink.md` (at the repo root) is a vendored copy of the Ink README — consult it for component props, hooks, and layout semantics before guessing API shapes. It documents the upcoming version of Ink (matches the `^7.0.1` dep), so prefer it over older Ink tutorials found online.

## HistoryView scrolling: wrap-then-slice

`HistoryView` scrolls in **visual-line units**, not entry units. Lines are wrapped on the box's measured width (via `useBoxMetrics`) *before* slicing for the viewport. Entry-unit slicing breaks once assistant turns wrap across lines, so any future scroll/layout work must keep the wrap-then-slice ordering.

## Slash commands

Input lines starting with `/` are intercepted by `commands.ts` and dispatched against a registry composed inside `App` at render time.

- The public `Command` type takes a narrow `CommandHost` so commands defined in other packages stay decoupled from TUI internals. Each capability on `CommandHost` is its own method — extend only when a clearly broad need emerges.
- Host-internal commands (`/clear`, `/exit`, `/help`, `/cat-art`) are constructed inside `App` and close over local state setters directly — they do not flow through `CommandHost`. External commands receive the host argument.
- To register cross-package commands, export a `Command` from another workspace and pass them via the `externalCommands` prop on `<App />`.

`CommandHost` capabilities:

- `print(text, opts?)` — append a system-role line to chat history. UI-only; system entries are filtered out before any history is sent to the model. Use this for commands that should leave a visible trace (e.g. `/cat`).
- `openView(render)` — swap a custom view into the input bar's slot at the bottom of the screen, leaving chat history visible above. `render` is a fn `(close) => ReactElement`; the view may call `close()` to dismiss itself (e.g. a picker on selection). The host also wires Esc to dismiss and renders the dismissal hint. The view does **not** modify chat context — use this for transient UI like pickers, settings panels, or `/cat-art`.

## System prompt

`SYSTEM.md` next to `index.tsx` is loaded once at startup and passed as `system` on every `provider.stream` call. Missing or empty file ⇒ no system prompt sent.

The loader (`system-prompt.ts`) expands `@path/to/file.md` include directives — any line whose only content is `@<path>` is replaced by the contents of that file, with paths resolved relative to the file containing the directive. Includes are transitive; cycles and missing targets throw at startup. Mid-line `@mentions` are left alone.
