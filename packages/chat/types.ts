/**
 * Provider-agnostic chat types. No vendor SDK types leak through this surface,
 * so consumers depend only on @kstack/chat — switching providers requires no
 * caller changes.
 */

export type Role = "user" | "assistant";

export type TextPart = { type: "text"; text: string };

export type ToolUsePart = {
	type: "tool_use";
	id: string;
	name: string;
	input: unknown;
};

export type ToolResultPart = {
	type: "tool_result";
	toolUseId: string;
	content: string;
	isError?: boolean;
};

export type ContentPart = TextPart | ToolUsePart | ToolResultPart;

export type Message = {
	role: Role;
	content: string | ContentPart[];
};

export type ToolDefinition = {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
};

export type Usage = {
	inputTokens: number;
	outputTokens: number;
};

export type StopReason =
	| "end_turn"
	| "tool_use"
	| "max_tokens"
	| "stop_sequence"
	| "refusal";

export type StreamChunk =
	| { type: "text_delta"; text: string }
	| { type: "tool_use_start"; id: string; name: string }
	| { type: "tool_use_input_delta"; id: string; partialInputJson: string }
	| { type: "tool_use_end"; id: string }
	| { type: "message_end"; stopReason: StopReason; usage: Usage };

export type ChatRequest = {
	model: string;
	messages: Message[];
	system?: string;
	tools?: ToolDefinition[];
	maxTokens?: number;
	signal?: AbortSignal;
};

/**
 * The single seam every provider implements. New providers (OpenAI, Google,
 * etc.) ship as additional `create*()` factories that return a Provider.
 */
export interface Provider {
	stream(request: ChatRequest): AsyncIterable<StreamChunk>;
}
