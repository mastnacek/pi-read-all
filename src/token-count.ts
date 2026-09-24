// Extracted from tokens.ts to keep modules focused.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { getEncoding, type Tiktoken } from "js-tiktoken";

export type SupportedEncoding =
	| "o200k_base"
	| "cl100k_base"
	| "p50k_base"
	| "r50k_base"
	| "gpt2";

export const encodersCache = new Map<SupportedEncoding, Tiktoken>();

/**
 * Format numbers with comma separation (e.g. 57,170).
 */
export function formatNumber(num: number | undefined | null): string {
	if (typeof num !== "number" || Number.isNaN(num)) return "0";
	return num.toLocaleString("en-US");
}

export interface ResolvedTokenizer {
	encoding: SupportedEncoding;
	family: string;
	label: string;
}

/**
 * Universally resolve optimal tokenizer encoding and family for any model / provider.
 * Supports OpenAI, Anthropic Claude, Google Gemini, Meta Llama, DeepSeek, Mistral, Qwen, Cohere, xAI Grok, etc.
 */
export function resolveTokenizerForModel(
	model?: string | { id?: string; name?: string; provider?: string },
): ResolvedTokenizer {
	const rawName =
		typeof model === "string" ? model : (model?.name ?? model?.id ?? "");
	const rawProvider = typeof model === "object" ? (model?.provider ?? "") : "";
	const normalized = `${rawProvider} ${rawName}`.toLowerCase();

	// 1. o200k family: GPT-4o, o1, o3, Gemini 1.5/2.0/2.5/3.7, Cohere Command-R (200k-256k vocabularies)
	if (
		normalized.includes("gpt-4o") ||
		normalized.includes("o1") ||
		normalized.includes("o3") ||
		normalized.includes("gemini") ||
		normalized.includes("gemma") ||
		normalized.includes("command-r") ||
		normalized.includes("cohere")
	) {
		return {
			encoding: "o200k_base",
			family: "o200k (200k+ Universal Vocab)",
			label: "o200k",
		};
	}

	// 2. Legacy models
	if (
		normalized.includes("davinci-003") ||
		normalized.includes("davinci-002") ||
		normalized.includes("code-davinci")
	) {
		return {
			encoding: "p50k_base",
			family: "p50k (Legacy OpenAI)",
			label: "p50k",
		};
	}
	if (
		normalized.includes("davinci") ||
		normalized.includes("curie") ||
		normalized.includes("babbage") ||
		normalized.includes("ada")
	) {
		return {
			encoding: "r50k_base",
			family: "r50k (Legacy GPT-3)",
			label: "r50k",
		};
	}

	// 3. cl100k family: Claude 3/3.5/3.7, GPT-4, Llama 3/3.1/3.2/3.3, DeepSeek V3/R1, Mistral/Codestral, Qwen 2.5, Grok
	return {
		encoding: "cl100k_base",
		family: "cl100k (Universal 100k-128k BPE)",
		label: "cl100k",
	};
}

/**
 * Get or lazily initialize the requested Tiktoken encoder singleton.
 */
export function getTokenizer(
	encoding: SupportedEncoding = "cl100k_base",
): Tiktoken | null {
	const cached = encodersCache.get(encoding);
	if (cached) return cached;
	try {
		const encoder = getEncoding(encoding);
		encodersCache.set(encoding, encoder);
		return encoder;
	} catch {
		return null;
	}
}

/**
 * Universal script-aware heuristic fallback for when BPE is unavailable.
 * Accurately weights ASCII code, CJK ideographs, whitespace, and punctuation.
 */
export function estimateUniversalTokensHeuristic(text: string): number {
	if (!text) return 0;
	let tokenEstimate = 0;

	let asciiChars = 0;
	let cjkChars = 0;
	let whitespaceChars = 0;

	for (const char of text) {
		const cp = char.codePointAt(0) ?? 0;
		if (cp <= 0x7f) {
			if (cp === 0x20 || cp === 0x09 || cp === 0x0a || cp === 0x0d) {
				whitespaceChars++;
			} else {
				asciiChars++;
			}
		} else if (
			(cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
			(cp >= 0x3400 && cp <= 0x4dbf) || // CJK Extension A
			(cp >= 0x3040 && cp <= 0x309f) || // Hiragana
			(cp >= 0x30a0 && cp <= 0x30ff) || // Katakana
			(cp >= 0xac00 && cp <= 0xd7af) // Hangul Syllables
		) {
			cjkChars++;
		} else {
			asciiChars++;
		}
	}

	// ASCII code/prose: ~3.7 chars per token
	tokenEstimate += Math.ceil(asciiChars / 3.7);
	// CJK: ~1.4 chars per token
	tokenEstimate += Math.ceil(cjkChars / 1.4);
	// Whitespace sequences collapse into adjacent tokens
	tokenEstimate += Math.ceil(whitespaceChars / 4.5);

	return Math.max(1, tokenEstimate);
}

/**
 * Accurately calculate token count for text using the universal tokenizer
 * matching the active model, with script-aware fallback.
 */
export function countTokens(
	text: string,
	model?: string | { id?: string; name?: string; provider?: string },
): number {
	if (!text) return 0;
	const resolved = resolveTokenizerForModel(model);
	const tokenizer =
		getTokenizer(resolved.encoding) ?? getTokenizer("cl100k_base");

	if (tokenizer) {
		try {
			return tokenizer.encode(text, "all").length;
		} catch {
			// fallback below
		}
	}

	return estimateUniversalTokensHeuristic(text);
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
