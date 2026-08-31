# pi-read-all

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A package/extension for the [Pi Coding Agent](https://github.com/earendil-works/pi-mono) that allows loading complete files or entire directory trees into the LLM context at once with **zero truncation** using the `@!` trigger.

---

## Key Features

- ⚡ **`@!` Trigger Syntax**: Prefix any file or folder with `@!` (e.g. `@!src/` or `@!book.txt`) in your prompt to recursively read and inject the full verbatim text into context.
- 📚 **Whole-Book & Full-File Support**: Completely bypasses the built-in 50KB / 2,000-line truncation limits of standard `read`.
- 📁 **Recursive Directory Traversal**: Walks entire subtrees, ignores binary files, respects `.git`, `node_modules`, `dist`, `.next`, etc.
- 🎯 **TUI Autocomplete**: Type `@!` in the editor to get live fuzzy autocomplete for workspace folders and files.
- 🛠️ **Agent Tool (`read_all`)**: Exposes a dedicated tool so the LLM agent can also read full files/directories in multi-step workflows.
- ⌨️ **Slash Command (`/read-all`)**: Quick interactive commands (`/read-all <path>`, `/read-all status`, `/read-all help`).

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
[pi-read-all]: Loaded 3 files from "src/utils/" | Total: 420 lines, 14.5 KB

<file path="src/utils/format.ts" lines="85" size="2.4 KB">
... full content ...
</file>

<file path="src/utils/math.ts" lines="115" size="3.8 KB">
... full content ...
</file>
```

---

## License

MIT License. See [LICENSE](./LICENSE) for details.
