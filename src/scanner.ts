import type { Buffer } from "node:buffer";

import { readdir, readFile, realpath, stat } from "node:fs/promises";

import { homedir } from "node:os";

import { isAbsolute, join, relative, resolve, sep } from "node:path";

import ignore, { type Ignore } from "ignore";
import {
	BINARY_EXTENSIONS,
	DEFAULT_IGNORE_DIRECTORIES,
	LOCK_FILES,
	SENSITIVE_FILES,
	SENSITIVE_EXTENSIONS,
	IGNORE_FILES,
	expandPath,
	isBinary,
	isSensitiveFile,
} from "./scan-rules.js";

// Re-exported so existing consumers can keep importing from this module.
export * from "./scan-rules.js";

export interface FileItem {
	path: string;
	relativePath: string;
	content: string;
	lines: number;
	bytes: number;
	chars?: number;
	tokens?: number;
}

export interface ScanOptions {
	maxFiles?: number;
	maxTotalBytes?: number;
	includeHidden?: boolean;
	includeLockfiles?: boolean;
	includeSensitive?: boolean;
	useGitIgnore?: boolean;
	customIgnoreDirs?: string[];
	customIgnoreFiles?: string[];
}

export interface ScanResult {
	targetPath: string;
	isDirectory: boolean;
	files: FileItem[];
	totalLines: number;
	totalBytes: number;
	totalChars?: number;
	totalTokens?: number;
	skippedBinaryCount: number;
	skippedSensitiveCount: number;
	skippedUnreadableCount: number;
	skippedOversizeCount: number;
	truncated: boolean;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Load and combine .gitignore rules from workspace cwd and target directory.
 */
async function loadGitIgnore(
	cwd: string,
	targetPath: string,
): Promise<Ignore | null> {
	const ig = ignore();
	let loaded = false;

	// 1. Try cwd .gitignore
	try {
		const cwdGitignore = await readFile(join(cwd, ".gitignore"), "utf-8");
		ig.add(cwdGitignore);
		loaded = true;
	} catch {
		// ignore
	}

	// 2. Try targetPath .gitignore if different
	if (targetPath !== cwd) {
		try {
			const targetGitignore = await readFile(
				join(targetPath, ".gitignore"),
				"utf-8",
			);
			ig.add(targetGitignore);
			loaded = true;
		} catch {
			// ignore
		}
	}

	return loaded ? ig : null;
}

export async function scanPath(
	rawPath: string,
	cwd: string,
	options: ScanOptions = {},
): Promise<ScanResult> {
	const maxFiles = options.maxFiles ?? 2000;
	const maxTotalBytes = options.maxTotalBytes ?? 50 * 1024 * 1024; // 50MB
	const includeHidden = options.includeHidden ?? false;
	const useGitIgnore = options.useGitIgnore ?? true;

	const ignoreDirs = new Set([
		...DEFAULT_IGNORE_DIRECTORIES,
		...(options.customIgnoreDirs ?? []),
	]);

	const absolutePath = expandPath(rawPath, cwd);
	const targetStat = await stat(absolutePath);

	const result: ScanResult = {
		targetPath: absolutePath,
		isDirectory: targetStat.isDirectory(),
		files: [],
		totalLines: 0,
		totalBytes: 0,
		skippedBinaryCount: 0,
		skippedSensitiveCount: 0,
		skippedUnreadableCount: 0,
		skippedOversizeCount: 0,
		truncated: false,
	};

	if (!targetStat.isDirectory()) {
		// Single file target — allow direct read even for lockfiles or sensitive files
		const buffer = await readFile(absolutePath);
		if (isBinary(absolutePath, buffer)) {
			result.skippedBinaryCount++;
			return result;
		}
		const content = buffer.toString("utf-8");
		const lines = content.length === 0 ? 0 : content.split("\n").length;
		const bytes = buffer.length;
		const relPath = relative(cwd, absolutePath).split(sep).join("/");

		result.files.push({
			path: absolutePath,
			relativePath: relPath || rawPath,
			content,
			lines,
			bytes,
		});
		result.totalLines = lines;
		result.totalBytes = bytes;
		return result;
	}

	// Load gitignore rules if active
	const gitIgnore = useGitIgnore ? await loadGitIgnore(cwd, absolutePath) : null;

	// Track visited real directory paths to prevent circular symlinks / infinite loops
	const visitedDirs = new Set<string>();
	try {
		const realRoot = await realpath(absolutePath);
		visitedDirs.add(realRoot);
	} catch {
		visitedDirs.add(absolutePath);
	}

	// Recursive directory scan
	const stack: string[] = [absolutePath];

	while (stack.length > 0) {
		const currentDir = stack.pop()!;
		let entries;
		try {
			entries = await readdir(currentDir, { withFileTypes: true });
		} catch {
			continue;
		}

		for (const entry of entries) {
			const fullEntryPath = join(currentDir, entry.name);
			const relFromCwd = relative(cwd, fullEntryPath).split(sep).join("/");
			const relFromTarget = relative(absolutePath, fullEntryPath)
				.split(sep)
				.join("/");

			// Sensitive file check first so that .env, credentials, keys are counted & excluded
			if (!options.includeSensitive && isSensitiveFile(entry.name)) {
				result.skippedSensitiveCount++;
				continue;
			}

			if (
				!includeHidden &&
				entry.name.startsWith(".") &&
				entry.name !== "." &&
				entry.name !== ".." &&
				!entry.name.startsWith(".venv") // explicit in ignoreDirs
			) {
				continue;
			}

			let isDir = entry.isDirectory();
			if (!isDir && entry.isSymbolicLink()) {
				try {
					const linkStat = await stat(fullEntryPath);
					if (linkStat.isDirectory()) {
						isDir = true;
					}
				} catch {
					// Broken symlink or inaccessible target
					continue;
				}
			}

			if (isDir) {
				if (ignoreDirs.has(entry.name) || ignoreDirs.has(`.${entry.name}`)) {
					continue;
				}

				if (gitIgnore) {
					if (
						gitIgnore.ignores(`${relFromCwd}/`) ||
						gitIgnore.ignores(`${relFromTarget}/`)
					) {
						continue;
					}
				}

				let realDirPath: string;
				try {
					realDirPath = await realpath(fullEntryPath);
				} catch {
					realDirPath = fullEntryPath;
				}

				if (visitedDirs.has(realDirPath)) {
					continue;
				}
				visitedDirs.add(realDirPath);

				stack.push(fullEntryPath);
				continue;
			}

			if (entry.isFile() || entry.isSymbolicLink()) {
				if (IGNORE_FILES.has(entry.name)) {
					continue;
				}

				if (!options.includeLockfiles && LOCK_FILES.has(entry.name)) {
					continue;
				}

				if (gitIgnore) {
					if (gitIgnore.ignores(relFromCwd) || gitIgnore.ignores(relFromTarget)) {
						continue;
					}
				}

				if (result.files.length >= maxFiles) {
					result.truncated = true;
					break;
				}

				if (isBinary(fullEntryPath)) {
					result.skippedBinaryCount++;
					continue;
				}

				try {
					const buffer = await readFile(fullEntryPath);
					if (isBinary(fullEntryPath, buffer)) {
						result.skippedBinaryCount++;
						continue;
					}

					if (result.totalBytes + buffer.length > maxTotalBytes) {
						result.skippedOversizeCount++;
						result.truncated = true;
						break;
					}

					const content = buffer.toString("utf-8");
					const lines = content.length === 0 ? 0 : content.split("\n").length;
					const bytes = buffer.length;
					const relPath = relFromCwd;

					result.files.push({
						path: fullEntryPath,
						relativePath: relPath,
						content,
						lines,
						bytes,
					});

					result.totalLines += lines;
					result.totalBytes += bytes;
				} catch {
					result.skippedUnreadableCount++;
				}
			}
		}

		if (result.truncated) break;
	}

	// Sort files by relative path for deterministic ordering
	result.files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

	return result;
}

export function formatScanResult(
	result: ScanResult,
	rawTarget: string,
): string {
	if (result.files.length === 0) {
		if (result.skippedBinaryCount > 0) {
			return `[pi-read-all]: No text content found in "${rawTarget}" (${result.skippedBinaryCount} binary file(s) skipped).`;
		}
		return `[pi-read-all]: No files found in "${rawTarget}".`;
	}

	const tokenPart =
		typeof result.totalTokens === "number" && result.totalTokens > 0
			? `~${result.totalTokens.toLocaleString()} tokens, `
			: "";

	const headerParts = [
		`[pi-read-all]: Loaded ${result.files.length} file${result.files.length === 1 ? "" : "s"} from "${rawTarget}"`,
		`Total: ${tokenPart}${result.totalLines.toLocaleString()} lines, ${formatBytes(result.totalBytes)}`,
	];

	if (result.skippedBinaryCount > 0) {
		headerParts.push(`Skipped ${result.skippedBinaryCount} binary files`);
	}
	if (result.skippedSensitiveCount > 0) {
		headerParts.push(`Skipped ${result.skippedSensitiveCount} sensitive files`);
	}
	if (result.skippedUnreadableCount > 0) {
		headerParts.push(`Skipped ${result.skippedUnreadableCount} unreadable files`);
	}
	if (result.truncated) {
		headerParts.push("Reached scan safety limit");
	}

	const header = headerParts.join(" | ");
	const body = result.files
		.map((f) => {
			const tokAttr =
				typeof f.tokens === "number" && f.tokens > 0
					? ` tokens="~${f.tokens}"`
					: "";
			return `<file path="${f.relativePath}" lines="${f.lines}" size="${formatBytes(f.bytes)}"${tokAttr}>\n${f.content}\n</file>`;
		})
		.join("\n\n");

	return `${header}\n\n${body}`;
}
