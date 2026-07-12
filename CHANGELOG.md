# Changelog

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
