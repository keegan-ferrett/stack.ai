import type { ReactElement } from "react";

/**
 * Render fn for an overlay opened via `CommandHost.openView`. The view
 * receives a `close` callback it may call to dismiss itself when its task
 * completes (e.g. a picker closing on selection). The host also closes the
 * overlay on Esc, so views don't need to handle dismissal themselves unless
 * they want a programmatic exit point.
 */
export type OverlayRender = (close: () => void) => ReactElement;

/**
 * The narrow surface a command sees when it runs. Kept deliberately small so
 * commands shipped from other packages depend on as little of the TUI as
 * possible. Each capability is its own method rather than a single bag of
 * helpers — extend only when a clearly broad need emerges.
 *
 * - `print` adds a system-role line to chat history (visible to the user,
 *   excluded from messages sent to the model).
 * - `openView` swaps a custom React view into the input bar's slot at the
 *   bottom of the screen — history stays visible above. Esc dismisses the
 *   overlay; the view may also call its `close` arg to dismiss itself. Use
 *   this for command UI that should not pollute the agent's context
 *   (e.g. pickers, transient art, settings panels).
 */
export type CommandHost = {
	print(text: string, opts?: { isError?: boolean }): void;
	openView(render: OverlayRender): void;
};

/**
 * A slash command. `run` receives the raw argument string (everything after
 * the command name and the first space) and the host. It is intentionally not
 * given any TUI internals — host-internal commands like /clear close over
 * their dependencies where they are constructed instead.
 */
export type Command = {
	name: string;
	description: string;
	run(args: string, host: CommandHost): void | Promise<void>;
};

export type ParseResult =
	| { kind: "command"; command: Command; args: string }
	| { kind: "unknown"; name: string }
	| { kind: "not_command" };

/**
 * Resolve a submitted input line against a command registry. The registry is
 * passed in (rather than module-level) so callers compose host-internal and
 * externally-supplied commands at the call site.
 */
export function parseCommand(
	input: string,
	registry: readonly Command[],
): ParseResult {
	if (!input.startsWith("/")) return { kind: "not_command" };
	const space = input.indexOf(" ");
	const name = (space === -1 ? input.slice(1) : input.slice(1, space)).trim();
	const args = space === -1 ? "" : input.slice(space + 1);
	const command = registry.find((c) => c.name === name);
	return command
		? { kind: "command", command, args }
		: { kind: "unknown", name };
}
