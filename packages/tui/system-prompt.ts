import { dirname, resolve } from "node:path";

const INCLUDE_PATTERN = /^[\t ]*@(\S+)[\t ]*$/;

/**
 * Compile a markdown file into a single string, expanding `@path/to/file.md`
 * include directives. A directive is a line whose only content is `@<path>`;
 * the path is resolved relative to the file containing the directive, and
 * includes are expanded transitively.
 *
 * Throws on missing target files or include cycles.
 */
export async function compileMarkdown(filePath: string): Promise<string> {
	return compile(resolve(filePath), new Set());
}

async function compile(
	absolutePath: string,
	visited: ReadonlySet<string>,
): Promise<string> {
	if (visited.has(absolutePath)) {
		throw new Error(`Include cycle detected at ${absolutePath}`);
	}
	const file = Bun.file(absolutePath);
	if (!(await file.exists())) {
		throw new Error(`Cannot include missing file: ${absolutePath}`);
	}

	const nextVisited = new Set(visited);
	nextVisited.add(absolutePath);

	const baseDir = dirname(absolutePath);
	const lines = (await file.text()).split("\n");
	const compiled: string[] = [];

	for (const line of lines) {
		const match = INCLUDE_PATTERN.exec(line);
		const includePath = match?.[1];
		if (includePath === undefined) {
			compiled.push(line);
			continue;
		}
		compiled.push(await compile(resolve(baseDir, includePath), nextVisited));
	}

	return compiled.join("\n");
}
