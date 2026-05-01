import { expect, test } from "bun:test";
import type { RawMessageStreamEvent } from "@anthropic-ai/sdk/resources/messages.js";
import { translateStream } from "./anthropic.ts";
import type { StreamChunk } from "./types.ts";

async function collect(
	events: RawMessageStreamEvent[],
): Promise<StreamChunk[]> {
	async function* asAsync(): AsyncIterable<RawMessageStreamEvent> {
		for (const event of events) yield event;
	}
	const out: StreamChunk[] = [];
	for await (const chunk of translateStream(asAsync())) out.push(chunk);
	return out;
}

const messageStart = (
	inputTokens = 10,
	outputTokens = 0,
): RawMessageStreamEvent =>
	({
		type: "message_start",
		message: {
			id: "msg_1",
			role: "assistant",
			type: "message",
			model: "claude-opus-4-7",
			content: [],
			stop_reason: null,
			stop_sequence: null,
			usage: {
				input_tokens: inputTokens,
				output_tokens: outputTokens,
				cache_creation_input_tokens: 0,
				cache_read_input_tokens: 0,
				server_tool_use: null,
				service_tier: "standard",
			},
			container: null,
		},
	}) as unknown as RawMessageStreamEvent;

const messageDelta = (
	stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "pause_turn" | "refusal",
	outputTokens: number,
): RawMessageStreamEvent =>
	({
		type: "message_delta",
		delta: {
			stop_reason: stopReason,
			stop_sequence: null,
			container: null,
			stop_details: null,
		},
		usage: { output_tokens: outputTokens, input_tokens: null },
	}) as unknown as RawMessageStreamEvent;

const messageStop: RawMessageStreamEvent = { type: "message_stop" };

test("plain text response → text_delta + message_end{end_turn}", async () => {
	const chunks = await collect([
		messageStart(12),
		{
			type: "content_block_start",
			index: 0,
			content_block: { type: "text", text: "", citations: null },
		} as unknown as RawMessageStreamEvent,
		{
			type: "content_block_delta",
			index: 0,
			delta: { type: "text_delta", text: "Hello" },
		} as unknown as RawMessageStreamEvent,
		{
			type: "content_block_delta",
			index: 0,
			delta: { type: "text_delta", text: " world" },
		} as unknown as RawMessageStreamEvent,
		{ type: "content_block_stop", index: 0 } as RawMessageStreamEvent,
		messageDelta("end_turn", 4),
		messageStop,
	]);

	expect(chunks).toEqual([
		{ type: "text_delta", text: "Hello" },
		{ type: "text_delta", text: " world" },
		{
			type: "message_end",
			stopReason: "end_turn",
			usage: { inputTokens: 12, outputTokens: 4 },
		},
	]);
});

test("tool_use block → start, input_delta, end, message_end{tool_use}", async () => {
	const chunks = await collect([
		messageStart(20),
		{
			type: "content_block_start",
			index: 0,
			content_block: {
				type: "tool_use",
				id: "toolu_a",
				name: "get_weather",
				input: {},
			},
		} as unknown as RawMessageStreamEvent,
		{
			type: "content_block_delta",
			index: 0,
			delta: { type: "input_json_delta", partial_json: '{"city":' },
		} as unknown as RawMessageStreamEvent,
		{
			type: "content_block_delta",
			index: 0,
			delta: { type: "input_json_delta", partial_json: '"Paris"}' },
		} as unknown as RawMessageStreamEvent,
		{ type: "content_block_stop", index: 0 } as RawMessageStreamEvent,
		messageDelta("tool_use", 18),
		messageStop,
	]);

	expect(chunks).toEqual([
		{ type: "tool_use_start", id: "toolu_a", name: "get_weather" },
		{
			type: "tool_use_input_delta",
			id: "toolu_a",
			partialInputJson: '{"city":',
		},
		{
			type: "tool_use_input_delta",
			id: "toolu_a",
			partialInputJson: '"Paris"}',
		},
		{ type: "tool_use_end", id: "toolu_a" },
		{
			type: "message_end",
			stopReason: "tool_use",
			usage: { inputTokens: 20, outputTokens: 18 },
		},
	]);
});

test("interleaved text + tool_use blocks preserve order and per-block ids", async () => {
	const chunks = await collect([
		messageStart(5),
		{
			type: "content_block_start",
			index: 0,
			content_block: { type: "text", text: "" },
		} as unknown as RawMessageStreamEvent,
		{
			type: "content_block_delta",
			index: 0,
			delta: { type: "text_delta", text: "thinking..." },
		} as unknown as RawMessageStreamEvent,
		{ type: "content_block_stop", index: 0 } as RawMessageStreamEvent,
		{
			type: "content_block_start",
			index: 1,
			content_block: { type: "tool_use", id: "toolu_b", name: "lookup", input: {} },
		} as unknown as RawMessageStreamEvent,
		{ type: "content_block_stop", index: 1 } as RawMessageStreamEvent,
		messageDelta("tool_use", 9),
		messageStop,
	]);

	expect(chunks.map((c) => c.type)).toEqual([
		"text_delta",
		"tool_use_start",
		"tool_use_end",
		"message_end",
	]);
	expect(chunks[1]).toMatchObject({ id: "toolu_b" });
	expect(chunks[2]).toMatchObject({ id: "toolu_b" });
});

test("thinking blocks are dropped silently", async () => {
	const chunks = await collect([
		messageStart(7),
		{
			type: "content_block_start",
			index: 0,
			content_block: { type: "thinking", thinking: "", signature: "" },
		} as unknown as RawMessageStreamEvent,
		{
			type: "content_block_delta",
			index: 0,
			delta: { type: "thinking_delta", thinking: "secret reasoning" },
		} as unknown as RawMessageStreamEvent,
		{
			type: "content_block_delta",
			index: 0,
			delta: { type: "signature_delta", signature: "sig" },
		} as unknown as RawMessageStreamEvent,
		{ type: "content_block_stop", index: 0 } as RawMessageStreamEvent,
		{
			type: "content_block_start",
			index: 1,
			content_block: { type: "text", text: "" },
		} as unknown as RawMessageStreamEvent,
		{
			type: "content_block_delta",
			index: 1,
			delta: { type: "text_delta", text: "answer" },
		} as unknown as RawMessageStreamEvent,
		{ type: "content_block_stop", index: 1 } as RawMessageStreamEvent,
		messageDelta("end_turn", 3),
		messageStop,
	]);

	expect(chunks).toEqual([
		{ type: "text_delta", text: "answer" },
		{
			type: "message_end",
			stopReason: "end_turn",
			usage: { inputTokens: 7, outputTokens: 3 },
		},
	]);
});

test("pause_turn coerces to end_turn", async () => {
	const chunks = await collect([
		messageStart(),
		messageDelta("pause_turn", 1),
		messageStop,
	]);
	expect(chunks).toEqual([
		{
			type: "message_end",
			stopReason: "end_turn",
			usage: { inputTokens: 10, outputTokens: 1 },
		},
	]);
});

test("refusal passes through as a stop reason", async () => {
	const chunks = await collect([
		messageStart(),
		messageDelta("refusal", 2),
		messageStop,
	]);
	expect(chunks).toEqual([
		{
			type: "message_end",
			stopReason: "refusal",
			usage: { inputTokens: 10, outputTokens: 2 },
		},
	]);
});
