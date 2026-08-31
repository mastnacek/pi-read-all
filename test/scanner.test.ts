import assert from "node:assert/strict";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	expandPath,
	formatBytes,
	isBinary,
	isSensitiveFile,
	scanPath,
} from "../src/scanner.js";

test("expandPath: expands ~ to home directory", () => {
	assert.equal(expandPath("~", "/tmp"), homedir());
	assert.equal(expandPath("~/test/path", "/tmp"), join(homedir(), "test/path"));
	assert.equal(
		expandPath("~\\test\\path", "/tmp"),
		join(homedir(), "test/path"),
	);
});

test("formatBytes: formats bytes, KB, MB cleanly", () => {
	assert.equal(formatBytes(500), "500 B");
	assert.equal(formatBytes(1024), "1.0 KB");
	assert.equal(formatBytes(1536), "1.5 KB");
	assert.equal(formatBytes(1048576), "1.00 MB");
});

test("isBinary: detects binary extensions and buffer null bytes", () => {
	assert.equal(isBinary("photo.png"), true);
	assert.equal(isBinary("archive.zip"), true);
	assert.equal(isBinary("code.ts"), false);

	const nullBuffer = Buffer.from([0x68, 0x65, 0x6c, 0x00, 0x6f]);
	assert.equal(isBinary("data.dat", nullBuffer), true);

	const textBuffer = Buffer.from("Hello world, pure text!");
	assert.equal(isBinary("data.txt", textBuffer), false);
});

test("isSensitiveFile: identifies sensitive configs and credentials", () => {
	assert.equal(isSensitiveFile(".env"), true);
	assert.equal(isSensitiveFile(".env.local"), true);
	assert.equal(isSensitiveFile("id_rsa"), true);
	assert.equal(isSensitiveFile("server.key"), true);
	assert.equal(isSensitiveFile("cert.pem"), true);
	assert.equal(isSensitiveFile("main.ts"), false);
});

test("scanPath: directory scan, ignore list, and circular symlink protection", async () => {
	const testDir = join(tmpdir(), `pi-read-all-test-${Date.now()}`);
	await mkdir(testDir, { recursive: true });

	try {
		// Create normal files
		await writeFile(join(testDir, "file1.txt"), "Hello from file 1\nSecond line");
		await writeFile(join(testDir, "file2.md"), "# Markdown Title\nSome notes");

		// Create ignored directories
		const nodeModules = join(testDir, "node_modules", "package");
		await mkdir(nodeModules, { recursive: true });
		await writeFile(join(nodeModules, "index.js"), "module.exports = {}");

		const venvDir = join(testDir, ".venv", "lib");
		await mkdir(venvDir, { recursive: true });
		await writeFile(join(venvDir, "python.py"), "print('venv')");

		// Create sensitive file
		await writeFile(join(testDir, ".env"), "SECRET_KEY=12345");

		// Create lockfile
		await writeFile(join(testDir, "package-lock.json"), "{}");

		// Create subfolder
		const subDir = join(testDir, "src");
		await mkdir(subDir, { recursive: true });
		await writeFile(join(subDir, "app.ts"), "export const app = 'test';");

		// Create circular symlink if platform supports it
		try {
			const symlinkPath = join(subDir, "loop");
			await symlink(testDir, symlinkPath, "dir");
		} catch {
			// Symlinks might require elevation on some Windows configurations; skip if restricted
		}

		// Perform directory scan
		const scan = await scanPath(testDir, tmpdir());

		assert.equal(scan.isDirectory, true);
		assert.equal(scan.files.length, 3); // file1.txt, file2.md, src/app.ts
		assert.equal(scan.skippedSensitiveCount, 1); // .env skipped
		assert.equal(scan.truncated, false);

		const relativePaths = scan.files.map((f) => f.relativePath);
		assert.ok(relativePaths.some((p) => p.includes("file1.txt")));
		assert.ok(relativePaths.some((p) => p.includes("file2.md")));
		assert.ok(relativePaths.some((p) => p.includes("app.ts")));
		assert.ok(!relativePaths.some((p) => p.includes("node_modules")));
		assert.ok(!relativePaths.some((p) => p.includes(".venv")));
	} finally {
		await rm(testDir, { recursive: true, force: true });
	}
});
