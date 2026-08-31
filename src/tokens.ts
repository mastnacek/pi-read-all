import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getEncoding, type Tiktoken } from "js-tiktoken";
import type { FileItem, ScanResult } from "./scanner.js";

let encoderInstance: Tiktoken | null = null;

/**
 * Get or lazily initialize the cl100k_base tokenizer singleton.
 */
function getTokenizer(): Tiktoken | null {
	if (encoderInstance) return encoderInstance;
	try {
		encoderInstance = getEncoding("cl100k_base");
		return encoderInstance;
	} catch {
		return null;
	}
}

/**
 * Accurately calculate token count for text using cl100k BPE,
 * falling back to characters/3.7 heuristic if tokenizer fails.
 */
export function countTokens(text: string): number {
	if (!text) return 0;
	const tokenizer = getTokenizer();
	if (tokenizer) {
		try {
			return tokenizer.encode(text, "all").length;
		} catch {
			// fallback below
		}
	}
	// Heuristic fallback for code and prose (approx 3.7 chars per token)
	return Math.ceil(text.length / 3.7);
}

export interface FileTokenBreakdown {
	path: string;
	relativePath: string;
	lines: number;
	bytes: number;
	chars: number;
	tokens: number;
	sharePercent: number;
}

export interface ContextWindowImpact {
	activeModel?: string;
	contextWindow?: number;
	payloadSharePercent?: number;
	currentSessionTokens?: number;
	currentSessionPercent?: number;
	projectedTotalTokens?: number;
	projectedPercent?: number;
	remainingHeadroom?: number;
	isOverCapacity?: boolean;
	isHighCapacityWarning?: boolean;
}

export interface TokenAnalysis {
	targetDescription: string;
	totalFiles: number;
	totalLines: number;
	totalBytes: number;
	totalChars: number;
	totalTokens: number;
	formattedBytes: string;
	files: FileTokenBreakdown[];
	contextImpact?: ContextWindowImpact;
}

/**
 * Analyze tokens and model context impact for scan results.
 */
export function analyzeScanResults(
	scanResults: Array<{ scanResult: ScanResult; targetPath: string }>,
	ctx?: ExtensionContext,
): TokenAnalysis {
	let totalFiles = 0;
	let totalLines = 0;
	let totalBytes = 0;
	let totalChars = 0;
	let totalTokens = 0;
	const allFiles: FileTokenBreakdown[] = [];

	const targets = scanResults.map((s) => s.targetPath);
	const targetDescription =
		targets.length === 1
			? (targets[0] ?? "")
			: `${targets.length} targets (${targets.join(", ")})`;

	for (const { scanResult } of scanResults) {
		for (const file of scanResult.files) {
			const tokens =
				typeof file.tokens === "number" && file.tokens > 0
					? file.tokens
					: countTokens(file.content);
			file.tokens = tokens;
			const chars = file.content.length;
			file.chars = chars;

			totalFiles++;
			totalLines += file.lines;
			totalBytes += file.bytes;
			totalChars += chars;
			totalTokens += tokens;

			allFiles.push({
				path: file.path,
				relativePath: file.relativePath,
				lines: file.lines,
				bytes: file.bytes,
				chars,
				tokens,
				sharePercent: 0, // computed below
			});
		}
		scanResult.totalTokens = scanResult.files.reduce(
			(acc, f) => acc + (f.tokens ?? 0),
			0,
		);
		scanResult.totalChars = scanResult.files.reduce(
			(acc, f) => acc + (f.chars ?? 0),
			0,
		);
	}

	// Calculate percentage shares
	for (const f of allFiles) {
		f.sharePercent =
			totalTokens > 0
				? Number(((f.tokens / totalTokens) * 100).toFixed(1))
				: 0;
	}

	// Sort files by token count descending
	allFiles.sort((a, b) => b.tokens - a.tokens);

	let contextImpact: ContextWindowImpact | undefined;

	if (ctx) {
		const activeModel = ctx.model?.name || ctx.model?.id;
		const contextWindow = ctx.model?.contextWindow;
		const usage = ctx.getContextUsage();
		const currentSessionTokens =
			typeof usage?.tokens === "number" ? usage.tokens : undefined;

		if (contextWindow && contextWindow > 0) {
			const payloadSharePercent = Number(
				((totalTokens / contextWindow) * 100).toFixed(1),
			);
			const currentSessionPercent =
				typeof currentSessionTokens === "number"
					? Number(((currentSessionTokens / contextWindow) * 100).toFixed(1))
					: undefined;

			const projectedTotalTokens =
				typeof currentSessionTokens === "number"
					? currentSessionTokens + totalTokens
					: totalTokens;

			const projectedPercent = Number(
				((projectedTotalTokens / contextWindow) * 100).toFixed(1),
			);
			const remainingHeadroom = Math.max(
				0,
				contextWindow - projectedTotalTokens,
			);
			const isOverCapacity = projectedTotalTokens > contextWindow;
			const isHighCapacityWarning =
				projectedPercent >= 75 && !isOverCapacity;

			contextImpact = {
				activeModel,
				contextWindow,
				payloadSharePercent,
				currentSessionTokens,
				currentSessionPercent,
				projectedTotalTokens,
				projectedPercent,
				remainingHeadroom,
				isOverCapacity,
				isHighCapacityWarning,
			};
		} else if (activeModel) {
			contextImpact = {
				activeModel,
				currentSessionTokens,
			};
		}
	}

	return {
		targetDescription,
		totalFiles,
		totalLines,
		totalBytes,
		totalChars,
		totalTokens,
		formattedBytes: formatBytes(totalBytes),
		files: allFiles,
		contextImpact,
	};
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Format a rich multi-line token summary report suitable for display in UI confirmation dialogs or notices.
 */
export function formatDetailedTokenReport(analysis: TokenAnalysis): string {
	const lines: string[] = [];

	lines.push(`Source: ${analysis.targetDescription}`);
	lines.push(
		`Tokens: ~${analysis.totalTokens.toLocaleString()} tokens | Files: ${analysis.totalFiles} | Lines: ${analysis.totalLines.toLocaleString()} | Size: ${analysis.formattedBytes} (${analysis.totalChars.toLocaleString()} chars)`,
	);

	if (analysis.contextImpact) {
		const ci = analysis.contextImpact;
		lines.push("");
		lines.push("--- Model Context Window Impact ---");
		if (ci.activeModel) {
			const winStr = ci.contextWindow
				? ` (max: ${ci.contextWindow.toLocaleString()} tokens)`
				: "";
			lines.push(`• Active Model: ${ci.activeModel}${winStr}`);
		}
		if (typeof ci.payloadSharePercent === "number") {
			lines.push(
				`• Payload Context Share: ~${ci.payloadSharePercent}% of context window`,
			);
		}
		if (
			typeof ci.currentSessionTokens === "number" &&
			typeof ci.projectedTotalTokens === "number" &&
			typeof ci.projectedPercent === "number"
		) {
			lines.push(
				`• Session Usage: ${ci.currentSessionTokens.toLocaleString()} tokens → New Total: ~${ci.projectedTotalTokens.toLocaleString()} tokens (${ci.projectedPercent}%)`,
			);
		}
		if (typeof ci.remainingHeadroom === "number") {
			lines.push(
				`• Remaining Headroom: ~${ci.remainingHeadroom.toLocaleString()} tokens`,
			);
		}

		if (ci.isOverCapacity) {
			lines.push(
				`⚠️ WARNING: Projected tokens (~${ci.projectedTotalTokens?.toLocaleString()}) EXCEED active context window limit (${ci.contextWindow?.toLocaleString()})!`,
			);
		} else if (ci.isHighCapacityWarning) {
			lines.push(
				`⚠️ Note: Payload will consume ${ci.projectedPercent}% of model context window capacity.`,
			);
		}
	}

	if (analysis.files.length > 1) {
		lines.push("");
		lines.push("--- Top Files Breakdown ---");
		const maxDisplay = 8;
		const displayFiles = analysis.files.slice(0, maxDisplay);
		for (let i = 0; i < displayFiles.length; i++) {
			const f = displayFiles[i]!;
			lines.push(
				`  ${i + 1}. ${f.relativePath} — ~${f.tokens.toLocaleString()} tokens (${f.sharePercent}%) | ${f.lines.toLocaleString()} lines | ${formatBytes(f.bytes)}`,
			);
		}
		if (analysis.files.length > maxDisplay) {
			const remainingCount = analysis.files.length - maxDisplay;
			const remainingTokens = analysis.files
				.slice(maxDisplay)
				.reduce((acc, curr) => acc + curr.tokens, 0);
			lines.push(
				`  ... and ${remainingCount} other file${remainingCount === 1 ? "" : "s"} totaling ~${remainingTokens.toLocaleString()} tokens`,
			);
		}
	}

	return lines.join("\n");
}

/**
 * Format confirmation dialog parameters.
 */
export function formatConfirmationPrompt(analysis: TokenAnalysis): {
	title: string;
	message: string;
} {
	const fileLabel = `${analysis.totalFiles} file${analysis.totalFiles === 1 ? "" : "s"}`;
	const title = `Load ~${analysis.totalTokens.toLocaleString()} tokens into context? (${fileLabel}, ${analysis.formattedBytes})`;
	const message = formatDetailedTokenReport(analysis);

	return { title, message };
}
