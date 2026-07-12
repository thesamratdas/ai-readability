export interface FileResult {
  file: string;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  value: number;
  tokens: number;
  signal: number;
  structure: number;
  redundancy: number;
  waste: number;
}

export interface RepoResult {
  root: string;
  scannedAt: string;
  total: number;
  score: number;
  /** 'N/A' when the repo has zero scannable text files. */
  grade: 'A' | 'B' | 'C' | 'D' | 'F' | 'N/A';
  files: FileResult[];
  skippedFiles: number;
}

export interface ScanCache {
  /** Rescores dir, reusing cached per-file results when a file's mtime hasn't changed. */
  scan(dir: string, ignore?: string[], maxBytes?: number): FileResult[];
  /** Drops all cached entries, forcing every file to be rescored on the next scan. */
  invalidate(): void;
  size(): number;
}

export interface ScoreResult {
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  value: number;
  tokens: number;
  signal: number;
  structure: number;
  redundancy: number;
}

export interface Model {
  name: string;
  provider: 'Anthropic' | 'OpenAI' | 'Google';
  ctx: number;
  usdPerMTok: number;
  /** Cross-tokenizer correction factor relative to OpenAI BPE counts. */
  tokenFactor: number;
}

export interface ScoreRepoOptions {
  ignorePatterns?: string[];
  /** Also exclude files matched by the root .gitignore. Default false. */
  respectGitignore?: boolean;
  /** Skip files larger than this many bytes. Default 2_000_000. */
  maxBytes?: number;
}

export interface ScoreRepoAsyncOptions extends ScoreRepoOptions {
  /** Called after each file is scored, with (filesScored, totalFiles). */
  onProgress?: (done: number, total: number) => void;
  /** When aborted, the scan stops after the in-flight file and returns a valid
   * (partial) RepoResult computed from whatever was scored so far. */
  signal?: AbortSignal;
}

export declare function scoreText(text: string): ScoreResult;
export declare function scoreRepo(dir: string, options?: ScoreRepoOptions): RepoResult;
/** Async twin of scoreRepo: same return shape, yields cooperatively between
 * files so tokenization doesn't block the event loop, and supports
 * onProgress/AbortSignal. Use this from host UIs (e.g. the VS Code
 * extension); the CLI keeps using sync scoreRepo. */
export declare function scoreRepoAsync(dir: string, options?: ScoreRepoAsyncOptions): Promise<RepoResult>;
export declare function isGenerated(relativePath: string): boolean;
export declare function isTextFile(name: string): boolean;
export declare function gradeOf(value: number): 'A' | 'B' | 'C' | 'D' | 'F';
export declare function walk(dir: string, ignore?: string[], out?: string[], root?: string, maxBytes?: number): string[];
export declare function loadIgnore(root: string): string[];
export declare function loadGitignore(root: string): string[];
export declare function reasonFor(r: FileResult, total: number): string | null;
export declare function computePatterns(files: FileResult[], total: number): string[];
export declare function writeAiignore(dest: string, patterns: string[]): number;
/** Writes patterns into a detected tool's ignore file (e.g. .cursorignore).
 * Returns 0 without writing anything if the tool isn't detected in `root`. */
export declare function writeToolIgnore(root: string, tool: string, patterns: string[]): number;
/** Creates a repeated-scan mtime cache — see ScanCache. Used by the CLI's --watch mode. */
export declare function createScanCache(): ScanCache;
export declare function effectiveTokens(tokens: number, model: Model): number;
export declare const GEN_DIRS: Set<string>;
export declare const SUPPORTED_TOOLS: string[];
export declare const DEFAULT_MAX_BYTES: number;
export declare const MODELS: Model[];
export declare const SUMMARY_MODELS: Model[];
export declare const TOKEN_FACTOR: Record<'Anthropic' | 'OpenAI' | 'Google', number>;

export interface DistillCandidate {
  file: string;
  ext: string;
  fanIn: number;
  tokens: number;
  summaryTokens: number;
  savedTokens: number;
  savedPct: number;
  leverage: number;
  skeleton: string;
  hash: string;
}

export interface DistillResult {
  root: string;
  scannedAt: string;
  candidates: DistillCandidate[];
  totals: { files: number; originalTokens: number; summaryTokens: number; savedTokens: number; savedPct: number };
}

export interface DistillOptions {
  minFanIn?: number;
  minTokens?: number;
  top?: number;
  ignorePatterns?: string[];
  respectGitignore?: boolean;
  maxBytes?: number;
}

export declare function distillRepo(dir: string, options?: DistillOptions): DistillResult;
export declare function buildImportGraph(infos: { rel: string; ext: string; text: string }[]): Map<string, number>;
export declare function extractSkeleton(text: string, ext: string): string;
export declare function makeCandidate(file: string, text: string, ext: string, fanIn?: number): DistillCandidate;
export declare function renderSummary(candidate: DistillCandidate): string;
export declare function writeSummaries(dir: string, candidates: DistillCandidate[]): { written: number; dir: string; indexPath: string };
