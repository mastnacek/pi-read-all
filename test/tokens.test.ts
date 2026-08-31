import assert from "node:assert/strict";
import test from "node:test";
import {
	analyzeScanResults,
	countTokens,
	estimateUniversalTokensHeuristic,
	renderDualProgressBar,
	resolveTokenizerForModel,
} from "../src/tokens.js";

test("resolveTokenizerForModel: resolves correct BPE encodings across architectures", () => {
	// o200k family
	assert.equal(
		resolveTokenizerForModel("gemini-3.7-flash").encoding,
		"o200k_base",
	);
	assert.equal(resolveTokenizerForModel("gpt-4o").encoding, "o200k_base");
	assert.equal(resolveTokenizerForModel("o3-mini").encoding, "o200k_base");
	assert.equal(
		resolveTokenizerForModel({ id: "gemini-2.0-flash", provider: "google" })
			.encoding,
		"o200k_base",
	);

	// cl100k family
	assert.equal(
		resolveTokenizerForModel("claude-3-7-sonnet").encoding,
		"cl100k_base",
	);
	assert.equal(resolveTokenizerForModel("deepseek-v3").encoding, "cl100k_base");
	assert.equal(
		resolveTokenizerForModel("meta-llama/llama-3.3-70b").encoding,
		"cl100k_base",
	);
	assert.equal(
		resolveTokenizerForModel("qwen/qwen-2.5-coder-32b").encoding,
		"cl100k_base",
	);
});

test("countTokens & estimateUniversalTokensHeuristic: counts text accurately", () => {
	const text = "Hello world! This is a test of the token counting engine.";
	const tokensO200k = countTokens(text, "gpt-4o");
	const tokensCl100k = countTokens(text, "claude-3-5-sonnet");

	assert.ok(tokensO200k > 0 && tokensO200k < 20);
	assert.ok(tokensCl100k > 0 && tokensCl100k < 20);

	const cjkText = "你好世界，这是一个测试。";
	const cjkTokens = countTokens(cjkText, "gemini-3.7-flash");
	assert.ok(cjkTokens > 0);

	const heuristicTokens = estimateUniversalTokensHeuristic(text);
	assert.ok(heuristicTokens > 0);
});

test("renderDualProgressBar: formats progress bar within bounds", () => {
	const bar = renderDualProgressBar(20000, 10000, 100000, 20);
	assert.ok(bar.includes("30.0%"));
	assert.ok(bar.includes("["));
	assert.ok(bar.includes("]"));

	// Over capacity
	const overBar = renderDualProgressBar(90000, 20000, 100000, 20);
	assert.ok(overBar.includes("100.0%"));
});

test("analyzeScanResults: computes token weight breakdowns and percentages", () => {
	const fakeScanResult = {
		targetPath: "src/",
		isDirectory: true,
		files: [
			{
				path: "/app/src/a.ts",
				relativePath: "src/a.ts",
				content: "const a = 1;".repeat(50),
				lines: 50,
				bytes: 600,
			},
			{
				path: "/app/src/b.ts",
				relativePath: "src/b.ts",
				content: "const b = 2;".repeat(10),
				lines: 10,
				bytes: 120,
			},
		],
		totalLines: 60,
		totalBytes: 720,
		skippedBinaryCount: 0,
		skippedSensitiveCount: 0,
		skippedUnreadableCount: 0,
		skippedOversizeCount: 0,
		truncated: false,
	};

	const analysis = analyzeScanResults([
		{ scanResult: fakeScanResult, targetPath: "src/" },
	]);

	assert.equal(analysis.totalFiles, 2);
	assert.ok(analysis.totalTokens > 0);
	assert.equal(analysis.files.length, 2);
	assert.ok(analysis.files[0]!.sharePercent > analysis.files[1]!.sharePercent);
});
