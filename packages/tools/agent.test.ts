import { expect, test } from "bun:test";
import type {
	ChatRequest,
	Message,
	Provider,
	StreamChunk,
} from "@kstack/chat";
import { runAgenticTurn } from "./agent.ts";
import type { AgentEvent, Tool } from "./types.ts";

type RecordedRequest = {
	messages: Message[];
	tools: ChatRequest["tools"];
};

function scriptedProvider(scripts: StreamChunk[][]): {
	provider: Provider;
	calls: RecordedRequest[];
} {
	let i = 0;
	const calls: RecordedRequest[] = [];
	const provider: Provider = {
		stream(request) {
			const script = scripts[i++];
			calls.push({ messages: request.messages, tools: request.tools });
			if (!script) {
				throw new Error(
					`provider.stream called ${i} times but only ${scripts.length} scripts were provided`,
				);
			}
			return (async function* () {
				for (const chunk of script) yield chunk;
			})();
		},
	};
	return { provider, calls };
}

async function collect(
	gen: AsyncGenerator<AgentEvent>,
): Promise<AgentEvent[]> {
	const out: AgentEvent[] = [];
	for await (const event of gen) out.push(event);
	return out;
}

const usage = { inputTokens: 1, outputTokens: 1 };

const baseRequest: ChatRequest = {
	model: "test-model",
	messages: [{ role: "user", content: "hi" }],
};

test("single turn with no tool use → text deltas + turn_end", async () => {
	const { provider, calls } = scriptedProvider([
		[
			{ type: "text_delta", text: "Hello" },
			{ type: "text_delta", text: " world" },
			{ type: "message_end", stopReason: "end_turn", usage },
		],
	]);

	const events = await collect(runAgenticTurn(provider, baseRequest, []));

	expect(events).toEqual([
		{ type: "text_delta", text: "Hello" },
		{ type: "text_delta", text: " world" },
		{ type: "turn_end", stopReason: "end_turn" },
	]);
	expect(calls).toHaveLength(1);
	expect(calls[0]?.tools).toEqual([]);
});

test("one tool round-trip → tool_call, tool_result, text, turn_end", async () => {
	const echo: Tool = {
		name: "echo",
		description: "Echoes its input",
		inputSchema: { type: "object", properties: { msg: { type: "string" } } },
		async execute(input) {
			const { msg } = input as { msg: string };
			return { content: msg };
		},
	};

	const { provider, calls } = scriptedProvider([
		[
			{ type: "tool_use_start", id: "tu_1", name: "echo" },
			{
				type: "tool_use_input_delta",
				id: "tu_1",
				partialInputJson: '{"msg":',
			},
			{
				type: "tool_use_input_delta",
				id: "tu_1",
				partialInputJson: '"hi"}',
			},
			{ type: "tool_use_end", id: "tu_1" },
			{ type: "message_end", stopReason: "tool_use", usage },
		],
		[
			{ type: "text_delta", text: "done" },
			{ type: "message_end", stopReason: "end_turn", usage },
		],
	]);

	const events = await collect(runAgenticTurn(provider, baseRequest, [echo]));

	expect(events).toEqual([
		{ type: "tool_call", id: "tu_1", name: "echo", input: { msg: "hi" } },
		{
			type: "tool_result",
			id: "tu_1",
			name: "echo",
			result: { content: "hi" },
		},
		{ type: "text_delta", text: "done" },
		{ type: "turn_end", stopReason: "end_turn" },
	]);

	// Second call should include the assistant's tool_use turn and the user's tool_result turn.
	expect(calls).toHaveLength(2);
	expect(calls[1]?.messages).toEqual([
		{ role: "user", content: "hi" },
		{
			role: "assistant",
			content: [
				{ type: "tool_use", id: "tu_1", name: "echo", input: { msg: "hi" } },
			],
		},
		{
			role: "user",
			content: [
				{
					type: "tool_result",
					toolUseId: "tu_1",
					content: "hi",
					isError: undefined,
				},
			],
		},
	]);
	expect(calls[1]?.tools).toEqual([
		{
			name: "echo",
			description: "Echoes its input",
			inputSchema: { type: "object", properties: { msg: { type: "string" } } },
		},
	]);
});

test("two tool calls in one assistant turn → both run in order", async () => {
	const order: string[] = [];
	const a: Tool = {
		name: "a",
		description: "",
		inputSchema: { type: "object", properties: {} },
		async execute() {
			order.push("a");
			return { content: "A" };
		},
	};
	const b: Tool = {
		name: "b",
		description: "",
		inputSchema: { type: "object", properties: {} },
		async execute() {
			order.push("b");
			return { content: "B" };
		},
	};

	const { provider } = scriptedProvider([
		[
			{ type: "tool_use_start", id: "tu_a", name: "a" },
			{ type: "tool_use_end", id: "tu_a" },
			{ type: "tool_use_start", id: "tu_b", name: "b" },
			{ type: "tool_use_end", id: "tu_b" },
			{ type: "message_end", stopReason: "tool_use", usage },
		],
		[
			{ type: "text_delta", text: "ok" },
			{ type: "message_end", stopReason: "end_turn", usage },
		],
	]);

	const events = await collect(runAgenticTurn(provider, baseRequest, [a, b]));

	expect(order).toEqual(["a", "b"]);
	expect(events.map((e) => e.type)).toEqual([
		"tool_call",
		"tool_result",
		"tool_call",
		"tool_result",
		"text_delta",
		"turn_end",
	]);
});

test("unknown tool name → error result fed back, loop continues", async () => {
	const { provider, calls } = scriptedProvider([
		[
			{ type: "tool_use_start", id: "tu_x", name: "missing" },
			{ type: "tool_use_end", id: "tu_x" },
			{ type: "message_end", stopReason: "tool_use", usage },
		],
		[
			{ type: "text_delta", text: "ok" },
			{ type: "message_end", stopReason: "end_turn", usage },
		],
	]);

	const events = await collect(runAgenticTurn(provider, baseRequest, []));

	expect(events).toEqual([
		{ type: "tool_call", id: "tu_x", name: "missing", input: {} },
		{
			type: "tool_result",
			id: "tu_x",
			name: "missing",
			result: { content: "Unknown tool: missing", isError: true },
		},
		{ type: "text_delta", text: "ok" },
		{ type: "turn_end", stopReason: "end_turn" },
	]);
	expect(calls).toHaveLength(2);
});

test("executor throws → error captured, loop continues", async () => {
	const boom: Tool = {
		name: "boom",
		description: "",
		inputSchema: { type: "object", properties: {} },
		async execute() {
			throw new Error("kaboom");
		},
	};

	const { provider } = scriptedProvider([
		[
			{ type: "tool_use_start", id: "tu_b", name: "boom" },
			{ type: "tool_use_end", id: "tu_b" },
			{ type: "message_end", stopReason: "tool_use", usage },
		],
		[
			{ type: "text_delta", text: "recovered" },
			{ type: "message_end", stopReason: "end_turn", usage },
		],
	]);

	const events = await collect(runAgenticTurn(provider, baseRequest, [boom]));

	expect(events).toEqual([
		{ type: "tool_call", id: "tu_b", name: "boom", input: {} },
		{
			type: "tool_result",
			id: "tu_b",
			name: "boom",
			result: { content: "kaboom", isError: true },
		},
		{ type: "text_delta", text: "recovered" },
		{ type: "turn_end", stopReason: "end_turn" },
	]);
});

test("text + tool_use in same turn → both flushed into assistant message", async () => {
	const echo: Tool = {
		name: "echo",
		description: "",
		inputSchema: { type: "object", properties: {} },
		async execute() {
			return { content: "ok" };
		},
	};

	const { provider, calls } = scriptedProvider([
		[
			{ type: "text_delta", text: "Let me check..." },
			{ type: "tool_use_start", id: "tu_1", name: "echo" },
			{ type: "tool_use_end", id: "tu_1" },
			{ type: "message_end", stopReason: "tool_use", usage },
		],
		[
			{ type: "text_delta", text: "answer" },
			{ type: "message_end", stopReason: "end_turn", usage },
		],
	]);

	await collect(runAgenticTurn(provider, baseRequest, [echo]));

	expect(calls[1]?.messages[1]).toEqual({
		role: "assistant",
		content: [
			{ type: "text", text: "Let me check..." },
			{ type: "tool_use", id: "tu_1", name: "echo", input: {} },
		],
	});
});
