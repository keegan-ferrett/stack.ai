/**
 * The agentic loop that ties @kstack/chat to a registry of `Tool`s. Given a
 * provider, a chat request, and the registered tools, it streams text deltas
 * to the caller and — whenever the model returns `stop_reason: tool_use` —
 * runs the matched tools, appends their results to the conversation, and
 * loops until the model is done.
 *
 * Stateless from the caller's perspective: the loop owns its own copy of the
 * message history while iterating, but never mutates the input.
 */

import type {
	ChatRequest,
	ContentPart,
	Message,
	Provider,
	StopReason,
	ToolDefinition,
	ToolResultPart,
} from "@kstack/chat";
import type { AgentEvent, Tool, ToolResult } from "./types.ts";

type AccumulatedBlock =
	| { type: "text"; text: string }
	| {
			type: "tool_use";
			id: string;
			name: string;
			jsonChunks: string[];
			input?: unknown;
	  };

/**
 * Drive one or more chat turns until the model stops requesting tools.
 *
 * @param provider The chat provider — any implementation of `@kstack/chat`'s `Provider`.
 * @param request  The chat request. The loop overrides `tools` with definitions derived from `tools` argument; any caller-supplied `tools` field is ignored.
 * @param tools    The registered tools. Each `tool_use` block from the model is dispatched here by name; unknown names yield an error result that is fed back to the model.
 */
export async function* runAgenticTurn(
	provider: Provider,
	request: ChatRequest,
	tools: readonly Tool[],
): AsyncGenerator<AgentEvent> {
	const definitions: ToolDefinition[] = tools.map(toDefinition);
	const messages: Message[] = [...request.messages];

	while (true) {
		const blocks: AccumulatedBlock[] = [];
		let stopReason: StopReason = "end_turn";

		for await (const chunk of provider.stream({
			...request,
			messages,
			tools: definitions,
		})) {
			switch (chunk.type) {
				case "text_delta": {
					const last = blocks[blocks.length - 1];
					if (last && last.type === "text") {
						last.text += chunk.text;
					} else {
						blocks.push({ type: "text", text: chunk.text });
					}
					yield { type: "text_delta", text: chunk.text };
					break;
				}
				case "tool_use_start": {
					blocks.push({
						type: "tool_use",
						id: chunk.id,
						name: chunk.name,
						jsonChunks: [],
					});
					break;
				}
				case "tool_use_input_delta": {
					const block = findToolUseById(blocks, chunk.id);
					if (block) block.jsonChunks.push(chunk.partialInputJson);
					break;
				}
				case "tool_use_end": {
					const block = findToolUseById(blocks, chunk.id);
					if (block) {
						const joined = block.jsonChunks.join("");
						block.input = joined.length > 0 ? safeParse(joined) : {};
					}
					break;
				}
				case "message_end": {
					stopReason = chunk.stopReason;
					break;
				}
			}
		}

		if (stopReason !== "tool_use") {
			yield { type: "turn_end", stopReason };
			return;
		}

		const assistantContent = blocksToContent(blocks);
		messages.push({ role: "assistant", content: assistantContent });

		const resultParts: ToolResultPart[] = [];
		for (const block of blocks) {
			if (block.type !== "tool_use") continue;
			yield {
				type: "tool_call",
				id: block.id,
				name: block.name,
				input: block.input,
			};
			const result = await runOne(tools, block.name, block.input);
			yield {
				type: "tool_result",
				id: block.id,
				name: block.name,
				result,
			};
			resultParts.push({
				type: "tool_result",
				toolUseId: block.id,
				content: result.content,
				isError: result.isError,
			});
		}

		messages.push({ role: "user", content: resultParts });
	}
}

function findToolUseById(
	blocks: AccumulatedBlock[],
	id: string,
): Extract<AccumulatedBlock, { type: "tool_use" }> | undefined {
	for (const block of blocks) {
		if (block.type === "tool_use" && block.id === id) return block;
	}
	return undefined;
}

function safeParse(json: string): unknown {
	try {
		return JSON.parse(json);
	} catch {
		return {};
	}
}

function toDefinition(tool: Tool): ToolDefinition {
	return {
		name: tool.name,
		description: tool.description,
		inputSchema: tool.inputSchema,
	};
}

function blocksToContent(blocks: AccumulatedBlock[]): ContentPart[] {
	const parts: ContentPart[] = [];
	for (const block of blocks) {
		if (block.type === "text") {
			if (block.text.length > 0) parts.push({ type: "text", text: block.text });
		} else {
			parts.push({
				type: "tool_use",
				id: block.id,
				name: block.name,
				input: block.input,
			});
		}
	}
	return parts;
}

async function runOne(
	tools: readonly Tool[],
	name: string,
	input: unknown,
): Promise<ToolResult> {
	const tool = tools.find((t) => t.name === name);
	if (!tool) {
		return { content: `Unknown tool: ${name}`, isError: true };
	}
	try {
		return await tool.execute(input);
	} catch (error) {
		return {
			content: error instanceof Error ? error.message : String(error),
			isError: true,
		};
	}
}
