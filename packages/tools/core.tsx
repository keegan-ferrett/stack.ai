/**
 * Built-in tools shipped with @kstack/tools. Each entry is a worked example of
 * the executor + view pattern. Consumers can pass `coreTools` into their
 * registry composition and append package-specific tools alongside.
 */

import { Text } from "ink";
import type { Tool } from "./types.ts";

const currentTime: Tool = {
	name: "current_time",
	description: "Returns the current date and time in ISO 8601 format.",
	inputSchema: { type: "object", properties: {} },
	async execute() {
		return { content: new Date().toISOString() };
	},
	view: ({ result }) => {
		if (!result) {
			return <Text dimColor>(reading clock…)</Text>;
		}
		if (result.isError) {
			return <Text color="red">{result.content}</Text>;
		}
		return (
			<Text>
				<Text dimColor>now </Text>
				<Text bold color="cyan">
					{result.content}
				</Text>
			</Text>
		);
	},
};

export const coreTools: readonly Tool[] = [currentTime];
