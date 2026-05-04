import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readFile as fsReadFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile } from "./write-file.tsx";

let dir: string;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "kstack-write-file-"));
});

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

test("write_file writes a file at a relative path", async () => {
	const path = join(dir, "hello.txt");

	const result = await writeFile.execute({ path, content: "hi there" });

	expect(result.isError).toBeUndefined();
	expect(await fsReadFile(path, "utf8")).toBe("hi there");
});

test("write_file creates missing parent directories", async () => {
	const path = join(dir, "a/b/c/notes.md");

	const result = await writeFile.execute({ path, content: "# notes\n" });

	expect(result.isError).toBeUndefined();
	expect(await fsReadFile(path, "utf8")).toBe("# notes\n");
	expect((await stat(join(dir, "a/b/c"))).isDirectory()).toBe(true);
});

test("write_file overwrites an existing file", async () => {
	const path = join(dir, "log.txt");

	await writeFile.execute({ path, content: "first" });
	await writeFile.execute({ path, content: "second" });

	expect(await fsReadFile(path, "utf8")).toBe("second");
});

test("write_file errors on missing path argument", async () => {
	const result = await writeFile.execute({ content: "oops" });

	expect(result.isError).toBe(true);
	expect(result.content).toContain("path");
});

test("write_file errors on empty path", async () => {
	const result = await writeFile.execute({ path: "", content: "x" });

	expect(result.isError).toBe(true);
});

test("write_file errors on missing content argument", async () => {
	const result = await writeFile.execute({ path: join(dir, "a.txt") });

	expect(result.isError).toBe(true);
	expect(result.content).toContain("content");
});

test("write_file reports bytes and lines written on success", async () => {
	const path = join(dir, "multi.txt");

	const result = await writeFile.execute({
		path,
		content: "one\ntwo\nthree",
	});

	expect(result.content).toContain("13 bytes");
	expect(result.content).toContain("3 lines");
	expect(result.content).toContain(path);
});
