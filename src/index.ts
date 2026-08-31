import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	createReadAllAutocompleteProvider,
	getPathSuggestions,
} from "./autocomplete.js";
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
	"<cesta>":
		"Načíst soubor nebo složku rekurzivně do kontextu s analýzou tokenů a potvrzením",
	status: "Zobrazit statistiky načítání a stav doplňování",
	help: "Zobrazit podrobnou nápovědu a syntaxi v češtině",
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
			index: number;
			length: number;
		}

		const validScanEntries: ScanEntry[] = [];

		for (const match of matches) {
			const fullMatch = match[0];
			let targetPath = match[1] ?? match[2];
			const matchIndex = match.index ?? 0;
			if (!targetPath) continue;

			const isQuoted = Boolean(match[1]);
			let scanResult: ScanResult | null = null;
			let matchLength = fullMatch.length;

			try {
				scanResult = await scanPath(targetPath, ctx.cwd);
			} catch (error: unknown) {
				// If unquoted and failed, try stripping trailing sentence punctuation like . , ? ! : ;
				if (!isQuoted && /[.,:;!?]+$/.test(targetPath)) {
					const stripped = targetPath.replace(/[.,:;!?]+$/, "");
					try {
						scanResult = await scanPath(stripped, ctx.cwd);
						const diff = targetPath.length - stripped.length;
						targetPath = stripped;
						matchLength -= diff;
					} catch {
						// Keep original error below
					}
				}

				if (!scanResult) {
					const msg = error instanceof Error ? error.message : String(error);
					ctx.ui.notify(
						`[pi-read-all] Could not read "${targetPath}": ${msg}`,
						"error",
					);
				}
			}

			if (scanResult) {
				validScanEntries.push({
					fullMatch,
					targetPath,
					scanResult,
					index: matchIndex,
					length: matchLength,
				});
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
				ctx.ui.setEditorText?.(text);
				ctx.ui.notify(
					`[pi-read-all] Load cancelled by user (~${analysis.totalTokens.toLocaleString()} tokens rejected). Prompt preserved in editor.`,
					"warning",
				);
				return { action: "handled" };
			}
		}

		// 3. If confirmed, perform the prompt injection from end to start using exact character offsets
		const sortedEntries = [...validScanEntries].sort((a, b) => b.index - a.index);
		let newText = text;
		for (const entry of sortedEntries) {
			const formattedContent = formatScanResult(
				entry.scanResult,
				entry.targetPath,
			);
			const replacement = `\n\n${formattedContent}\n\n`;
			newText =
				newText.slice(0, entry.index) +
				replacement +
				newText.slice(entry.index + entry.length);
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
		description: "Načíst úplný obsah souboru nebo složky do kontextu",
		getArgumentCompletions: async (
			prefix: string,
		): Promise<AutocompleteItem[] | null> => {
			const tokens = prefix.split(/\s+/).filter(Boolean);
			const trailingSpace = /\s$/.test(prefix);

			// 2nd-level argument completion:
			if (tokens.length > 1 || (trailingSpace && tokens.length === 1)) {
				const cmd = tokens[0]?.toLowerCase();
				if (
					cmd === "status" ||
					cmd === "help" ||
					cmd === "-h" ||
					cmd === "--help"
				) {
					return null;
				}
				return getPathSuggestions(
					prefix.trimStart(),
					process.cwd(),
					false,
					new AbortController().signal,
					"plain",
				);
			}

			// 1st-level subcommand & path suggestions
			const typed = (tokens[0] ?? "").toLowerCase();
			const subcommands: AutocompleteItem[] = Object.entries(COMMAND_DOCS).flatMap(
				([key, description]) =>
					!key.startsWith("<") && key.toLowerCase().startsWith(typed)
						? [{ value: key, label: key, description }]
						: [],
			);

			// Path suggestions for /read-all <path>
			const pathItems = await getPathSuggestions(
				prefix.trimStart(),
				process.cwd(),
				false,
				new AbortController().signal,
				"plain",
			);

			const combined = [...subcommands, ...pathItems];
			return combined.length > 0 ? combined : null;
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
					"# pi-read-all — Načtení plného kontextu",
					"Rekurzivní načtení celých souborů nebo složek do kontextu LLM s analýzou tokenů a interaktivním potvrzením.",
					"",
					"### Použití a syntaxe:",
					"  @!cesta/k/souboru    — Vložit jeden kompletní soubor (např. @!kniha.txt)",
					"  @!cesta/ke/slozce/   — Rekurzivně vložit celou složku (např. @!src/core/)",
					'  @!"cesta s mezerou"  — Vložit cestu obsahující mezery',
					"  @!                   — Otevřít interaktivní našeptávač cest v TUI",
					"",
					"### Bezpečnost a kontrola:",
					"  Před vložením velkého obsahu se spočítá počet tokenů a dopad na kontextové okno",
					"  a zobrazí se dialog pro potvrzení.",
					"",
					"### Příkazy:",
					"  /read-all <cesta>    — Načíst cestu, spočítat tokeny, potvrdit a vložit",
					"  /read-all status     — Zobrazit statistiky načítání sezení (soubory, tokeny, data)",
					"  /read-all help       — Zobrazit tuto nápovědu",
				].join("\n");

				ctx.ui.notify(helpText, "info");
				return;
			}

			if (subcommand === "status") {
				const statusMsg = [
					`Celkem načtení: ${sessionStats.totalLoads}`,
					`Zpracováno souborů: ${sessionStats.totalFilesLoaded}`,
					`Celkem tokenů: ~${sessionStats.totalTokensLoaded.toLocaleString()}`,
					`Celkový objem: ${formatBytes(sessionStats.totalBytesLoaded)}`,
				].join(" | ");

				ctx.ui.notify(`[pi-read-all Stav] ${statusMsg}`, "info");
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
							`[pi-read-all] Načtení zrušeno uživatelem (~${analysis.totalTokens.toLocaleString()} tokenů odmítnuto).`,
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
