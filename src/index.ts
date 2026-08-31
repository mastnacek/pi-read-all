import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { createReadAllAutocompleteProvider } from "./autocomplete.js";
import {
	formatBytes,
	formatScanResult,
	scanPath,
	type ScanResult,
} from "./scanner.js";
import { analyzeScanResults, formatConfirmationPrompt } from "./tokens.js";

/** Regex to match `@!"quoted path"` or `@!unquoted_path` */
const AT_EXCL_RE = /@!"([^"\n]+)"|@!([^\s"(){}[\];,]+)/g;

const COMMAND_DOCS = {
	"<path>":
		"Load file or directory recursively into context with token analysis & confirmation",
	status: "Display read-all extension status and statistics",
	help: "Display usage and syntax reference banner",
} as const;

interface SessionStats {
	totalLoads: number;
	totalFilesLoaded: number;
	totalBytesLoaded: number;
	totalTokensLoaded: number;
}

let sessionStats: SessionStats = {
	totalLoads: 0,
	totalFilesLoaded: 0,
	totalBytesLoaded: 0,
	totalTokensLoaded: 0,
};

export default function (pi: ExtensionAPI): void {
	// 1. Session start: Register TUI autocomplete provider
	pi.on("session_start", (_event, ctx: ExtensionContext) => {
		sessionStats = {
			totalLoads: 0,
			totalFilesLoaded: 0,
			totalBytesLoaded: 0,
			totalTokensLoaded: 0,
		};

		if (ctx.hasUI) {
			ctx.ui.addAutocompleteProvider((current) =>
				createReadAllAutocompleteProvider(ctx.cwd, current),
			);
		}
	});

	// 2. Input interceptor: Transform @! triggers into full file/dir contents with token check & confirmation
	pi.on("input", async (event, ctx: ExtensionContext) => {
		if (event.source === "extension") {
			return { action: "continue" };
		}

		let text = event.text;

		// Standalone @! trigger
		if (text.trim() === "@!") {
			if (!ctx.hasUI) {
				return { action: "continue" };
			}
			const selectedPath = await ctx.ui.input(
				"Enter file or directory path to load completely (e.g. src/ or book.txt):",
			);
			if (!selectedPath || !selectedPath.trim()) {
				ctx.ui.notify("Load cancelled: no path provided.", "warning");
				return { action: "handled" };
			}
			text = `@!${selectedPath.trim()}`;
		}

		if (!text.includes("@!")) {
			return { action: "continue" };
		}

		const matches = Array.from(text.matchAll(AT_EXCL_RE));
		if (matches.length === 0) {
			return { action: "continue" };
		}

		interface ScanEntry {
			fullMatch: string;
			targetPath: string;
			scanResult: ScanResult;
		}

		const validScanEntries: ScanEntry[] = [];

		for (const match of matches) {
			const fullMatch = match[0];
			const targetPath = match[1] ?? match[2];
			if (!targetPath) continue;

			try {
				const scanResult = await scanPath(targetPath, ctx.cwd);
				validScanEntries.push({
					fullMatch,
					targetPath,
					scanResult,
				});
			} catch (error: unknown) {
				const msg = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(
					`[pi-read-all] Could not read "${targetPath}": ${msg}`,
					"error",
				);
			}
		}

		if (validScanEntries.length === 0) {
			return { action: "continue" };
		}

		// 1. Determine tokens and context impact
		const analysis = analyzeScanResults(
			validScanEntries.map((e) => ({
				scanResult: e.scanResult,
				targetPath: e.targetPath,
			})),
			ctx,
		);

		// 2. Wait for user confirmation in UI mode
		if (ctx.hasUI) {
			const { title, message } = formatConfirmationPrompt(analysis);
			const confirmed = await ctx.ui.confirm(title, message);

			if (!confirmed) {
				ctx.ui.notify(
					`[pi-read-all] Load cancelled by user (~${analysis.totalTokens.toLocaleString()} tokens rejected). Prompt was not sent.`,
					"warning",
				);
				return { action: "handled" };
			}
		}

		// 3. If confirmed, perform the prompt injection
		let newText = text;
		for (const entry of validScanEntries) {
			const formattedContent = formatScanResult(
				entry.scanResult,
				entry.targetPath,
			);
			newText = newText.replace(entry.fullMatch, `\n\n${formattedContent}\n\n`);
		}

		sessionStats.totalLoads += validScanEntries.length;
		sessionStats.totalFilesLoaded += analysis.totalFiles;
		sessionStats.totalBytesLoaded += analysis.totalBytes;
		sessionStats.totalTokensLoaded += analysis.totalTokens;

		if (ctx.hasUI) {
			ctx.ui.notify(
				`[pi-read-all] Injected ${analysis.totalFiles} file(s) into context (~${analysis.totalTokens.toLocaleString()} tokens, ${analysis.formattedBytes})`,
				"info",
			);
		}

		return { action: "transform", text: newText };
	});

	// 3. Custom Tool for agent: read_all
	pi.registerTool({
		name: "read_all",
		label: "Read All (Recursive)",
		description:
			"Recursively read complete content of a file or directory into context without line or byte truncation limits. Use when full whole-file context or entire directory trees are needed.",
		parameters: Type.Object({
			path: Type.String({
				description:
					"Relative or absolute path to the file or directory to read completely",
			}),
			maxFiles: Type.Optional(
				Type.Number({
					description:
						"Maximum number of files to read when scanning a directory (default: 2000)",
				}),
			),
			maxTotalBytes: Type.Optional(
				Type.Number({
					description:
						"Maximum total bytes to read across all files (default: 50MB)",
				}),
			),
		}),
		execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
			try {
				const result = await scanPath(params.path, ctx.cwd, {
					maxFiles: params.maxFiles,
					maxTotalBytes: params.maxTotalBytes,
				});

				const analysis = analyzeScanResults(
					[{ scanResult: result, targetPath: params.path }],
					ctx,
				);

				const formatted = formatScanResult(result, params.path);

				return {
					content: [{ type: "text", text: formatted }],
					details: {
						filesCount: result.files.length,
						totalLines: result.totalLines,
						totalBytes: result.totalBytes,
						totalChars: analysis.totalChars,
						totalTokens: analysis.totalTokens,
						truncated: result.truncated,
					},
				};
			} catch (error: unknown) {
				const msg = error instanceof Error ? error.message : String(error);
				return {
					content: [
						{
							type: "text",
							text: `[pi-read-all] Error reading "${params.path}": ${msg}`,
						},
					],
					details: { error: true },
				};
			}
		},
	});

	// 4. Slash command: /read-all
	pi.registerCommand("read-all", {
		description: "Load complete file or directory contents into context",
		getArgumentCompletions: async (
			prefix: string,
		): Promise<AutocompleteItem[] | null> => {
			const tokens = prefix.split(/\s+/).filter(Boolean);
			const typed = (tokens[0] ?? "").toLowerCase();

			if (tokens.length <= 1 && !/\s$/.test(prefix)) {
				const subcommands = Object.entries(COMMAND_DOCS).flatMap(
					([key, description]) =>
						key.toLowerCase().startsWith(typed)
							? [{ value: key, label: key, description }]
							: [],
				);

				return subcommands.length > 0 ? subcommands : null;
			}

			return null;
		},
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const trimmed = args.trim();
			const tokens = trimmed.split(/\s+/).filter(Boolean);
			const subcommand = (tokens[0] ?? "").toLowerCase();

			if (
				!subcommand ||
				subcommand === "help" ||
				subcommand === "-h" ||
				subcommand === "--help"
			) {
				const helpText = [
					"# pi-read-all — Full Context Loader",
					"Recursively load complete files or directories into LLM context with token analysis and user confirmation.",
					"",
					"### Usage & Syntax:",
					"  @!path/to/file       — Include single complete file (e.g. @!book.txt)",
					"  @!path/to/folder/    — Recursively include whole folder (e.g. @!src/core/)",
					'  @!"path with spaces" — Include paths with spaces',
					"  @!                   — Prompt for interactive path selection in TUI",
					"",
					"### Confirmation & Safety:",
					"  Before injecting large content, token count and context impact are calculated",
					"  and an interactive confirmation dialog is displayed.",
					"",
					"### Slash Commands:",
					"  /read-all <path>     — Load path, inspect tokens, confirm, and inject",
					"  /read-all status     — Show session load metrics (loads, files, tokens, bytes)",
					"  /read-all help       — Display this help reference",
				].join("\n");

				ctx.ui.notify(helpText, "info");
				return;
			}

			if (subcommand === "status") {
				const statusMsg = [
					`Total Loads: ${sessionStats.totalLoads}`,
					`Files Processed: ${sessionStats.totalFilesLoaded}`,
					`Total Tokens: ~${sessionStats.totalTokensLoaded.toLocaleString()}`,
					`Total Content: ${formatBytes(sessionStats.totalBytesLoaded)}`,
				].join(" | ");

				ctx.ui.notify(`[pi-read-all Status] ${statusMsg}`, "info");
				return;
			}

			// Load the specified path
			const targetPath = trimmed;
			try {
				const result = await scanPath(targetPath, ctx.cwd);
				const analysis = analyzeScanResults(
					[{ scanResult: result, targetPath }],
					ctx,
				);

				if (ctx.hasUI) {
					const { title, message } = formatConfirmationPrompt(analysis);
					const confirmed = await ctx.ui.confirm(title, message);

					if (!confirmed) {
						ctx.ui.notify(
							`[pi-read-all] Load cancelled by user (~${analysis.totalTokens.toLocaleString()} tokens rejected).`,
							"warning",
						);
						return;
					}
				}

				const formatted = formatScanResult(result, targetPath);

				sessionStats.totalLoads += 1;
				sessionStats.totalFilesLoaded += analysis.totalFiles;
				sessionStats.totalBytesLoaded += analysis.totalBytes;
				sessionStats.totalTokensLoaded += analysis.totalTokens;

				ctx.ui.notify(
					`[pi-read-all] Injected ${result.files.length} file(s) (~${analysis.totalTokens.toLocaleString()} tokens, ${formatBytes(result.totalBytes)}) into conversation.`,
					"info",
				);

				pi.sendUserMessage(formatted);
			} catch (error: unknown) {
				const msg = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(
					`[pi-read-all] Failed to load "${targetPath}": ${msg}`,
					"error",
				);
			}
		},
	});
}
