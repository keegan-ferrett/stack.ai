/**
 * `write_file` core tool. Writes a text file at a relative path, creating any
 * missing parent directories so the agent never has to mkdir explicitly.
 * Overwrites existing files.
 */

import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Box, Text } from "ink";
import type { Tool } from "../types.ts";

/**
 * Count lines in a text body. An empty string is zero lines; otherwise the
 * count is `\n`-separated segments, so a trailing newline is treated as
 * terminating the previous line rather than starting a new empty one.
 */
function countLines(text: string): number {
	if (text.length === 0) return 0;
	const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
	return trimmed.split("\n").length;
}

export const writeFile: Tool = {
	name: "write_file",
	description:
		"Writes a text file at the given path, creating any missing parent directories. Overwrites the file if it already exists. Paths are resolved relative to the current working directory.",
	inputSchema: {
		type: "object",
		properties: {
			path: {
				type: "string",
				description: "Relative path of the file to write.",
			},
			content: {
				type: "string",
				description: "Text contents to write to the file.",
			},
		},
		required: ["path", "content"],
	},
	async execute(input) {
		const path = (input as { path?: unknown } | null | undefined)?.path;
		const content = (input as { content?: unknown } | null | undefined)?.content;
		if (typeof path !== "string" || path.length === 0) {
			return {
				content: "write_file requires a non-empty `path` string.",
				isError: true,
			};
		}
		if (typeof content !== "string") {
			return {
				content: "write_file requires a `content` string.",
				isError: true,
			};
		}
		const absolute = resolve(path);
		await mkdir(dirname(absolute), { recursive: true });
		await Bun.write(absolute, content);
		return {
			content: `Wrote ${content.length} bytes (${countLines(content)} lines) to ${path}.`,
		};
	},
	view: ({ input, result }) => {
		const path =
			typeof (input as { path?: unknown } | null | undefined)?.path === "string"
				? ((input as { path: string }).path)
				: "?";
		const content = (input as { content?: unknown } | null | undefined)?.content;
		const lineCount = typeof content === "string" ? countLines(content) : undefined;

		if (!result) {
			return (
				<Text dimColor>
					(writing <Text bold>{path}</Text>…)
				</Text>
			);
		}
		if (result.isError) {
			return <Text color="red">{result.content}</Text>;
		}
		return (
			<Box flexDirection="column">
				<Text>
					<Text dimColor>wrote </Text>
					<Text bold color="cyan">
						{path}
					</Text>
				</Text>
				{lineCount !== undefined ? (
					<Text dimColor>
						{lineCount} line{lineCount === 1 ? "" : "s"}
					</Text>
				) : null}
			</Box>
		);
	},
};
