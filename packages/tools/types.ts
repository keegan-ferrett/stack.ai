/**
 * Public surface of @kstack/tools. A `Tool` is the executor + view counterpart
 * to the wire-level `ToolDefinition` in @kstack/chat: the same schema is sent
 * to the model, plus a runner the agent invokes, plus an optional view the
 * TUI renders for the resulting tool turn.
 */

import type { ReactNode } from "react";
import type { StopReason, ToolDefinition } from "@kstack/chat";

export type ToolResult = {
	content: string;
	isError?: boolean;
};

/**
 * Per-tool view rendered in the chat history. `result` is undefined while the
 * tool is still running and is populated once `execute` resolves. Returning
 * null is fine — the TUI prints the tool's name as a header above the view, so
 * a tool with nothing visual to add can opt out of the body.
 */
export type ToolView = (props: {
	input: unknown;
	result?: ToolResult;
}) => ReactNode;

/**
 * A registered tool. The wire schema (`name`, `description`, `inputSchema`) is
 * sent to the model verbatim. `execute` runs when the model selects the tool;
 * its returned `content` is what the model sees on the next turn. `view` is
 * purely a TUI presentation concern — it can be richer or sparser than the
 * wire content (e.g. show only the first 5 lines of a file the model receives
 * in full).
 */
export type Tool = ToolDefinition & {
	execute(input: unknown): Promise<ToolResult>;
	view?: ToolView;
};

/**
 * Events yielded by `runAgenticTurn`. Consumers (e.g. the TUI) react to these
 * to update history: text deltas extend the streaming assistant entry, tool
 * calls open a tool entry, tool results fill it in, and turn_end closes the
 * loop for one user turn.
 */
export type AgentEvent =
	| { type: "text_delta"; text: string }
	| { type: "tool_call"; id: string; name: string; input: unknown }
	| { type: "tool_result"; id: string; name: string; result: ToolResult }
	| { type: "turn_end"; stopReason: StopReason };
