import type { ExtensionContext } from "@earendil-works/pi-coding-agent";



import { getEncoding, type Tiktoken } from "js-tiktoken";



import type { ScanResult } from "./scanner.js";


import {
	encodersCache,
	formatNumber,
	resolveTokenizerForModel,
	getTokenizer,
	estimateUniversalTokensHeuristic,
	countTokens,
	formatBytes,
	type SupportedEncoding,
	type ResolvedTokenizer,
} from "./token-count.js";

import {
	analyzeScanResults,
	type FileTokenBreakdown,
	type ContextWindowImpact,
	type TokenAnalysis,
} from "./token-analysis.js";
import {
	uiTheme,
	getIncomingGaugeColor,
	getShareColor,
	getProjectedUsageColor,
	getTokenWeightColor,
	getFileShareTextColor,
	renderDualProgressBar,
	formatDetailedTokenReport,
	formatConfirmationPrompt,
} from "./token-render.js";

// Re-exported so existing consumers can keep importing from this module.
// Re-exported so existing consumers can keep importing from this module.
// Re-exported so existing consumers can keep importing from this module.
export * from "./token-count.js";
export * from "./token-analysis.js";
export * from "./token-render.js";


