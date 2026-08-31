import type { Buffer } from "node:buffer";
import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const BINARY_EXTENSIONS = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".ico",
	".bmp",
	".tiff",
	".svgz",
	".pdf",
	".zip",
	".gz",
	".tar",
	".7z",
	".rar",
	".bz2",
	".xz",
	".exe",
	".dll",
	".dylib",
	".so",
	".bin",
	".iso",
	".wasm",
	".pyc",
	".class",
	".db",
	".sqlite",
	".sqlite3",
	".woff",
	".woff2",
	".ttf",
	".otf",
	".eot",
	".mp3",
	".mp4",
	".wav",
	".mov",
	".avi",
	".mkv",
	".flac",
	".ogg",
	".webm",
	".docx",
	".xlsx",
	".pptx",
	".odt",
	".ods",
	".odp",
]);

const IGNORE_DIRECTORIES = new Set([
	".git",
	"node_modules",
	".svn",
	".hg",
	".next",
	".turbo",
	".nuxt",
	".cache",
	"dist",
	"build",
	"out",
	"target",
	"bin",
	"obj",
	".idea",
	".vscode",
	".DS_Store",
	"Thumbs.db",
]);

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
	customIgnoreDirs?: string[];
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
	skippedOversizeCount: number;
	truncated: boolean;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function isBinary(filePath: string, buffer?: Buffer): boolean {
	const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
	if (BINARY_EXTENSIONS.has(ext)) return true;

	if (buffer && buffer.length > 0) {
		const checkLength = Math.min(buffer.length, 1024);
		for (let i = 0; i < checkLength; i++) {
			if (buffer[i] === 0) return true;
		}
	}
	return false;
}

export async function scanPath(
	rawPath: string,
	cwd: string,
	options: ScanOptions = {},
): Promise<ScanResult> {
	const maxFiles = options.maxFiles ?? 2000;
	const maxTotalBytes = options.maxTotalBytes ?? 50 * 1024 * 1024; // 50MB
	const includeHidden = options.includeHidden ?? false;
	const ignoreDirs = new Set([
		...IGNORE_DIRECTORIES,
		...(options.customIgnoreDirs ?? []),
	]);

	const absolutePath = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
	const targetStat = await stat(absolutePath);

	const result: ScanResult = {
		targetPath: absolutePath,
		isDirectory: targetStat.isDirectory(),
		files: [],
		totalLines: 0,
		totalBytes: 0,
		skippedBinaryCount: 0,
		skippedOversizeCount: 0,
		truncated: false,
	};

	if (!targetStat.isDirectory()) {
		// Single file
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

			if (
				!includeHidden &&
				entry.name.startsWith(".") &&
				entry.name !== "." &&
				entry.name !== ".."
			) {
				continue;
			}

			if (entry.isDirectory()) {
				if (!ignoreDirs.has(entry.name)) {
					stack.push(fullEntryPath);
				}
				continue;
			}

			if (entry.isFile() || entry.isSymbolicLink()) {
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
					const relPath = relative(cwd, fullEntryPath).split(sep).join("/");

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
					// skip unreadable files
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
	if (result.truncated) {
		headerParts.push("Reached scan safety limit");
	}

	const header = headerParts.join(" | ");
	const body = result.files
		.map((f) => {
			const tokAttr =
				typeof f.tokens === "number" && f.tokens > 0 ? ` tokens="~${f.tokens}"` : "";
			return `<file path="${f.relativePath}" lines="${f.lines}" size="${formatBytes(f.bytes)}"${tokAttr}>\n${f.content}\n</file>`;
		})
		.join("\n\n");

	return `${header}\n\n${body}`;
}
