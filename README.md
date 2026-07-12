# ai-readability

![AI-Readability](./badge.svg)
[![npm](https://img.shields.io/npm/v/ai-readability)](https://www.npmjs.com/package/ai-readability)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D16-brightgreen)](https://nodejs.org)

**Find out what your codebase costs to feed an AI — and whether it even fits.**

Most repos silently waste 80–98% of their token budget on generated files, lock files, and minified output that AI tools can't reason about anyway. `ai-readability` scans a directory, prices it across 14 models from Anthropic, OpenAI, and Google, and tells you exactly which files to cut. Offline. No API keys. Under a second.

## Example

Running against a Playwright project with generated reports left in:

```
npx ai-readability ./my-playwright-project
```

```
  📦 ./my-playwright-project
  ──────────────────────────────────────────────────────────────────────

  Grade F  ·  226,533 tokens  ·  Score 38/100  ·  18 files

  Context fit
    Claude Sonnet 4.6 (1M)       23%  ✓   $0.679/run
    GPT-4o (128K)               177%  ✗   OVERFLOW
    Gemini 2.0 Flash (1M)        22%  ✓   $0.023/run

  Token breakdown  top 10 by waste
  ──────────────────────────────────────────────────────────────────────
  F  ████████████████████████  97%   219925 tok  playwright-report/index.html
  C  ░░░░░░░░░░░░░░░░░░░░░░░░   1%     1165 tok  package-lock.json
  A  ░░░░░░░░░░░░░░░░░░░░░░░░   0%      885 tok  README.md
  A  ░░░░░░░░░░░░░░░░░░░░░░░░   0%      585 tok  tests/Shopping.spec.js
  A  ░░░░░░░░░░░░░░░░░░░░░░░░   0%      584 tok  playwright.config.js
  B  ░░░░░░░░░░░░░░░░░░░░░░░░   0%      403 tok  tests/Sorting.spec.js
  A  ░░░░░░░░░░░░░░░░░░░░░░░░   0%      266 tok  pages/CheckoutInfo.js

  💡 Exclude 5 file(s)  F → A  ·  save 221,862 tokens (98%)

    [generated]            219925 tok  playwright-report/index.html
    [generated]              1165 tok  package-lock.json
    [generated]               364 tok  playwright-report/data/8d9e8c1a.md
    [generated]               364 tok  test-results/Login-loginPage-chromium/error-context.md
    [generated]                44 tok  test-results/.last-run.json

  📋 Paste into .aiignore / .cursorignore:
    playwright-report/
    package-lock.json
    test-results/

  Tip: run with --fix to write .aiignore automatically.

  After exclusions  (4,671 tokens)
    Claude Sonnet 4.6 (1M)       <1%  ✓   $0.014/run
    GPT-4o (128K)                 4%  ✓   $0.012/run
    Gemini 2.0 Flash (1M)        <1%  ✓   $0.0005/run
```

From 226K tokens (GPT-4o overflowing its context entirely, costing $0.68/run) down to 4.7K — one `--fix` pass.

## Quick Start

**One-off scan:**

```bash
npx ai-readability .
npx ai-readability . --cost     # full 14-model cost and context table
npx ai-readability . --fix      # auto-write .aiignore exclusions
npx ai-readability . --cost --fix   # both at once
```

**Install globally for repeated use:**

```bash
npm install -g ai-readability
ai-readability /path/to/any/project
```

## All options

| Flag | Description |
|---|---|
| `--cost` | Full per-model cost and context window table (14 models, 3 providers) |
| `--fix` | Auto-write suggested exclusion patterns to `.aiignore` (also syncs `.cursorignore` / `.codeiumignore` if that tool is detected — no AI tool reads `.aiignore` natively) |
| `--json` | Structured JSON output — for CI pipelines or `jq` |
| `--respect-gitignore` | Also exclude files matched by the root `.gitignore` (models what a `.gitignore`-aware AI tool actually ingests) |
| `--watch` | Re-scan and refresh automatically on every file change (only rescores files whose mtime changed; edits to `.aiignore`/`.gitignore` trigger a full rescan) |
| `--top <N>` | Show top N files in the bar chart [default: 10] |
| `--badge [file]` | Write an SVG grade badge [default: `<dir>/ai-readability-badge.svg`] |
| `--fail-under <N>` | Exit with code 1 if the repo score is below `N` — for CI gates; works with `--json` too |
| `--no-color` | Disable ANSI color — auto-disabled when piping or in CI |
| `--version` | Print version number |
| `--help` / `-h` | Show usage |

## How it works

### Scoring

Each file is scored 0–100 across three dimensions, then token-weighted into a repo-wide score:

| Metric | Weight | What it detects |
|---|---|---|
| **Signal** | 60% | Minified lines, base64 blobs, dense text with no whitespace |
| **Structure** | 25% | Blank-line density and function/class/heading boundaries |
| **Redundancy** | 15% | Duplicate lines that inflate tokens without adding meaning |

**Grade thresholds:** A ≥ 90 · B ≥ 75 · C ≥ 60 · D ≥ 45 · F < 45

### Generated file detection

Files are flagged `[generated]` when they match known build directories or filename patterns:

- **Directories never traversed:** `node_modules/`, `.git/`, `dist/`, `build/`, `.next/`, `coverage/` — `walk()` never enters these
- **Directories traversed but flagged as generated:** `out/`, `.nuxt/`, `target/`, `bin/`, `obj/`, `playwright-report/`, `test-results/`, `__pycache__/`, `vendor/`, and more — their files appear in the token breakdown and count toward the repo total, but are always marked `[generated]` and recommended for exclusion
- **Lock files:** `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, any `*.lock`
- **Minified / compiled assets:** `*.min.js`, `*.min.css`, `*.bundle.js`, `*.map`, `*.generated.*`

Add custom patterns via `.aiignore`.

### Flagged file reasons

| Reason | Meaning |
|---|---|
| `[generated]` | Build output, lock file, source map, or test artifact |
| `[low-signal (F)]` | Score < 45 — file is mostly noise |
| `[low-signal (D)]` | Score < 60 — low signal-to-token ratio |
| `[token-hog (N%)]` | File uses > 10% of total repo tokens |

## .aiignore

Create `.aiignore` in your project root (same syntax as `.gitignore`) to exclude paths from the scan. Note: `!` negation (re-including a path under an excluded directory) is not supported — negated lines are ignored, which errs toward scanning more rather than silently hiding files.

```
# .aiignore
playwright-report/
test-results/
package-lock.json
dist/
*.min.js
```

**Auto-generate it:** `ai-readability . --fix` writes the patterns for you based on what the tool flags.

Most AI editors respect equivalent files: Cursor reads `.cursorignore`, GitHub Copilot reads `.copilotignore`. A `.aiignore` gives you a single source of truth to copy into whichever you need.

## Library API

`ai-readability` is importable as a Node.js library — no subprocess needed:

```js
import { scoreRepo, scoreText, isGenerated } from 'ai-readability';

// Score an entire directory (respects .aiignore automatically)
const result = scoreRepo('./my-project');
// → { root, scannedAt, total, score, grade, files }

console.log(result.grade);   // 'A'
console.log(result.total);   // 4671 (tokens)
console.log(result.score);   // 89

// Score a single string (no file I/O — useful for in-memory content)
const { grade, tokens, value, signal } = scoreText(sourceCode);

// Check if a relative path is generated output
isGenerated('dist/bundle.js');    // true
isGenerated('src/index.ts');      // false
```

Pass extra ignore patterns without needing a `.aiignore` file on disk:

```js
const result = scoreRepo('./src', {
  ignorePatterns: ['*.generated.ts', 'fixtures/']
});
```

**TypeScript:** full `.d.ts` declarations are bundled — no `@types/` package needed.

```ts
import { scoreRepo, type RepoResult } from 'ai-readability';
const result: RepoResult = scoreRepo('./src');
```

## Context summaries (`distill`)

Some files get pulled into AI context over and over — the ones imported across your codebase. `distill` finds them (by import-graph fan-in × size) and generates a compact **API skeleton** for each: doc comments, exports, signatures, and type/interface contracts, with implementation bodies elided. Feed the summary for cheap context; open the full file only when detail is needed.

```bash
npx ai-readability distill .            # preview the highest-leverage files
npx ai-readability distill . --write    # write .ai/summaries/ + CONTEXT_MAP.md
```

```
  🧭 Context distillation  .
  ──────────────────────────────────────────────────────────────────────
  Candidate                          Imp    Original   Summary   Saved
  ──────────────────────────────────────────────────────────────────────
  src/core.js                           4      2,738       425     84%
  src/pricing.js                        4        918       243     74%
  ──────────────────────────────────────────────────────────────────────
  2 file(s)  ·  summarize to save 2,988 tokens (82%)
```

| Flag | Description |
|---|---|
| `--write` | Write `.ai/summaries/<path>.md` + a `CONTEXT_MAP.md` index |
| `--top <N>` | Max files to summarize [default: 20] |
| `--min-fanin <N>` | Only files imported by ≥ N others [default: 2] |
| `--respect-gitignore` | Exclude files matched by `.gitignore` |
| `--json` | Machine-readable output |

Skeletons are extracted **offline** (no API keys). Extraction is highest-fidelity for JS/TS (signatures, classes, interfaces); other languages get a best-effort declaration extract. Each summary embeds a `source-hash` so you can tell when it's gone stale — regenerate with `distill --write`.

Library API: `import { distillRepo, extractSkeleton, buildImportGraph, writeSummaries } from 'ai-readability'`.

## CI / CD

### Auto-update the badge on push

[`.github/workflows/badge.yml`](.github/workflows/badge.yml) runs on every push to `main`, generates `badge.svg` by running the CLI against the repo itself, and commits the updated file back if the grade changed. No secrets needed — it uses the built-in `GITHUB_TOKEN`.

### JSON quality gates

```bash
# Fail the build if score drops below 50 (built in — no jq needed)
ai-readability . --fail-under 50

# Same thing via jq, if you need the raw JSON anyway
ai-readability . --json | jq -e '.score >= 50'

# Show cost for a specific model
ai-readability . --json | jq '.models[] | select(.name == "Claude Sonnet 4.6") | .costUsd'

# Summarize token savings from .aiignore exclusions
ai-readability . --json | jq '.savings'
```

JSON output schema:

```json
{
  "root": "./my-project",
  "scannedAt": "2026-06-21T10:00:00.000Z",
  "total": 226533,
  "grade": "F",
  "score": 38,
  "files": [...],
  "flagged": [
    { "file": "playwright-report/index.html", "reason": "generated", "tokens": 219925 }
  ],
  "savings": { "tokensSaved": 221862, "tokensAfter": 4671, "pctSaved": 98 },
  "models": [
    {
      "name": "Claude Sonnet 4.6",
      "provider": "Anthropic",
      "ctxTokens": 1000000,
      "tokenFactor": 1.25,
      "effectiveTokens": 283166,
      "estimate": true,
      "fits": true,
      "usagePct": 28.3,
      "costUsd": 0.849,
      "costAfterExclusionUsd": 0.018
    }
  ]
}
```

## Supported models

The `--cost` flag compares your repo against 14 models. All prices live in [`src/pricing.js`](src/pricing.js) — edit that file to add models or update prices (they change quarterly).

| Provider | Models |
|---|---|
| **Anthropic** | Claude Opus 4.8, Claude Sonnet 4.6, Claude Haiku 4.5 |
| **OpenAI** | GPT-4.1, GPT-4.1 mini, GPT-4.1 nano, GPT-4o, GPT-4o mini, o3, o4-mini |
| **Google** | Gemini 2.5 Pro, Gemini 2.0 Flash, Gemini 1.5 Pro, Gemini 1.5 Flash |

Prices shown are input/prompt token prices only. Output tokens are not included — for codebase-read use cases, input cost dominates.

### Token counts are cross-tokenizer estimates

Token counting uses [`gpt-tokenizer`](https://www.npmjs.com/package/gpt-tokenizer) (OpenAI BPE). Claude and Gemini tokenize differently, so their token, cost, and context-fit figures are scaled by a calibrated correction factor (Anthropic ≈ 1.25×, Google ≈ 1.10×) and should be treated as **estimates**. OpenAI figures are exact. Factors live in [`src/pricing.js`](src/pricing.js) (`TOKEN_FACTOR`); the JSON output exposes `tokenFactor`, `effectiveTokens`, and an `estimate` flag per model.

## Privacy

**100% local. No network requests. No API keys.**

Token counting uses [`gpt-tokenizer`](https://www.npmjs.com/package/gpt-tokenizer) — an offline, MIT-licensed tokenizer. Your source code never leaves your machine.

**ANSI colors** are auto-disabled when piping or in CI (`process.stdout.isTTY`). Force-disable with `--no-color`.

**Watch mode on Linux:** `--watch` uses Node's `fs.watch` with `recursive: true`, which requires Node.js 22+ on Linux. On older versions it falls back to top-level watching with a console warning.

**Windows:** backslashes in file paths are normalized internally — output always uses forward slashes.

## Requirements

Node.js 16 or later. No API keys. No network.

## Contributing

```bash
npm test   # runs 27 tests with node:test (no extra deps)
```

**To add a model or update prices:** edit [`src/pricing.js`](src/pricing.js) and update the `// prices as of YYYY-MM` date at the top.

**To add a generated-file pattern:** add a regex to `GEN_FILE` or a directory name to `GEN_DIRS` in [`src/core.js`](src/core.js).

Found a bug or want a missing pattern? Open an issue: [github.com/thesamratdas/ai-readability/issues](https://github.com/thesamratdas/ai-readability/issues)

## License

MIT © 2026 Samrat Das
