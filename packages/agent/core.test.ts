import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { coreTools } from "./core.tsx";

const readFile = coreTools.find((t) => t.name === "read_file");
if (!readFile) throw new Error("read_file tool missing from coreTools");

let dir: string;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "kstack-read-file-"));
});

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

test("read_file returns full text body for a markdown file", async () => {
	const path = join(dir, "hello.md");
	await Bun.write(path, "# Title\n\nbody line\n");

	const result = await readFile.execute({ path });

	expect(result).toEqual({ content: "# Title\n\nbody line\n" });
});

test("read_file accepts text/plain (.txt) files even with charset parameter", async () => {
	const path = join(dir, "note.txt");
	await Bun.write(path, "plain text");

	const result = await readFile.execute({ path });

	expect(result.isError).toBeUndefined();
	expect(result.content).toBe("plain text");
});

test("read_file rejects binary mimetypes", async () => {
	const path = join(dir, "blob.bin");
	await Bun.write(path, "raw bytes");

	const result = await readFile.execute({ path });

	expect(result.isError).toBe(true);
	expect(result.content).toContain("application/octet-stream");
	expect(result.content).toContain("not text-based");
});

test("read_file errors on missing file", async () => {
	const result = await readFile.execute({ path: join(dir, "nope.md") });

	expect(result.isError).toBe(true);
	expect(result.content).toContain("File not found");
});

test("read_file errors on missing path argument", async () => {
	const result = await readFile.execute({});

	expect(result.isError).toBe(true);
	expect(result.content).toContain("path");
});

test("read_file errors on empty path", async () => {
	const result = await readFile.execute({ path: "" });

	expect(result.isError).toBe(true);
});
