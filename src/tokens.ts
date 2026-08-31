import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getEncoding, type Tiktoken } from "js-tiktoken";
import type { ScanResult } from "./scanner.js";

let encoderInstance: Tiktoken | null = null;

/**
 * ANSI Styling & Glowing Colors Palette
 */
export const uiTheme = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	italic: "\x1b[3m",
	underline: "\x1b[4m",

	// Vibrant Glowing Text (24-bit TrueColor)
	cyanGlow: "\x1b[1;38;2;0;245;255m",
	cyan: "\x1b[38;2;0;210;235m",
	magentaGlow: "\x1b[1;38;2;255;55;180m",
	magenta: "\x1b[38;2;235;45;165m",
	purpleGlow: "\x1b[1;38;2;185;105;255m",
	purple: "\x1b[38;2;160;90;235m",
	blueGlow: "\x1b[1;38;2;70;180;255m",
	blue: "\x1b[38;2;50;150;240m",
	greenGlow: "\x1b[1;38;2;50;255;120m",
	green: "\x1b[38;2;45;210;110m",
	yellowGlow: "\x1b[1;38;2;255;215;40m",
	yellow: "\x1b[38;2;235;190;35m",
	orangeGlow: "\x1b[1;38;2;255;135;35m",
	redGlow: "\x1b[1;38;2;255;65;65m",
	whiteBold: "\x1b[1;38;2;255;255;255m",
	white: "\x1b[38;2;240;245;250m",
	gray: "\x1b[38;2;130;145;160m",
	darkGray: "\x1b[38;2;70;80;95m",
	divider: "\x1b[38;2;90;105;125m",
	subtle: "\x1b[38;2;100;115;135m",
} as const;

/**
 * Format numbers with comma separation (e.g. 57,170).
 */
export function formatNumber(num: number | undefined | null): string {
	if (typeof num !== "number" || Number.isNaN(num)) return "0";
	return num.toLocaleString("en-US");
}

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
 * Render a dual-segment ANSI progress bar gauge:
 * - Active session tokens in Blue/Cyan glow (█)
 * - Incoming context payload tokens in Magenta/Orange/Red glow (█)
 * - Empty context headroom in Dark Slate (░)
 */
export function renderDualProgressBar(
	currentTokens: number,
	incomingTokens: number,
	contextWindow: number,
	width = 24,
): string {
	if (!contextWindow || contextWindow <= 0) return "";
	const currentRatio = Math.min(1, Math.max(0, currentTokens / contextWindow));
	const incomingRatio = Math.min(
		1 - currentRatio,
		Math.max(0, incomingTokens / contextWindow),
	);
	const totalRatio = Math.min(
		1,
		(currentTokens + incomingTokens) / contextWindow,
	);

	let currentBlocks = Math.round(currentRatio * width);
	let incomingBlocks = Math.round(incomingRatio * width);

	if (incomingTokens > 0 && incomingBlocks === 0 && currentBlocks < width) {
		incomingBlocks = 1;
	}
	if (currentTokens > 0 && currentBlocks === 0 && incomingBlocks < width) {
		currentBlocks = 1;
	}

	if (currentBlocks + incomingBlocks > width) {
		if (currentBlocks > incomingBlocks) {
			currentBlocks = width - incomingBlocks;
		} else {
			incomingBlocks = width - currentBlocks;
		}
	}

	const emptyBlocks = Math.max(0, width - currentBlocks - incomingBlocks);
	const totalPercent = (totalRatio * 100).toFixed(1);

	const incomingColor =
		totalRatio > 0.85
			? uiTheme.redGlow
			: totalRatio > 0.6
				? uiTheme.orangeGlow
				: uiTheme.magentaGlow;

	return `${uiTheme.gray}[${uiTheme.blueGlow}${"█".repeat(currentBlocks)}${incomingColor}${"█".repeat(incomingBlocks)}${uiTheme.darkGray}${"░".repeat(emptyBlocks)}${uiTheme.gray}] ${uiTheme.whiteBold}${totalPercent}%${uiTheme.reset}`;
}

/**
 * Format a rich, colorful, styled token summary report with emojis, dual progress bar, glow accents, and breakdown.
 */
export function formatDetailedTokenReport(analysis: TokenAnalysis): string {
	const c = uiTheme;
	const lines: string[] = [];

	// 1. Source Header
	lines.push(
		`📦 ${c.magentaGlow}Source:${c.reset} ${c.whiteBold}${analysis.targetDescription}${c.reset}`,
	);

	// 2. FIRST PLACE: Dual-Segment Progress Bar (Active Session vs Incoming Context vs Headroom)
	const ci = analysis.contextImpact;
	if (ci && typeof ci.contextWindow === "number" && ci.contextWindow > 0) {
		const win = ci.contextWindow;
		const current = ci.currentSessionTokens ?? 0;
		const incoming = analysis.totalTokens;
		const currentPct = ((current / win) * 100).toFixed(1);
		const incomingPct = ((incoming / win) * 100).toFixed(1);
		const headroom = Math.max(0, win - (current + incoming));
		const headColor = headroom < 10000 ? c.redGlow : c.greenGlow;
		const modelLabel = ci.activeModel ? `${ci.activeModel} · ` : "";

		lines.push(
			`🔋 ${c.white}Capacity:${c.reset} ${renderDualProgressBar(current, incoming, win, 24)} ${c.gray}(${modelLabel}${formatNumber(win)} max)${c.reset}`,
		);
		lines.push(
			`   ${c.blueGlow}■${c.reset} ${c.white}Active Session:${c.reset} ${c.blueGlow}${formatNumber(current)}${c.reset} ${c.gray}(${currentPct}%)${c.reset}  ${c.divider}│${c.reset}  ${c.magentaGlow}■${c.reset} ${c.white}Incoming Context:${c.reset} ${c.magentaGlow}+${formatNumber(incoming)}${c.reset} ${c.gray}(${incomingPct}%)${c.reset}  ${c.divider}│${c.reset}  ✨ ${c.white}Headroom:${c.reset} ${headColor}~${formatNumber(headroom)}${c.reset}`,
		);
		lines.push("");
	}

	// 3. Metrics Pill Bar
	const tokenPill = `🔤 ${c.cyanGlow}~${formatNumber(analysis.totalTokens)} tokens${c.reset}`;
	const filesPill = `📁 ${c.blueGlow}${analysis.totalFiles} files${c.reset}`;
	const linesPill = `📄 ${c.greenGlow}${formatNumber(analysis.totalLines)} lines${c.reset}`;
	const sizePill = `💾 ${c.yellowGlow}${analysis.formattedBytes}${c.reset} ${c.gray}(${formatNumber(analysis.totalChars)} chars)${c.reset}`;

	lines.push(
		`${tokenPill}  ${c.divider}│${c.reset}  ${filesPill}  ${c.divider}│${c.reset}  ${linesPill}  ${c.divider}│${c.reset}  ${sizePill}`,
	);

	// 4. Detailed Model Context Window Impact
	if (analysis.contextImpact) {
		const ci = analysis.contextImpact;
		lines.push("");
		lines.push(
			`${c.divider}─── ${c.purpleGlow}🧠 Model Context Window Impact${c.reset} ${c.divider}────────────────────────────${c.reset}`,
		);

		if (ci.activeModel) {
			const winStr = ci.contextWindow
				? ` ${c.gray}(max: ${c.whiteBold}${formatNumber(ci.contextWindow)}${c.gray} tokens)${c.reset}`
				: "";
			lines.push(
				`• 🤖 ${c.white}Active Model:${c.reset} ${c.cyanGlow}${ci.activeModel}${c.reset}${winStr}`,
			);
		}

		if (typeof ci.payloadSharePercent === "number") {
			const shareColor =
				ci.payloadSharePercent > 50
					? c.orangeGlow
					: ci.payloadSharePercent > 20
						? c.yellowGlow
						: c.greenGlow;
			lines.push(
				`• 📊 ${c.white}Payload Share:${c.reset} ${shareColor}~${ci.payloadSharePercent}%${c.reset} ${c.gray}of context window${c.reset}`,
			);
		}

		if (
			typeof ci.currentSessionTokens === "number" &&
			typeof ci.projectedTotalTokens === "number" &&
			typeof ci.projectedPercent === "number"
		) {
			const projColor =
				ci.projectedPercent > 80
					? c.redGlow
					: ci.projectedPercent > 50
						? c.yellowGlow
						: c.greenGlow;

			lines.push(
				`• 📈 ${c.white}Session Usage:${c.reset} ${c.cyan}${formatNumber(ci.currentSessionTokens)}${c.gray} tokens${c.reset} → ${c.white}New Total:${c.reset} ${projColor}~${formatNumber(ci.projectedTotalTokens)} tokens${c.reset} ${c.gray}(${ci.projectedPercent}%)${c.reset}`,
			);
		}

		if (typeof ci.remainingHeadroom === "number") {
			const headColor =
				ci.remainingHeadroom < 10000 ? c.redGlow : c.greenGlow;
			lines.push(
				`• ✨ ${c.white}Remaining Headroom:${c.reset} ${headColor}~${formatNumber(ci.remainingHeadroom)} tokens${c.reset}`,
			);
		}

		if (ci.isOverCapacity) {
			lines.push(
				`\n${c.redGlow}⚠️  WARNING: Projected tokens (~${formatNumber(ci.projectedTotalTokens)}) EXCEED model context limit (${formatNumber(ci.contextWindow)})!${c.reset}`,
			);
		} else if (ci.isHighCapacityWarning) {
			lines.push(
				`\n${c.orangeGlow}⚠️  Caution: Payload will consume ${ci.projectedPercent}% of model context window capacity.${c.reset}`,
			);
		}
	}

	// 5. Top Files Breakdown
	if (analysis.files.length > 1) {
		lines.push("");
		lines.push(
			`${c.divider}─── ${c.blueGlow}📂 Top Files Breakdown (by Token Weight)${c.reset} ${c.divider}────────────────────────────${c.reset}`,
		);
		const maxDisplay = 8;
		const displayFiles = analysis.files.slice(0, maxDisplay);

		for (let i = 0; i < displayFiles.length; i++) {
			const f = displayFiles[i]!;
			const num = String(i + 1).padStart(2, " ");
			const tokColor =
				f.sharePercent >= 50
					? c.orangeGlow
					: f.sharePercent >= 10
						? c.yellowGlow
						: c.cyanGlow;

			const shareColor =
				f.sharePercent >= 50
					? c.orangeGlow
					: f.sharePercent >= 10
						? c.yellow
						: c.gray;

			lines.push(
				`  ${c.gray}${num}.${c.reset} 📄 ${c.white}${f.relativePath}${c.reset} ${c.divider}──${c.reset} ${tokColor}~${formatNumber(f.tokens)} tok${c.reset} ${shareColor}(${f.sharePercent}%)${c.reset} ${c.divider}│${c.reset} ${c.green}${formatNumber(f.lines)} lines${c.reset} ${c.divider}│${c.reset} ${c.yellow}${formatBytes(f.bytes)}${c.reset}`,
			);
		}

		if (analysis.files.length > maxDisplay) {
			const remainingCount = analysis.files.length - maxDisplay;
			const remainingTokens = analysis.files
				.slice(maxDisplay)
				.reduce((acc, curr) => acc + curr.tokens, 0);
			const remainingShare = (
				(remainingTokens / (analysis.totalTokens || 1)) *
				100
			).toFixed(1);

			lines.push(
				`  ${c.subtle}... and ${remainingCount} other file${remainingCount === 1 ? "" : "s"} totaling ${c.cyanGlow}~${formatNumber(remainingTokens)} tokens${c.subtle} (${remainingShare}%)${c.reset}`,
			);
		}
	}

	return lines.join("\n");
}

/**
 * Format confirmation dialog parameters with glowing title and rich report body.
 */
export function formatConfirmationPrompt(analysis: TokenAnalysis): {
	title: string;
	message: string;
} {
	const c = uiTheme;
	const fileLabel = `${analysis.totalFiles} file${analysis.totalFiles === 1 ? "" : "s"}`;
	const title = `⚡ ${c.magentaGlow}Load ~${formatNumber(analysis.totalTokens)} tokens into context?${c.reset} ${c.gray}(${fileLabel}, ${analysis.formattedBytes})${c.reset}`;
	const message = formatDetailedTokenReport(analysis);

	return { title, message };
}
