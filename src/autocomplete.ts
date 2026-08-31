import type {
	AutocompleteItem,
	AutocompleteProvider,
} from "@earendil-works/pi-tui";
import { readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DEFAULT_IGNORE_DIRECTORIES, formatBytes, isBinary } from "./scanner.js";

const MAX_SUGGESTIONS = 30;

/**
 * Regex matching `@!path` or `@!"quoted path"` immediately before cursor.
 */
const TRIGGER_RE = /(?:^|\s)@!([^\s"(){}[\];,]*)$/;
const QUOTED_TRIGGER_RE = /(?:^|\s)@!"([^"\n]*)$/;

export function createReadAllAutocompleteProvider(
	cwd: string,
	currentProvider?: AutocompleteProvider,
): AutocompleteProvider {
	return {
		triggerCharacters: ["!"],

		async getSuggestions(lines, cursorLine, cursorCol, options) {
			const line = lines[cursorLine] ?? "";
			const beforeCursor = line.slice(0, cursorCol);

			const quotedMatch = beforeCursor.match(QUOTED_TRIGGER_RE);
			const normalMatch = beforeCursor.match(TRIGGER_RE);

			const isQuoted = Boolean(quotedMatch);
			const match = quotedMatch || normalMatch;

			if (!match) {
				return (
					currentProvider?.getSuggestions(lines, cursorLine, cursorCol, options) ??
					null
				);
			}

			const typed = match[1] ?? "";
			const items = await getPathSuggestions(typed, cwd, isQuoted, options.signal);

			if (items.length === 0) {
				return (
					currentProvider?.getSuggestions(lines, cursorLine, cursorCol, options) ??
					null
				);
			}

			const matchedPrefix = isQuoted ? `@!"${typed}` : `@!${typed}`;

			return {
				items,
				prefix: matchedPrefix,
			};
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			if (currentProvider?.applyCompletion) {
				return currentProvider.applyCompletion(
					lines,
					cursorLine,
					cursorCol,
					item,
					prefix,
				);
			}

			const line = lines[cursorLine] ?? "";
			const beforeMatch = line.slice(0, cursorCol - prefix.length);
			const afterCursor = line.slice(cursorCol);

			const newLine = beforeMatch + item.value + afterCursor;
			const newLines = [...lines];
			newLines[cursorLine] = newLine;
			const newCursorCol = beforeMatch.length + item.value.length;

			return {
				lines: newLines,
				cursorLine,
				cursorCol: newCursorCol,
			};
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return (
				currentProvider?.shouldTriggerFileCompletion?.(
					lines,
					cursorLine,
					cursorCol,
				) ?? true
			);
		},
	};
}

async function getPathSuggestions(
	typed: string,
	cwd: string,
	wasQuoted: boolean,
	signal: AbortSignal,
): Promise<AutocompleteItem[]> {
	const normalizedTyped = typed.replace(/\\/g, "/");
	let targetDir: string;
	let namePrefix: string;

	if (normalizedTyped.endsWith("/")) {
		targetDir = normalizedTyped.slice(0, -1);
		namePrefix = "";
	} else if (normalizedTyped.includes("/")) {
		targetDir = dirname(normalizedTyped);
		namePrefix = normalizedTyped.slice(targetDir.length + 1).toLowerCase();
	} else {
		targetDir = "";
		namePrefix = normalizedTyped.toLowerCase();
	}

	let searchDir = cwd;
	if (targetDir) {
		searchDir = isAbsolute(targetDir) ? targetDir : resolve(cwd, targetDir);
	}

	let entries;
	try {
		entries = await readdir(searchDir, { withFileTypes: true });
	} catch {
		return [];
	}

	if (signal.aborted) return [];

	const suggestions: AutocompleteItem[] = [];

	for (const entry of entries) {
		if (entry.name.startsWith(".") && entry.name !== "." && entry.name !== "..") {
			continue;
		}

		if (
			DEFAULT_IGNORE_DIRECTORIES.has(entry.name) ||
			DEFAULT_IGNORE_DIRECTORIES.has(`.${entry.name}`)
		) {
			continue;
		}

		const isDir = entry.isDirectory();
		const nameLower = entry.name.toLowerCase();

		if (namePrefix && !nameLower.startsWith(namePrefix)) {
			continue;
		}

		const relPrefix = targetDir ? `${targetDir.replace(/\\/g, "/")}/` : "";
		const rawCandidate = `${relPrefix}${entry.name}${isDir ? "/" : ""}`;

		// Format completion value
		const needsQuotes = wasQuoted || rawCandidate.includes(" ");
		let completionValue = `@!${rawCandidate}`;
		if (needsQuotes) {
			completionValue = `@!"${rawCandidate}${isDir ? "" : '"'}`;
		}

		let description = isDir ? "📁 directory (recursive)" : "📄 file";

		if (!isDir && !isBinary(entry.name)) {
			try {
				const fullPath = join(searchDir, entry.name);
				const st = await stat(fullPath);
				description = `📄 file (${formatBytes(st.size)})`;
			} catch {
				// ignore stat errors
			}
		}

		suggestions.push({
			value: completionValue,
			label: isDir ? `📁 ${entry.name}/` : `📄 ${entry.name}`,
			description,
		});

		if (suggestions.length >= MAX_SUGGESTIONS) {
			break;
		}
	}

	// Sort folders first, then files alphabetically
	suggestions.sort((a, b) => {
		const aIsDir = a.label.startsWith("📁");
		const bIsDir = b.label.startsWith("📁");
		if (aIsDir && !bIsDir) return -1;
		if (!aIsDir && bIsDir) return 1;
		return a.label.localeCompare(b.label);
	});

	return suggestions;
}
