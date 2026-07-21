# Changelog

## [0.6.0] — 2026-07-14

### Added
- `ai-readability mcp`: MCP server on stdio with three tools — `repo_map`, `get_file` (with path-containment check), `context_report`. `@modelcontextprotocol/sdk` + `zod` are optional dependencies, dynamically loaded only when this command runs (needs Node 18+)
- `distill` skeleton extraction now has dedicated extractors for Python, Go, and Java/Kotlin (previously JS/TS only, other languages fell back to a generic extractor)

## [0.5.0] — 2026-07-12

### Added
- `scoreRepoAsync(dir, opts)`: async twin of `scoreRepo` with `onProgress`/`AbortSignal` support, yielding cooperatively so tokenization doesn't block the event loop
- `--fail-under <N>` CLI flag: exit code 1 if the repo score is below `N` (works with `--json`)
- `writeToolIgnore(root, tool, patterns)`: syncs `.aiignore` exclusions into `.cursorignore` / `.codeiumignore` when that tool is detected
- `createScanCache()`: per-file mtime cache for `--watch`, so unchanged files aren't retokenized on every save
- `PRICING_UPDATED_AT` in `src/pricing.js`, surfaced in CLI output

### Changed
- CLI output leads with a `AI-Ready: <grade> · ~$X per full read` headline, then context-fit/cost, then token breakdown as supporting detail
- Badge label changed from `AI-Readability: <grade>` to `AI-Ready: <grade>`
- Badge markdown (`![AI-Ready](...)`) is now printed at the end of every run, not just with `--badge`
- CI now runs on both `ubuntu-latest` and `windows-latest`

## [0.4.1] — 2026-07-12

### Fixed
- `scoreRepo` on a repo with zero scannable text files now returns `grade: 'N/A'` instead of a misleading `'F'`

## [0.4.0] — 2026-06-28

### Added
- `distill` subcommand: find highest-leverage files by import-graph fan-in × size, generate API skeleton summaries
  - `distill .` — preview candidates
  - `distill . --write` — write `.ai/summaries/<path>.md` + `CONTEXT_MAP.md`
  - Flags: `--top N`, `--min-fanin N`, `--respect-gitignore`, `--json`
- `distillRepo`, `buildImportGraph`, `extractSkeleton`, `writeSummaries`, `makeCandidate`, `renderSummary` exported from library
- `skippedFiles` field on `scoreRepo` return value (files skipped due to `maxBytes` limit)
- RegExp compile cache in `matchIgnore` — faster scans on large repos

### Fixed
- `**/*.js` pattern in `.aiignore` / `.gitignore` never matched root-level files (e.g. `index.js`)
  — `globToRegex` now emits `(?:.*/)?` for `**/` so the directory prefix is optional

## [0.3.0] — 2026-06-26

### Added
- `.gitignore` opt-in: `--respect-gitignore` flag and `respectGitignore` option
- Per-provider cross-tokenizer correction: `TOKEN_FACTOR` (Anthropic 1.25×, Google 1.1×), `effectiveTokens()`
- File size guard: `maxBytes` / `DEFAULT_MAX_BYTES` (2 MB) skips data dumps silently
- Expanded `TEXT` / `TEXT_NAMES` sets for wider language coverage

### Fixed
- Claude and Gemini token/cost figures were not adjusted for their tokenizers (OpenAI BPE undercounts)
