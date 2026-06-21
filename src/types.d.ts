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
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  files: FileResult[];
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
}

export interface ScoreRepoOptions {
  ignorePatterns?: string[];
}

export declare function scoreText(text: string): ScoreResult;
export declare function scoreRepo(dir: string, options?: ScoreRepoOptions): RepoResult;
export declare function isGenerated(relativePath: string): boolean;
export declare function gradeOf(value: number): 'A' | 'B' | 'C' | 'D' | 'F';
export declare function walk(dir: string, ignore?: string[]): string[];
export declare function loadIgnore(root: string): string[];
export declare const GEN_DIRS: Set<string>;
export declare const MODELS: Model[];
export declare const SUMMARY_MODELS: Model[];
