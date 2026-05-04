/**
 * `tree` core tool. Walks a directory and returns an indented listing of its
 * descendants up to a configurable depth, with each line tagged `[dir]` or
 * `[file]`. The walk consults the target directory's root `.gitignore` and
 * `.ignore` (and always elides `.git`) so heavy folders like `node_modules`
 * never reach the model.
 */

import { Box, Text } from "ink";
import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import ignore, { type Ignore } from "ignore";
import type { Tool } from "../types.ts";

const DEFAULT_DEPTH = 3;
const PREVIEW_LINES = 10;

type Node =
	| { kind: "dir"; name: string; children: Node[] }
	| { kind: "file"; name: string };

/**
 * Build an `Ignore` matcher seeded from the target directory's `.gitignore`
 * and `.ignore` (either, both, or neither may exist). Always ignores `.git`
 * to mirror real git behaviour — listing it would dwarf everything else.
 */
async function loadIgnore(rootDir: string): Promise<Ignore> {
	const ig = ignore();
	for (const name of [".gitignore", ".ignore"]) {
		const file = Bun.file(join(rootDir, name));
		if (await file.exists()) {
			ig.add(await file.text());
		}
	}
	ig.add(".git");
	return ig;
}

async function walk(
	rootDir: string,
	current: string,
	depthRemaining: number,
	ig: Ignore,
): Promise<Node[]> {
	if (depthRemaining <= 0) return [];
	let entries;
	try {
		entries = await readdir(current, { withFileTypes: true });
	} catch {
		return [];
	}
	entries.sort((a, b) => a.name.localeCompare(b.name));
	const nodes: Node[] = [];
	for (const entry of entries) {
		const fullPath = join(current, entry.name);
		const rel = relative(rootDir, fullPath).split(sep).join("/");
		const isDir = entry.isDirectory();
		const candidate = isDir ? `${rel}/` : rel;
		if (ig.ignores(candidate)) continue;
		if (isDir) {
			const children = await walk(rootDir, fullPath, depthRemaining - 1, ig);
			nodes.push({ kind: "dir", name: entry.name, children });
		} else if (entry.isFile()) {
			nodes.push({ kind: "file", name: entry.name });
		}
	}
	return nodes;
}

function formatTree(rootLabel: string, children: Node[]): string {
	const lines: string[] = [`[dir] ${rootLabel}`];
	const emit = (items: Node[], indent: number) => {
		const pad = "  ".repeat(indent);
		for (const item of items) {
			if (item.kind === "dir") {
				lines.push(`${pad}[dir] ${item.name}`);
				emit(item.children, indent + 1);
			} else {
				lines.push(`${pad}[file] ${item.name}`);
			}
		}
	};
	emit(children, 1);
	return lines.join("\n");
}

function readTarget(input: unknown): string {
	const raw = (input as { target_directory?: unknown } | null | undefined)
		?.target_directory;
	return typeof raw === "string" && raw.length > 0 ? raw : ".";
}

function readDepth(input: unknown): number {
	const raw = (input as { depth?: unknown } | null | undefined)?.depth;
	if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
		return DEFAULT_DEPTH;
	}
	return Math.floor(raw);
}

export const tree: Tool = {
	name: "tree",
	description:
		"Lists files and directories under a target directory as an indented tree. Each line is prefixed with [dir] or [file]. Respects the target directory's root .gitignore and .ignore so folders like node_modules and .venv are skipped.",
	inputSchema: {
		type: "object",
		properties: {
			target_directory: {
				type: "string",
				description:
					"Relative or absolute path to the directory to list. Defaults to the current working directory.",
			},
			depth: {
				type: "integer",
				description:
					"How many levels of descendants to include. Defaults to 3. depth=0 lists only the root, depth=1 only its immediate children.",
				minimum: 0,
			},
		},
	},
	async execute(input) {
		const target = readTarget(input);
		const depth = readDepth(input);
		const rootAbs = resolve(target);
		try {
			const st = await stat(rootAbs);
			if (!st.isDirectory()) {
				return {
					content: `tree: ${target} is not a directory.`,
					isError: true,
				};
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			return { content: `tree: cannot access ${target}: ${msg}`, isError: true };
		}
		const ig = await loadIgnore(rootAbs);
		const children = await walk(rootAbs, rootAbs, depth, ig);
		return { content: formatTree(target, children) };
	},
	view: ({ input, result }) => {
		const target = readTarget(input);
		const depth = readDepth(input);
		if (!result) {
			return (
				<Text dimColor>
					(listing <Text bold>{target}</Text> · depth {depth}…)
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
					<Text dimColor>tree </Text>
					<Text bold color="cyan">
						{target}
					</Text>
					<Text dimColor> · depth {depth}</Text>
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
