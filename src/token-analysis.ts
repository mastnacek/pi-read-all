// Extracted from tokens.ts to keep modules focused.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";


import { getEncoding, type Tiktoken } from "js-tiktoken";
import {
	countTokens,
	formatBytes,
	resolveTokenizerForModel,
	type ResolvedTokenizer,
} from "./token-count.js";
import {
	type ScanResult,
} from "./scanner.js";

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
	tokenizerFamily?: string;
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
	tokenizerInfo: ResolvedTokenizer;
	contextImpact?: ContextWindowImpact;
}

/**
 * Universally analyze tokens and model context impact for scan results.
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

	const tokenizerInfo = resolveTokenizerForModel(ctx?.model);

	for (const { scanResult } of scanResults) {
		for (const file of scanResult.files) {
			const tokens =
				typeof file.tokens === "number" && file.tokens > 0
					? file.tokens
					: countTokens(file.content, ctx?.model);
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
			totalTokens > 0 ? Number(((f.tokens / totalTokens) * 100).toFixed(1)) : 0;
	}

	// Sort files by token count descending
	allFiles.sort((a, b) => b.tokens - a.tokens);

	let contextImpact: ContextWindowImpact | undefined;

	if (ctx) {
		const activeModel = ctx.model?.name || ctx.model?.id;
		const contextWindow = ctx.model?.contextWindow;
		const usage =
			typeof ctx.getContextUsage === "function"
				? ctx.getContextUsage()
				: undefined;
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
			const remainingHeadroom = Math.max(0, contextWindow - projectedTotalTokens);
			const isOverCapacity = projectedTotalTokens > contextWindow;
			const isHighCapacityWarning = projectedPercent >= 75 && !isOverCapacity;

			contextImpact = {
				activeModel,
				tokenizerFamily: tokenizerInfo.family,
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
				tokenizerFamily: tokenizerInfo.family,
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
		tokenizerInfo,
		contextImpact,
	};
}
