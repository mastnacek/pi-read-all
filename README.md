# pi-read-all

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A package/extension for the [Pi Coding Agent](https://github.com/earendil-works/pi-mono) that allows loading complete files or entire directory trees into the LLM context at once with **zero truncation** using the `@!` trigger, featuring **pre-flight BPE token calculation**, **detailed context impact analysis**, and **interactive user confirmation**.

---

## Key Features

- ⚡ **`@!` Trigger Syntax**: Prefix any file or folder with `@!` (e.g. `@!src/` or `@!book.txt`) in your prompt to recursively read and inject full verbatim text into context.
- 🧮 **Pre-flight Token Calculation**: Accurately counts BPE tokens (`cl100k_base` / `js-tiktoken`) and analyzes character, line, and byte metrics before anything is sent.
- 🛡️ **Interactive User Confirmation**: Shows an interactive confirmation dialog with detailed token statistics and context window consumption before injecting payloads into the LLM.
- 📚 **Whole-Book & Full-File Support**: Completely bypasses the built-in 50KB / 2,000-line truncation limits of standard `read`.
- 📁 **Recursive Directory Traversal**: Walks entire subtrees, ignores binary files, respects `.git`, `node_modules`, `dist`, `.next`, etc.
- 🎯 **TUI Autocomplete**: Type `@!` in the editor to get live fuzzy autocomplete for workspace folders and files.
- 🛠️ **Agent Tool (`read_all`)**: Exposes a dedicated tool so the LLM agent can also read full files/directories in multi-step workflows.
- ⌨️ **Slash Command (`/read-all`)**: Quick interactive commands (`/read-all <path>`, `/read-all status`, `/read-all help`).

---

## Interactive Confirmation & Token Analysis

When you submit a prompt containing `@!` or run `/read-all <path>`, the plugin:

1. Scans and processes all requested files.
2. Calculates exact token counts, character lengths, line counts, and file sizes.
3. Computes active model context window impact (context share %, current session usage, headroom remaining, over-capacity warnings).
4. Opens an interactive confirmation dialog:

```text
Load ~18,450 tokens into context? (12 files, 64.2 KB)

Source: src/
Tokens: ~18,450 tokens | Files: 12 | Lines: 1,420 | Size: 64.2 KB (65,740 chars)

--- Model Context Window Impact ---
• Active Model: Claude 3.7 Sonnet (max: 200,000 tokens)
• Payload Context Share: ~9.2% of context window
• Session Usage: 14,200 tokens → New Total: ~32,650 tokens (16.3%)
• Remaining Headroom: ~167,350 tokens

--- Top Files Breakdown ---
  1. src/server/router.ts — ~6,240 tokens (33.8%) | 420 lines | 21.5 KB
  2. src/models/schema.ts — ~4,100 tokens (22.2%) | 310 lines | 14.2 KB
  3. src/utils/helpers.ts — ~2,800 tokens (15.2%) | 190 lines | 9.8 KB
  ... and 9 other files totaling ~5,310 tokens
```

- Confirm (**Yes**) → Content is formatted and injected into the prompt.
- Decline (**No**) → Operation is cancelled immediately without sending any oversized prompt to the model.

---

## Installation

Install directly into Pi via git package:

```bash
pi install git:github.com/mastnacek/pi-read-all
```

Or clone into your global extensions:

```bash
git clone https://github.com/mastnacek/pi-read-all ~/.pi/agent/extensions/pi-read-all
```

---

## Usage

### 1. In Prompt Messages (`@!` Trigger)

```text
# Read a single large file or complete book:
Explain the plot and themes in @!war_and_peace.txt

# Recursively read a directory:
Audit all TypeScript files in @!src/core/ for security issues

# Paths with spaces:
Compare @!"docs/Architecture Guide.md" with @!src/
```

### 2. Standalone `@!` Trigger (Interactive UI)

Type `@!` alone in the input box and press **Enter**. Pi will open an interactive input prompt asking for the file or folder path.

### 3. Agent Tool (`read_all`)

The agent can call the `read_all` tool autonomously:

```json
{
  "path": "src/services",
  "maxFiles": 2000,
  "maxTotalBytes": 52428800
}
```

### 4. Slash Command

```text
/read-all src/components/
/read-all status
/read-all help
```

---

## Output Format

Content is injected into context structured with clear XML tags and manifest metadata:

```markdown
[pi-read-all]: Loaded 3 files from "src/utils/" | Total: ~3,210 tokens, 420 lines, 14.5 KB

<file path="src/utils/format.ts" lines="85" size="2.4 KB" tokens="~620">
... full content ...
</file>

<file path="src/utils/math.ts" lines="115" size="3.8 KB" tokens="~1,140">
... full content ...
</file>
```

---

## License

MIT License. See [LICENSE](./LICENSE) for details.
