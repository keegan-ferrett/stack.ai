import Anthropic from "@anthropic-ai/sdk";
import type {
	MessageParam,
	RawMessageStreamEvent,
	Tool,
	ToolResultBlockParam,
	ToolUseBlockParam,
} from "@anthropic-ai/sdk/resources/messages.js";
import type {
	ChatRequest,
	ContentPart,
	Message,
	Provider,
	StopReason,
	StreamChunk,
	ToolDefinition,
} from "./types.ts";

export type CreateAnthropicOptions = {
	apiKey?: string;
	baseURL?: string;
};

const DEFAULT_MAX_TOKENS = 64_000;

/**
 * Build a Provider backed by `@anthropic-ai/sdk`. `apiKey` defaults to
 * `process.env.ANTHROPIC_API_KEY` (Bun loads `.env` automatically).
 */
export function createAnthropic(opts: CreateAnthropicOptions = {}): Provider {
	const client = new Anthropic({
		apiKey: opts.apiKey,
		baseURL: opts.baseURL,
	});

	return {
		async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
			const events = client.messages.stream(
				{
					model: request.model,
					max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
					system: request.system,
					messages: request.messages.map(toAnthropicMessage),
					tools: request.tools?.map(toAnthropicTool),
					thinking: { type: "adaptive" },
				},
				{ signal: request.signal },
			);
			yield* translateStream(events);
		},
	};
}

/**
 * Translate Anthropic raw stream events to provider-agnostic StreamChunks.
 * Exported separately so tests can feed mocked event sequences without
 * standing up an SDK client or network.
 */
export async function* translateStream(
	events: AsyncIterable<RawMessageStreamEvent>,
): AsyncIterable<StreamChunk> {
	const blockTypes = new Map<number, "text" | "tool_use" | "thinking">();
	const blockIds = new Map<number, string>();
	let inputTokens = 0;
	let outputTokens = 0;
	let stopReason: StopReason = "end_turn";

	for await (const event of events) {
		switch (event.type) {
			case "message_start": {
				inputTokens = event.message.usage.input_tokens;
				outputTokens = event.message.usage.output_tokens;
				break;
			}
			case "content_block_start": {
				const block = event.content_block;
				if (block.type === "text") {
					blockTypes.set(event.index, "text");
				} else if (block.type === "tool_use") {
					blockTypes.set(event.index, "tool_use");
					blockIds.set(event.index, block.id);
					yield { type: "tool_use_start", id: block.id, name: block.name };
				} else if (block.type === "thinking") {
					blockTypes.set(event.index, "thinking");
				}
				break;
			}
			case "content_block_delta": {
				const delta = event.delta;
				if (delta.type === "text_delta") {
					yield { type: "text_delta", text: delta.text };
				} else if (delta.type === "input_json_delta") {
					const id = blockIds.get(event.index);
					if (id !== undefined) {
						yield {
							type: "tool_use_input_delta",
							id,
							partialInputJson: delta.partial_json,
						};
					}
				}
				break;
			}
			case "content_block_stop": {
				if (blockTypes.get(event.index) === "tool_use") {
					const id = blockIds.get(event.index);
					if (id !== undefined) {
						yield { type: "tool_use_end", id };
					}
				}
				break;
			}
			case "message_delta": {
				outputTokens = event.usage.output_tokens;
				const native = event.delta.stop_reason;
				if (native !== null) stopReason = mapStopReason(native);
				break;
			}
			case "message_stop": {
				yield {
					type: "message_end",
					stopReason,
					usage: { inputTokens, outputTokens },
				};
				break;
			}
		}
	}
}

function mapStopReason(
	native: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | "pause_turn" | "refusal",
): StopReason {
	if (native === "pause_turn") return "end_turn";
	return native;
}

function toAnthropicMessage(message: Message): MessageParam {
	if (typeof message.content === "string") {
		return { role: message.role, content: message.content };
	}
	return {
		role: message.role,
		content: message.content.map(toAnthropicContentBlock),
	};
}

function toAnthropicContentBlock(
	part: ContentPart,
): { type: "text"; text: string } | ToolUseBlockParam | ToolResultBlockParam {
	switch (part.type) {
		case "text":
			return { type: "text", text: part.text };
		case "tool_use":
			return {
				type: "tool_use",
				id: part.id,
				name: part.name,
				input: part.input,
			};
		case "tool_result":
			return {
				type: "tool_result",
				tool_use_id: part.toolUseId,
				content: part.content,
				is_error: part.isError,
			};
	}
}

function toAnthropicTool(tool: ToolDefinition): Tool {
	return {
		name: tool.name,
		description: tool.description,
		input_schema: tool.inputSchema as Tool["input_schema"],
	};
}
