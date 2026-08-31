import type { Buffer } from "node:buffer";
import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import ignore, { type Ignore } from "ignore";

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
	".pyo",
	".class",
	".jar",
	".war",
	".ear",
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

/**
 * Universal default ignore directories across all major programming ecosystems:
 * Python, Node/TS, Rust, Go, Java/Kotlin, C/C++, .NET/C#, PHP, Ruby, Dart/Flutter, Elixir, Swift.
 */
export const DEFAULT_IGNORE_DIRECTORIES = new Set([
	// Version Control
	".git",
	".svn",
	".hg",
	".cvs",

	// Python Virtual Environments & Caches
	".venv",
	"venv",
	"env",
	".env",
	"ENV",
	"env.bak",
	"venv.bak",
	"__pycache__",
	".pytest_cache",
	".mypy_cache",
	".ruff_cache",
	".tox",
	".nox",
	".hypothesis",
	".poetry",
	".pdm-build",
	".pdm-home",
	".pixi",
	".conda",
	"htmlcov",
	".coverage",

	// Node / JavaScript / TypeScript / Web Bundlers
	"node_modules",
	"jspm_packages",
	"web_modules",
	".next",
	".nuxt",
	".turbo",
	".svelte-kit",
	".astro",
	".docusaurus",
	".parcel-cache",
	".cache",
	".output",
	"dist",
	"build",
	"out",

	// Rust / Cargo
	"target",

	// Go
	"vendor",
	"pkg",

	// Java / Kotlin / JVM (Maven, Gradle, SBT)
	".gradle",
	".m2",
	".bloop",
	".metals",
	".sbt",

	// C / C++ / Build Generators
	"CMakeFiles",
	"CMakeScripts",
	".cmake",
	"Debug",
	"Release",
	"x64",
	"x86",
	"obj",
	"bin",

	// .NET / C# / F#
	"packages",
	"TestResults",
	"BenchmarkDotNet.Artifacts",

	// PHP (Composer)
	".phpunit.cache",
	".php-cs-fixer.cache",

	// Ruby (Bundler)
	".bundle",

	// Dart / Flutter
	".dart_tool",
	".pub-cache",
	".pub",

	// Elixir / Erlang
	"_build",
	"deps",
	".elixir_ls",

	// Swift / Xcode
	".build",
	".swiftpm",
	"DerivedData",
	"Pods",
	"Carthage",

	// IDEs & Editor metadata
	".idea",
	".vscode",
	".fleet",
	".history",
	".vs",
	".clangd",
	".settings",
]);

/**
 * Common generated lockfiles (skipped in directory tree scans by default).
 */
export const LOCK_FILES = new Set([
	"package-lock.json",
	"pnpm-lock.yaml",
	"yarn.lock",
	"Cargo.lock",
	"poetry.lock",
	"composer.lock",
	"Pipfile.lock",
	"bun.lockb",
	"flake.lock",
	"mix.lock",
	"pubspec.lock",
]);

/**
 * Sensitive credential files excluded by default from bulk directory scans.
 */
export const SENSITIVE_FILES = new Set([
	".env",
	".env.local",
	".env.production",
	".env.development",
	".env.staging",
	".env.test",
	"credentials.json",
	"service-account.json",
	"auth.json",
	"id_rsa",
	"id_ed25519",
	"id_ecdsa",
	"id_dsa",
]);

const SENSITIVE_EXTENSIONS = new Set([
	".pem",
	".key",
	".pkcs12",
	".pfx",
	".p12",
	".keystore",
	".jks",
]);

const IGNORE_FILES = new Set([
	".DS_Store",
	"Thumbs.db",
	"desktop.ini",
	"npm-debug.log",
	"yarn-debug.log",
	"yarn-error.log",
	"pnpm-debug.log",
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

export function isSensitiveFile(filename: string): boolean {
	if (SENSITIVE_FILES.has(filename)) return true;
	const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
	return SENSITIVE_EXTENSIONS.has(ext);
}

/**
 * Load and combine .gitignore rules from workspace cwd and target directory.
 */
async function loadGitIgnore(cwd: string, targetPath: string): Promise<Ignore | null> {
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
			const targetGitignore = await readFile(join(targetPath, ".gitignore"), "utf-8");
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

	const absolutePath = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
	const targetStat = await stat(absolutePath);

	const result: ScanResult = {
		targetPath: absolutePath,
		isDirectory: targetStat.isDirectory(),
		files: [],
		totalLines: 0,
		totalBytes: 0,
		skippedBinaryCount: 0,
		skippedSensitiveCount: 0,
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
			const relFromTarget = relative(absolutePath, fullEntryPath).split(sep).join("/");

			if (
				!includeHidden &&
				entry.name.startsWith(".") &&
				entry.name !== "." &&
				entry.name !== ".." &&
				!entry.name.startsWith(".venv") // explicit in ignoreDirs
			) {
				continue;
			}

			if (entry.isDirectory()) {
				if (ignoreDirs.has(entry.name) || ignoreDirs.has(`.${entry.name}`)) {
					continue;
				}

				if (gitIgnore) {
					if (gitIgnore.ignores(`${relFromCwd}/`) || gitIgnore.ignores(`${relFromTarget}/`)) {
						continue;
					}
				}

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

				if (!options.includeSensitive && isSensitiveFile(entry.name)) {
					result.skippedSensitiveCount++;
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
	if (result.skippedSensitiveCount > 0) {
		headerParts.push(`Skipped ${result.skippedSensitiveCount} sensitive files`);
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
