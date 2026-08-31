import assert from "node:assert/strict";
import test from "node:test";

test("Regex & positional replacement: end-to-start replacement handles duplicates and order safely", () => {
	const text =
		"Compare @!src/a.ts with duplicate @!src/a.ts and @!src/b.ts in detail.";
	const AT_EXCL_RE = /@!"([^"\n]+)"|@!([^\s"(){}[\];,]+)/g;

	const matches = Array.from(text.matchAll(AT_EXCL_RE));
	assert.equal(matches.length, 3);

	interface TestEntry {
		fullMatch: string;
		targetPath: string;
		index: number;
		length: number;
		formattedContent: string;
	}

	const entries: TestEntry[] = matches.map((m) => ({
		fullMatch: m[0],
		targetPath: m[1] ?? m[2] ?? "",
		index: m.index ?? 0,
		length: m[0].length,
		formattedContent: `[CONTENT OF ${m[1] ?? m[2]}]`,
	}));

	// Sort end-to-start
	const sorted = [...entries].sort((a, b) => b.index - a.index);
	let resultText = text;
	for (const entry of sorted) {
		const replacement = `\n\n${entry.formattedContent}\n\n`;
		resultText =
			resultText.slice(0, entry.index) +
			replacement +
			resultText.slice(entry.index + entry.length);
	}

	assert.ok(
		resultText.startsWith("Compare \n\n[CONTENT OF src/a.ts]\n\n with duplicate"),
	);
	assert.ok(
		resultText.includes(
			"with duplicate \n\n[CONTENT OF src/a.ts]\n\n and \n\n[CONTENT OF src/b.ts]\n\n in detail.",
		),
	);
	assert.ok(!resultText.includes("@!"));
});

test("Trailing sentence punctuation: unquoted target paths preserve punctuation", () => {
	const AT_EXCL_RE = /@!"([^"\n]+)"|@!([^\s"(){}[\];,]+)/g;
	const text = "Check @!src/index.ts.";
	const matches = Array.from(text.matchAll(AT_EXCL_RE));

	assert.equal(matches.length, 1);
	const match = matches[0]!;
	const rawTarget = match[2]!;
	assert.equal(rawTarget, "src/index.ts.");

	// Punctuation stripping logic
	const stripped = rawTarget.replace(/[.,:;!?]+$/, "");
	assert.equal(stripped, "src/index.ts");
	const diff = rawTarget.length - stripped.length;
	const adjustedLength = match[0].length - diff;

	const replacement = "\n\n[FILE_CONTENT]\n\n";
	const result =
		text.slice(0, match.index ?? 0) +
		replacement +
		text.slice((match.index ?? 0) + adjustedLength);

	assert.equal(result, "Check \n\n[FILE_CONTENT]\n\n.");
});
