# @kstack/chat

Provider-agnostic AI chat. The package's job is to keep vendor SDKs behind a uniform interface so consumers (e.g. `@kstack/tui`) never import an SDK directly.

## Public surface

- `Provider` interface with one method: `stream(request) → AsyncIterable<StreamChunk>`.
- Message, tool, and chunk types in `types.ts`. **No vendor types leak through this boundary** — if you find yourself re-exporting an Anthropic/OpenAI type, add a neutral one to `types.ts` instead.
- Stateless: callers pass the full message history per request. The package holds no conversation state.

## Anthropic provider

Currently the only provider. Factory: `createAnthropic({ apiKey?, baseURL? })`, built on `@anthropic-ai/sdk`.

The Anthropic→`StreamChunk` translator is exported separately as `translateStream` so `anthropic.test.ts` can feed it mocked event sequences without touching the SDK or network. Keep this seam intact when modifying the translator — tests depend on being able to drive it with hand-rolled events.

## Adding a new provider

Write another `create*()` factory that conforms to `Provider`. Consumers don't change. If the new SDK's stream shape doesn't fit `StreamChunk` cleanly, extend `StreamChunk` in `types.ts` rather than leaking provider-specific variants out of the factory.
