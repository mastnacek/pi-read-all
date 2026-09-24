// /read-all command: argument completion plus the load handler.
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import type { AutocompleteItem } from "@earendil-works/pi-tui";

import { Type } from "typebox";
import {
	formatBytes,
	formatScanResult,
	scanPath,
} from "./scanner.js";
import {
	analyzeScanResults,
} from "./token-analysis.js";
import {
	formatConfirmationPrompt,
} from "./token-render.js";
import {
	getPathSuggestions,
} from "./autocomplete.js";
import {
	sessionStats,
} from "./state.js";

/** Subcommands shown by the first-level completion. */
const COMMAND_DOCS = {
	"<cesta>":
		"Načíst soubor nebo složku rekurzivně do kontextu s analýzou tokenů a potvrzením",
	status: "Zobrazit statistiky načítání a stav doplňování",
	help: "Zobrazit podrobnou nápovědu a syntaxi v češtině",
} as const;

export function registerReadAllCommand(pi: ExtensionAPI): void {
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
