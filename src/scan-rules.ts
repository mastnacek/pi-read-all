// Extracted from scanner.ts to keep modules focused.
import type { Buffer } from "node:buffer";

import { readdir, readFile, realpath, stat } from "node:fs/promises";

import { homedir } from "node:os";

import { isAbsolute, join, relative, resolve, sep } from "node:path";

import ignore, { type Ignore } from "ignore";

export const BINARY_EXTENSIONS = new Set([
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

export const SENSITIVE_EXTENSIONS = new Set([
	".pem",
	".key",
	".pkcs12",
	".pfx",
	".p12",
	".keystore",
	".jks",
]);

export const IGNORE_FILES = new Set([
	".DS_Store",
	"Thumbs.db",
	"desktop.ini",
	"npm-debug.log",
	"yarn-debug.log",
	"yarn-error.log",
	"pnpm-debug.log",
]);

/**
 * Expand tilde (~) and resolve relative/absolute paths across operating systems.
 */
export function expandPath(rawPath: string, cwd: string): string {
	const trimmed = rawPath.trim();
	if (trimmed === "~") {
		return homedir();
	}
	if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
		return join(homedir(), trimmed.slice(2));
	}
	return isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);
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
