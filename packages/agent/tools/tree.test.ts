import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { tree } from "./tree.tsx";

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "kstack-tree-"));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

async function write(rel: string, body = ""): Promise<void> {
	await Bun.write(join(dir, rel), body);
}

test("tree lists files and directories with [file]/[dir] tags", async () => {
	await write("a.txt", "x");
	await write("sub/b.txt", "y");

	const result = await tree.execute({ target_directory: dir });

	expect(result.isError).toBeUndefined();
	const lines = result.content.split("\n");
	expect(lines[0]).toBe(`[dir] ${dir}`);
	expect(lines).toContain("  [file] a.txt");
	expect(lines).toContain("  [dir] sub");
	expect(lines).toContain("    [file] b.txt");
});

test("tree default depth is 3 levels of descendants", async () => {
	// depth 1: lvl1, depth 2: lvl1/lvl2, depth 3: lvl1/lvl2/lvl3, depth 4: lvl1/lvl2/lvl3/lvl4
	await write("lvl1/lvl2/lvl3/lvl4/deep.txt", "x");

	const result = await tree.execute({ target_directory: dir });

	const lines = result.content.split("\n");
	// lvl1, lvl2, lvl3 dirs should appear; lvl4 (4th level) should NOT.
	expect(lines.some((l) => l.includes("[dir] lvl1"))).toBe(true);
	expect(lines.some((l) => l.includes("[dir] lvl2"))).toBe(true);
	expect(lines.some((l) => l.includes("[dir] lvl3"))).toBe(true);
	expect(lines.some((l) => l.includes("lvl4"))).toBe(false);
	expect(lines.some((l) => l.includes("deep.txt"))).toBe(false);
});

test("tree respects explicit depth=1 (only immediate children)", async () => {
	await write("top.txt", "x");
	await write("sub/nested.txt", "y");

	const result = await tree.execute({ target_directory: dir, depth: 1 });

	const lines = result.content.split("\n");
	expect(lines).toContain("  [file] top.txt");
	expect(lines).toContain("  [dir] sub");
	// depth=1 must not descend into sub/
	expect(lines.some((l) => l.includes("nested.txt"))).toBe(false);
});

test("tree depth=0 lists only the root", async () => {
	await write("a.txt", "x");

	const result = await tree.execute({ target_directory: dir, depth: 0 });

	expect(result.content).toBe(`[dir] ${dir}`);
});

test("tree respects root .gitignore", async () => {
	await write(".gitignore", "node_modules\n*.log\n");
	await write("node_modules/pkg/index.js", "x");
	await write("debug.log", "x");
	await write("keep.txt", "x");

	const result = await tree.execute({ target_directory: dir });

	expect(result.content).not.toContain("node_modules");
	expect(result.content).not.toContain("debug.log");
	expect(result.content).toContain("keep.txt");
});

test("tree respects root .ignore", async () => {
	await write(".ignore", "secret\n");
	await write("secret/key.pem", "x");
	await write("public/readme.md", "x");

	const result = await tree.execute({ target_directory: dir });

	expect(result.content).not.toContain("secret");
	expect(result.content).toContain("public");
});

test("tree always elides .git directory", async () => {
	await write(".git/HEAD", "ref: refs/heads/main");
	await write("src/main.ts", "x");

	const result = await tree.execute({ target_directory: dir });

	expect(result.content).not.toContain(".git");
	expect(result.content).toContain("src");
});

test("tree defaults target_directory to cwd when omitted", async () => {
	const original = process.cwd();
	process.chdir(dir);
	try {
		await write("hello.txt", "x");

		const result = await tree.execute({});

		expect(result.isError).toBeUndefined();
		expect(result.content).toContain("hello.txt");
	} finally {
		process.chdir(original);
	}
});

test("tree errors when target_directory does not exist", async () => {
	const result = await tree.execute({
		target_directory: join(dir, "missing"),
	});

	expect(result.isError).toBe(true);
	expect(result.content).toContain("tree:");
});

test("tree errors when target_directory is a file", async () => {
	await write("file.txt", "x");

	const result = await tree.execute({
		target_directory: join(dir, "file.txt"),
	});

	expect(result.isError).toBe(true);
	expect(result.content).toContain("not a directory");
});

test("tree sorts entries alphabetically", async () => {
	await write("zebra.txt", "x");
	await write("apple.txt", "x");
	await write("mango.txt", "x");

	const result = await tree.execute({ target_directory: dir, depth: 1 });

	const lines = result.content.split("\n");
	const apple = lines.findIndex((l) => l.includes("apple.txt"));
	const mango = lines.findIndex((l) => l.includes("mango.txt"));
	const zebra = lines.findIndex((l) => l.includes("zebra.txt"));
	expect(apple).toBeGreaterThan(0);
	expect(apple).toBeLessThan(mango);
	expect(mango).toBeLessThan(zebra);
});
