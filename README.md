# pi-read-all

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A package/extension for the [Pi Coding Agent](https://github.com/earendil-works/pi-mono) that allows loading complete files or entire directory trees into the LLM context at once with **zero truncation** using the `@!` trigger, featuring **universal multi-model BPE token calculation**, **dual-color context capacity gauges**, **automatic library/virtualenv isolation**, and **interactive user confirmation**.

---

## Key Features

- ⚡ **`@!` Trigger Syntax**: Prefix any file or folder with `@!` (e.g. `@!src/` or `@!book.txt`) in your prompt to recursively read and inject full verbatim text into context.
- 🌐 **Universal Tokenizer Engine**: Automatically routes active model (Gemini, Claude, GPT-4o, o1, o3, DeepSeek, Llama 3, Qwen, Mistral) to exact BPE encodings (`o200k_base`, `cl100k_base`) with multilingual script-aware heuristics.
- 🛡️ **Universal Library & Virtual Environment Isolation**:
  - Automatically skips virtual environments and third-party libraries across all ecosystems:
    - **Python**: `.venv`, `venv`, `env`, `.env`, `__pycache__`, `.pytest_cache`, `.mypy_cache`, `.tox`, `.nox`, `.poetry`, `.conda`
    - **Node / Web**: `node_modules`, `dist`, `build`, `out`, `.next`, `.nuxt`, `.turbo`, `.svelte-kit`, `.cache`
    - **Rust**: `target`
    - **Go / PHP**: `vendor`, `pkg`, `.phpunit.cache`
    - **Java / Kotlin**: `.gradle`, `.m2`, `target`, `build`, `.bloop`, `.metals`
    - **C / C++ / .NET**: `CMakeFiles`, `Debug`, `Release`, `bin`, `obj`, `packages`, `.vs`
    - **Dart / Flutter / Swift**: `.dart_tool`, `.build`, `.swiftpm`, `DerivedData`, `Pods`
  - Full `.gitignore` rule compliance via the `ignore` engine.
  - Excludes generated lockfiles (`package-lock.json`, `Cargo.lock`, etc.) and sensitive files (`.env`, `*.pem`, `id_rsa`) during directory sweeps while allowing explicit single-file loads.
- 🔋 **Dual-Color Capacity Gauge**: First-position visual progress bar displaying active session tokens vs incoming payload tokens vs remaining headroom.
- 🎯 **TUI Autocomplete**: Type `@!` in the editor to get live fuzzy autocomplete for workspace folders and files.
- 🛠️ **Agent Tool (`read_all`)**: Exposes a dedicated tool so the LLM agent can also read full files/directories in multi-step workflows.
- ⌨️ **Slash Command (`/read-all`)**: Quick interactive commands (`/read-all <path>`, `/read-all status`, `/read-all help`).

---

## Interactive Confirmation & Token Analysis

When you submit a prompt containing `@!` or run `/read-all <path>`, the plugin:

1. Scans and processes requested files, applying universal library filters and `.gitignore` rules.
2. Calculates exact token counts matching the active model architecture.
3. Renders a dual-color capacity progress bar and detailed context metrics.
4. Opens an interactive confirmation dialog:

```text
⚡ Load ~18,450 tokens into context? (12 files, 64.2 KB)

📦 Source: src/
🔋 Capacity: [█████░░░░░░░░░░░░░░░░░░░] 18.2% (Gemini 3.7 Flash · 1,048,576 max)
   ■ Active Session: 180,913 (17.3%) │ ■ Incoming Context: +18,450 (1.8%) │ ✨ Headroom: ~849,213

🔤 ~18,450 tokens │ 📁 12 files │ 📄 1,420 lines │ 💾 64.2 KB (65,740 chars)

─── 🧠 Model Context Window Impact ────────────────────────────
• 🤖 Active Model: Gemini 3.7 Flash (max: 1,048,576 tokens) [o200k]
• 📊 Payload Share: ~1.8% of context window
• 📈 Session Usage: 180,913 tokens → New Total: ~199,363 tokens (19.0%)
• ✨ Remaining Headroom: ~849,213 tokens

─── 📂 Top Files by Token Weight ────────────────────────────
  1. 📄 src/server/router.ts ── ~6,240 tok (33.8%) │ 420 lines │ 21.5 KB
  2. 📄 src/models/schema.ts ── ~4,100 tok (22.2%) │ 310 lines │ 14.2 KB
  3. 📄 src/utils/helpers.ts ── ~2,800 tok (15.2%) │ 190 lines │ 9.8 KB
  ... and 9 other files totaling ~5,310 tokens
```

- Confirm (**Yes**) → Content is formatted and injected into the prompt.
- Decline (**No**) → Cancelled immediately; original prompt is preserved in editor.

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

# Recursively read a directory (skips .venv, node_modules, target, etc.):
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

## License

MIT License. See [LICENSE](./LICENSE) for details.
