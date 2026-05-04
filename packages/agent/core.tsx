/**
 * Built-in tools shipped with @kstack/agent. Each tool lives in its own file
 * under `tools/`; this module aggregates them into the `coreTools` array that
 * consumers compose alongside their own tools at registry construction time.
 */

import { Text } from "ink";
import type { Tool } from "./types.ts";
import { readFile } from "./tools/read-file.tsx";

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

export const coreTools: readonly Tool[] = [currentTime, readFile];
