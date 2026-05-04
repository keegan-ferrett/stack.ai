import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileMarkdown } from "./system-prompt.ts";

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "kstack-system-prompt-"));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

async function writeFile(relPath: string, content: string): Promise<string> {
	const path = join(dir, relPath);
	await Bun.write(path, content);
	return path;
}

test("returns file content when no includes are present", async () => {
	const path = await writeFile("root.md", "hello\nworld\n");
	expect(await compileMarkdown(path)).toBe("hello\nworld\n");
});

test("expands an @include relative to the including file", async () => {
	await writeFile("partial.md", "from partial");
	const root = await writeFile("root.md", "before\n@partial.md\nafter\n");
	expect(await compileMarkdown(root)).toBe(
		"before\nfrom partial\nafter\n",
	);
});

test("expands includes in subdirectories transitively", async () => {
	await writeFile("prompts/leaf.md", "leaf content");
	await writeFile("prompts/branch.md", "branch top\n@leaf.md\nbranch bottom");
	const root = await writeFile("root.md", "root top\n@prompts/branch.md");
	expect(await compileMarkdown(root)).toBe(
		"root top\nbranch top\nleaf content\nbranch bottom",
	);
});

test("does not treat mid-line @ tokens as includes", async () => {
	const root = await writeFile(
		"root.md",
		"contact @alice for details\n@somefile is not a path",
	);
	expect(await compileMarkdown(root)).toBe(
		"contact @alice for details\n@somefile is not a path",
	);
});

test("throws on missing include target", async () => {
	const root = await writeFile("root.md", "@missing.md\n");
	const error = await compileMarkdown(root).then(
		() => null,
		(e: unknown) => e,
	);
	expect(error).toBeInstanceOf(Error);
	expect(String(error)).toMatch(/missing/);
});

test("throws on include cycle", async () => {
	await writeFile("a.md", "@b.md");
	await writeFile("b.md", "@a.md");
	const error = await compileMarkdown(join(dir, "a.md")).then(
		() => null,
		(e: unknown) => e,
	);
	expect(error).toBeInstanceOf(Error);
	expect(String(error)).toMatch(/cycle/i);
});

test("allows the same file to be included from disjoint branches", async () => {
	await writeFile("shared.md", "shared");
	await writeFile("left.md", "@shared.md");
	await writeFile("right.md", "@shared.md");
	const root = await writeFile("root.md", "@left.md\n@right.md");
	expect(await compileMarkdown(root)).toBe("shared\nshared");
});
