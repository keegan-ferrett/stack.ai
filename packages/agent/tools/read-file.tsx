/**
 * `read_file` core tool. Reads a text file at a relative path and returns its
 * full body to the model; the TUI view renders only a short preview.
 */

import { Box, Text } from "ink";
import type { Tool } from "../types.ts";

/**
 * Strip parameters (e.g. `;charset=utf-8`) from a MIME type so we can compare
 * the bare type. Bun returns `text/plain;charset=utf-8` for `.txt`, so a naive
 * equality check against `text/plain` would miss it.
 */
function bareMimeType(type: string): string {
	const semi = type.indexOf(";");
	return (semi === -1 ? type : type.slice(0, semi)).trim().toLowerCase();
}

const PREVIEW_LINES = 5;

export const readFile: Tool = {
	name: "read_file",
	description:
		"Reads the contents of a text file (e.g. markdown or plain text) at the given relative path and returns its full body.",
	inputSchema: {
		type: "object",
		properties: {
			path: {
				type: "string",
				description: "Relative path to the text file to read.",
			},
		},
		required: ["path"],
	},
	async execute(input) {
		const path = (input as { path?: unknown } | null | undefined)?.path;
		if (typeof path !== "string" || path.length === 0) {
			return {
				content: "read_file requires a non-empty `path` string.",
				isError: true,
			};
		}
		const file = Bun.file(path);
		if (!(await file.exists())) {
			return { content: `File not found: ${path}`, isError: true };
		}
		const mime = bareMimeType(file.type);
		if (!mime.startsWith("text/")) {
			return {
				content: `Refusing to read ${path}: mimetype "${mime}" is not text-based.`,
				isError: true,
			};
		}
		const text = await file.text();
		return { content: text };
	},
	view: ({ input, result }) => {
		const path =
			typeof (input as { path?: unknown } | null | undefined)?.path === "string"
				? ((input as { path: string }).path)
				: "?";
		if (!result) {
			return (
				<Text dimColor>
					(reading <Text bold>{path}</Text>…)
				</Text>
			);
		}
		if (result.isError) {
			return <Text color="red">{result.content}</Text>;
		}
		const lines = result.content.split("\n");
		const preview = lines.slice(0, PREVIEW_LINES).join("\n");
		const remaining = Math.max(0, lines.length - PREVIEW_LINES);
		return (
			<Box flexDirection="column">
				<Text>
					<Text dimColor>read </Text>
					<Text bold color="cyan">
						{path}
					</Text>
				</Text>
				{preview.length > 0 ? <Text dimColor>{preview}</Text> : null}
				{remaining > 0 ? (
					<Text dimColor>
						… ({remaining} more line{remaining === 1 ? "" : "s"})
					</Text>
				) : null}
			</Box>
		);
	},
};
